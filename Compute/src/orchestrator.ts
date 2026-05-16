/**
 * GhostProver Orchestrator — Full end-to-end pipeline.
 *
 * This is the main entry point that ties together:
 *   1. Inference (mock or live 0G Compute)
 *   2. Bridge (Poseidon2 commitment computation)
 *   3. ZK Proof generation (via nargo)
 *   4. 0G Storage upload (audit bundle archival)
 *   5. On-chain receipt submission (GhostProverRegistry)
 *
 * Usage:
 *   npm run orchestrate -- --target "234567890123" --prompt "Your prompt here"
 *   npm run orchestrate -- --target "ssn" --sample samples/inference-XYZ.log.json
 *   npm run orchestrate -- --preset saas --sample samples/inference-XYZ.log.json
 *
 * Environment variables:
 *   PRIVATE_KEY       - Wallet for 0G Storage upload + on-chain tx
 *   ZG_RPC_URL        - 0G Chain RPC (testnet or mainnet)
 *   ZG_INDEXER_URL    - 0G Storage indexer
 *   REGISTRY_ADDRESS  - GhostProverRegistry contract address
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ethers } from 'ethers';
import { poseidon2Hash } from '@zkpassport/poseidon2';
import { uploadAuditBundle, computeStorageRoot, type AuditBundle } from './storage.js';
import { verifyInferenceLog, type ZerogAuthEnvelope } from './verify-attestation.js';

// Import the proof generation SDK from the root project
// This uses @noir-lang/noir_js + @aztec/bb.js under the hood
let generateProofFn: ((input: { promptBytes: Uint8Array; targetBytes: Uint8Array }) => Promise<{
  proof: Uint8Array;
  commitment: string;
  targetHash: string;
  proofTimeMs: number;
}>) | null = null;
let generateBatchProofsFn: ((input: {
  promptBytes: Uint8Array;
  preset?: string;
  patternIds?: string[];
  concurrency?: number;
}) => Promise<{
  commitment: string;
  results: {
    patternId: string;
    patternName: string;
    status: 'done' | 'failed';
    proof?: { proof: Uint8Array; targetHash: string };
    error?: string;
  }[];
  totalTimeMs: number;
}>) | null = null;

async function loadProofGenerator() {
  if (generateProofFn) return generateProofFn;
  try {
    // Try to import from the built dist (if available)
    const sdk = await import('../../dist/index.js');
    generateProofFn = sdk.generateProof;
    return generateProofFn;
  } catch {
    // Fallback: the SDK might not be built yet
    console.warn('[orchestrator] SDK not built. Run `npm run build` in project root first.');
    return null;
  }
}

async function loadBatchProofGenerator() {
  if (generateBatchProofsFn) return generateBatchProofsFn;
  try {
    const sdk: any = await import('../../dist/index.js');
    generateBatchProofsFn = sdk.generateBatchProofs;
    return generateBatchProofsFn;
  } catch {
    console.warn('[orchestrator] SDK not built. Run `npm run build` in project root first.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROMPT_MAX = 512;
const TARGET_MAX = 32;

const ZG_RPC_URL = process.env.ZG_RPC_URL ?? 'https://evmrpc.0g.ai';
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;

const REGISTRY_ABI = [
  'function submitReceipt(bytes proof, bytes32 commitment, bytes32 targetHash, address providerAddress, string modelId, bytes32 storageRoot) external',
  'function submitBatchReceipt(bytes[] proofs, bytes32 commitment, bytes32[] targetHashes, address providerAddress, string modelId, bytes32 storageRoot) external',
  'event ComplianceReceiptIssued(bytes32 indexed commitment, bytes32 indexed targetHash, address indexed submitter, address providerAddress, string modelId, bytes32 storageRoot, uint256 timestamp)',
  'event ComplianceBatchReceiptIssued(bytes32 indexed commitment, bytes32[] targetHashes, address indexed submitter, address providerAddress, string modelId, bytes32 storageRoot, uint256 timestamp)',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padBytes(s: string, len: number): { bytes: number[]; actualLen: number } {
  const raw = Buffer.from(s, 'utf8');
  if (raw.length > len) {
    throw new Error(`Input ${raw.length} bytes exceeds circuit max ${len}`);
  }
  const bytes = new Array<number>(len).fill(0);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw[i];
  return { bytes, actualLen: raw.length };
}

function hashBytes(bytes: number[]): bigint {
  const fields = bytes.map((b) => BigInt(b));
  return poseidon2Hash(fields);
}

function toHex32(b: bigint): string {
  return '0x' + b.toString(16).padStart(64, '0');
}

function findLatestSample(): string | null {
  const dir = path.resolve('samples');
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir)
    .filter((f) => f.startsWith('inference-') && f.endsWith('.log.json'))
    .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.full ?? null;
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

interface OrchestratorInput {
  target?: string;
  preset?: string;
  patternIds?: string[];
  prompt?: string;
  samplePath?: string;
  skipProof?: boolean;
  skipStorage?: boolean;
  skipOnChain?: boolean;
  allowUnverified?: boolean;
  writeProverToml?: boolean;
}

interface OrchestratorOutput {
  commitment: string;
  targetHash: string | null;
  targetHashes?: string[];
  prompt: string;
  provider: string;
  model: string;
  storageRoot: string | null;
  txHash: string | null;
  proofTimeMs: number | null;
  attestationValid: boolean | null;
}

/**
 * Generate ZK proof using the SDK (noir_js + bb.js).
 */
async function generateZkProof(
  promptBytes: Uint8Array,
  targetBytes: Uint8Array
): Promise<{ proofBytes: Uint8Array; commitment: string; targetHash: string; proofTimeMs: number }> {
  const generateProof = await loadProofGenerator();
  if (!generateProof) {
    throw new Error(
      'Proof generator not available. Build the SDK first:\n' +
      '  cd /path/to/GhostProver && npm run build'
    );
  }

  console.log('[orchestrator] generating ZK proof via SDK...');
  const result = await generateProof({ promptBytes, targetBytes });
  console.log(`[orchestrator] proof generated in ${result.proofTimeMs}ms (${result.proof.length} bytes)`);

  return {
    proofBytes: result.proof,
    commitment: result.commitment,
    targetHash: result.targetHash,
    proofTimeMs: result.proofTimeMs,
  };
}

async function generateZkBatchProofs(
  promptBytes: Uint8Array,
  preset?: string,
  patternIds?: string[],
): Promise<{
  proofs: Uint8Array[];
  commitment: string;
  targetHashes: string[];
  proofTimeMs: number;
}> {
  const generateBatchProofs = await loadBatchProofGenerator();
  if (!generateBatchProofs) {
    throw new Error(
      'Batch proof generator not available. Build the SDK first:\n' +
      '  cd /path/to/GhostProver && npm run build',
    );
  }

  console.log('[orchestrator] generating batch ZK proofs via SDK...');
  const result = await generateBatchProofs({
    promptBytes,
    preset,
    patternIds,
    concurrency: Number(process.env.GHOSTPROVER_PROOF_CONCURRENCY ?? '1'),
  });

  const failures = result.results.filter((item) => item.status !== 'done');
  if (failures.length > 0) {
    throw new Error(
      'Batch proof generation failed: ' +
        failures.map((item) => `${item.patternId}: ${item.error ?? 'unknown error'}`).join('; '),
    );
  }

  return {
    proofs: result.results.map((item) => item.proof!.proof),
    commitment: result.commitment,
    targetHashes: result.results.map((item) => item.proof!.targetHash),
    proofTimeMs: result.totalTimeMs,
  };
}

/**
 * Submit receipt to GhostProverRegistry on-chain.
 */
async function submitOnChain(
  proofBytes: Uint8Array,
  commitment: string,
  targetHash: string,
  provider: string,
  model: string,
  storageRoot: string
): Promise<string> {
  if (!REGISTRY_ADDRESS) {
    throw new Error('REGISTRY_ADDRESS not set in environment');
  }

  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error('PRIVATE_KEY required for on-chain submission');
  }

  const rpcProvider = new ethers.JsonRpcProvider(ZG_RPC_URL);
  const wallet = new ethers.Wallet(pk, rpcProvider);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

  console.log('[orchestrator] submitting receipt on-chain...');
  console.log(`[orchestrator] registry: ${REGISTRY_ADDRESS}`);
  console.log(`[orchestrator] commitment: ${commitment}`);
  console.log(`[orchestrator] targetHash: ${targetHash}`);
  console.log(`[orchestrator] storageRoot: ${storageRoot}`);

  const tx = await registry.submitReceipt(
    ethers.hexlify(proofBytes),
    commitment,
    targetHash,
    provider || ethers.ZeroAddress,
    model || '',
    storageRoot || ethers.ZeroHash
  );

  const receipt = await tx.wait();
  console.log(`[orchestrator] receipt submitted: ${tx.hash}`);
  return tx.hash;
}

async function submitBatchOnChain(
  proofs: Uint8Array[],
  commitment: string,
  targetHashes: string[],
  provider: string,
  model: string,
  storageRoot: string
): Promise<string> {
  if (!REGISTRY_ADDRESS) {
    throw new Error('REGISTRY_ADDRESS not set in environment');
  }

  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error('PRIVATE_KEY required for on-chain submission');
  }

  const rpcProvider = new ethers.JsonRpcProvider(ZG_RPC_URL);
  const wallet = new ethers.Wallet(pk, rpcProvider);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

  console.log('[orchestrator] submitting batch receipt on-chain...');
  console.log(`[orchestrator] registry: ${REGISTRY_ADDRESS}`);
  console.log(`[orchestrator] commitment: ${commitment}`);
  console.log(`[orchestrator] target hashes: ${targetHashes.length}`);
  console.log(`[orchestrator] storageRoot: ${storageRoot}`);

  const tx = await registry.submitBatchReceipt(
    proofs.map((proof) => ethers.hexlify(proof)),
    commitment,
    targetHashes,
    provider || ethers.ZeroAddress,
    model || '',
    storageRoot || ethers.ZeroHash
  );

  await tx.wait();
  console.log(`[orchestrator] batch receipt submitted: ${tx.hash}`);
  return tx.hash;
}

/**
 * Main orchestrator pipeline.
 */
export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const { target, preset, patternIds, skipProof, skipStorage, skipOnChain, allowUnverified } = input;
  const batchMode = Boolean(preset || patternIds?.length);
  if (!batchMode && !target) {
    throw new Error('Exact-mode orchestration requires --target, or use --preset/--patterns for batch mode.');
  }

  // Step 1: Load inference log
  let prompt = input.prompt;
  let samplePath = input.samplePath;
  let inferenceLog: Record<string, unknown> = {};
  let provider = '';
  let model = '';
  let zerogAuth: ZerogAuthEnvelope | null = null;

  if (!prompt) {
    samplePath = samplePath ?? findLatestSample() ?? undefined;
    if (!samplePath) {
      throw new Error('No prompt provided and no inference log found. Run inference:mock first.');
    }
    inferenceLog = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    prompt = inferenceLog.prompt as string;
    provider = (inferenceLog.provider as string) ?? '';
    model = (inferenceLog.model as string) ?? '';
    zerogAuth = (inferenceLog.zerogAuth as { parsed?: ZerogAuthEnvelope })?.parsed ?? null;
    console.log(`[orchestrator] loaded inference log: ${samplePath}`);
  }

  if (!prompt) {
    throw new Error('No prompt found in inference log');
  }

  // Step 2: Compute commitments
  const { bytes: promptBytes } = padBytes(prompt, PROMPT_MAX);
  const { bytes: targetBytes } = target ? padBytes(target, TARGET_MAX) : { bytes: [] };
  const commitment = toHex32(hashBytes(promptBytes));
  const targetHash = target ? toHex32(hashBytes(targetBytes)) : null;

  console.log(`[orchestrator] commitment: ${commitment}`);
  if (targetHash) console.log(`[orchestrator] targetHash: ${targetHash}`);

  // Step 3: Verify TEE attestation (if available)
  let attestationValid: boolean | null = null;
  if (typeof inferenceLog.teeVerified === 'boolean') {
    attestationValid = inferenceLog.teeVerified as boolean;
    console.log(`[orchestrator] SDK TEE verification from sample: ${attestationValid}`);
  }
  if (zerogAuth) {
    const result = verifyInferenceLog(inferenceLog as Parameters<typeof verifyInferenceLog>[0]);
    console.log(`[orchestrator] zerogAuth diagnostic verification: ${result?.valid ?? null}`);
    if (!attestationValid && result?.error) {
      console.warn(`[orchestrator] attestation error: ${result.error}`);
    }
  }

  const isLiveSample = Boolean(samplePath && !inferenceLog.mock);
  if (isLiveSample && attestationValid !== true && !allowUnverified) {
    throw new Error(
      'Live 0G inference sample is not TEE-verified. Refusing to generate/on-chain-submit ' +
        'a compliance receipt. Pass --allow-unverified only for diagnostics.',
    );
  }

  if (input.writeProverToml && target && targetHash) {
    const proverToml = generateProverToml(prompt, target, commitment, targetHash, samplePath ?? 'inline');
    const proverPath = path.resolve('..', 'Circuit', 'ghostprover', 'Prover.toml');
    fs.writeFileSync(proverPath, proverToml);
    console.log(`[orchestrator] wrote ${proverPath}`);
  }

  // Step 5: Generate ZK proof
  let proofBytes: Uint8Array | null = null;
  let batchProofBytes: Uint8Array[] | null = null;
  let targetHashes: string[] = targetHash ? [targetHash] : [];
  let proofTimeMs: number | null = null;
  if (!skipProof) {
    const promptBytesRaw = new TextEncoder().encode(prompt);
    if (batchMode) {
      const result = await generateZkBatchProofs(promptBytesRaw, preset, patternIds);
      batchProofBytes = result.proofs;
      proofTimeMs = result.proofTimeMs;
      targetHashes = result.targetHashes;
      if (result.commitment !== commitment) {
        console.warn('[orchestrator] commitment mismatch between bridge and SDK!');
        console.warn(`  bridge: ${commitment}`);
        console.warn(`  SDK:    ${result.commitment}`);
      }
    } else {
      const targetBytesRaw = new TextEncoder().encode(target!);
      const result = await generateZkProof(promptBytesRaw, targetBytesRaw);
      proofBytes = result.proofBytes;
      proofTimeMs = result.proofTimeMs;
      // The SDK computes commitment/targetHash internally and they should match
      if (result.commitment !== commitment || result.targetHash !== targetHash) {
        console.warn('[orchestrator] commitment mismatch between bridge and SDK!');
        console.warn(`  bridge: ${commitment} / ${targetHash}`);
        console.warn(`  SDK:    ${result.commitment} / ${result.targetHash}`);
      }
    }
  }

  // Step 6: Upload audit bundle to 0G Storage
  let storageRoot: string | null = null;
  if (!skipStorage) {
    const bundle: AuditBundle = {
      inferenceLog,
      publicInputs: { commitment, targetHash: targetHash ?? targetHashes[0] ?? ethers.ZeroHash },
      createdAt: new Date().toISOString(),
      proofHex: proofBytes !== null ? ethers.hexlify(proofBytes) : undefined,
      proofHexes: batchProofBytes?.map((proof) => ethers.hexlify(proof)),
      targetHashes,
    };

    try {
      const uploadResult = await uploadAuditBundle(bundle);
      storageRoot = uploadResult.rootHash;
      console.log(`[orchestrator] storage root: ${storageRoot}`);
    } catch (error) {
      console.warn(`[orchestrator] storage upload failed: ${error}`);
      const mainnet =
        process.env.ZG_NETWORK?.toLowerCase() === 'mainnet' ||
        (ZG_RPC_URL.includes('evmrpc.0g.ai') && !ZG_RPC_URL.includes('testnet'));
      if (mainnet && process.env.ALLOW_LOCAL_STORAGE_ROOT !== 'true') {
        throw new Error(
          '0G Storage upload failed on mainnet; refusing to submit a receipt with a local-only root. ' +
            'Set ALLOW_LOCAL_STORAGE_ROOT=true only for diagnostics.',
        );
      }
      // Compute root locally as fallback
      storageRoot = await computeStorageRoot(bundle);
      console.log(`[orchestrator] computed storage root (not uploaded): ${storageRoot}`);
    }
  }

  // Step 7: Submit on-chain receipt
  let txHash: string | null = null;
  if (!skipOnChain && storageRoot) {
    if (batchProofBytes) {
      txHash = await submitBatchOnChain(
        batchProofBytes,
        commitment,
        targetHashes,
        provider,
        model,
        storageRoot
      );
    } else if (proofBytes && targetHash) {
      txHash = await submitOnChain(
        proofBytes,
        commitment,
        targetHash,
        provider,
        model,
        storageRoot
      );
    }
  }

  return {
    commitment,
    targetHash,
    targetHashes,
    prompt,
    provider,
    model,
    storageRoot,
    txHash,
    proofTimeMs,
    attestationValid,
  };
}

// ---------------------------------------------------------------------------
// Prover.toml generation (duplicated from bridge.ts for self-containment)
// ---------------------------------------------------------------------------

function tomlByteArray(name: string, bytes: number[]): string {
  const lines = [`${name} = [`];
  for (const b of bytes) lines.push(`    ${b},`);
  lines.push(']');
  return lines.join('\n');
}

function generateProverToml(
  prompt: string,
  target: string,
  commitment: string,
  targetHash: string,
  source: string
): string {
  const promptPadded = padBytes(prompt, PROMPT_MAX);
  const targetPadded = padBytes(target, TARGET_MAX);

  return [
    '# GhostProver - Prover.toml (auto-generated by orchestrator)',
    '# DO NOT EDIT MANUALLY',
    '#',
    `# Source: ${source}`,
    `# Prompt: ${JSON.stringify(prompt.slice(0, 80))}...`,
    `# Target: ${JSON.stringify(target)}`,
    '',
    '# --- Private inputs ---',
    '',
    tomlByteArray('prompt_bytes', promptPadded.bytes),
    '',
    tomlByteArray('target_bytes', targetPadded.bytes),
    '',
    `target_len = ${targetPadded.actualLen}`,
    `prompt_len = ${promptPadded.actualLen}`,
    '',
    '# --- Public inputs ---',
    '',
    `commitment = "${commitment}"`,
    `target_hash = "${targetHash}"`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const out: OrchestratorInput = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--target') { out.target = v; i++; }
    else if (k === '--preset') { out.preset = v; i++; }
    else if (k === '--patterns') { out.patternIds = v.split(',').map((item) => item.trim()).filter(Boolean); i++; }
    else if (k === '--prompt') { out.prompt = v; i++; }
    else if (k === '--sample') { out.samplePath = v; i++; }
    else if (k === '--skip-proof') { out.skipProof = true; }
    else if (k === '--skip-storage') { out.skipStorage = true; }
    else if (k === '--skip-onchain') { out.skipOnChain = true; }
    else if (k === '--allow-unverified') { out.allowUnverified = true; }
    else if (k === '--write-prover-toml') { out.writeProverToml = true; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.target && !args.preset && !args.patternIds?.length) {
    console.error('Usage: npm run orchestrate -- (--target "<sensitive field>" | --preset <preset> | --patterns id,id) [options]');
    console.error('Options:');
    console.error('  --prompt "<text>"     Override prompt (instead of loading from sample)');
    console.error('  --sample <path>       Path to inference log');
    console.error('  --preset <name>       Generate and submit a batch receipt for a preset');
    console.error('  --patterns a,b        Generate and submit a batch receipt for pattern IDs');
    console.error('  --skip-proof          Skip ZK proof generation');
    console.error('  --skip-storage        Skip 0G Storage upload');
    console.error('  --skip-onchain        Skip on-chain receipt submission');
    console.error('  --allow-unverified    Do not block on failed live TEE verification');
    console.error('  --write-prover-toml   Also write Circuit/ghostprover/Prover.toml');
    process.exit(1);
  }

  const result = await orchestrate(args);

  console.log('\n=== Orchestration Complete ===');
  console.log(JSON.stringify(result, null, 2));
}

// Only execute CLI when this module is the entry point, not when imported.
const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return import.meta.url.endsWith(argv1.replace(/\\/g, '/').split('/').pop() ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
