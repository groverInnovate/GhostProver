import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { generateProof } from '../dist/index.js';
import { DEMO_LIMITATIONS, DEMO_PROMPT, DEMO_TARGET } from './demo-config.mjs';

const DEFAULT_RPC_URL = process.env.DEMO_RPC_URL ?? 'http://127.0.0.1:8545';
const DEFAULT_PRIVATE_KEY =
  process.env.DEMO_PRIVATE_KEY ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const REGISTRY_ABI = [
  'function submitReceipt(bytes proof, bytes32 commitment, bytes32 targetHash, address providerAddress, string modelId, bytes32 storageRoot) external',
  'event ComplianceReceiptIssued(bytes32 indexed commitment, bytes32 indexed targetHash, address indexed submitter, address providerAddress, string modelId, bytes32 storageRoot, uint256 timestamp)',
];
const RECEIPT_TOPIC = ethers.id(
  'ComplianceReceiptIssued(bytes32,bytes32,address,address,string,bytes32,uint256)'
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploymentPath = path.join(repoRoot, 'Chain', 'deployments', 'local.json');
if (!fs.existsSync(deploymentPath)) {
  throw new Error(`Missing deployment file at ${deploymentPath}. Run the Foundry deployment script first.`);
}

console.log('[demo-mode] This flow is local-only and intentionally not full integration.');
console.log('[demo-limitations]');
for (const limitation of DEMO_LIMITATIONS) {
  console.log(`  - ${limitation}`);
}

const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL);
const wallet = new ethers.Wallet(DEFAULT_PRIVATE_KEY, provider);
const registry = new ethers.Contract(deployment.registry, REGISTRY_ABI, wallet);

console.log('[network]', await provider.getNetwork());
console.log('[wallet]', await wallet.getAddress());
console.log('[deployment]', deployment);

const promptBytes = new TextEncoder().encode(DEMO_PROMPT);
const targetBytes = new TextEncoder().encode(DEMO_TARGET);
const result = await generateProof({ promptBytes, targetBytes });

console.log('[proof]');
console.log('  commitment =', result.commitment);
console.log('  targetHash =', result.targetHash);
console.log('  proofBytes =', result.proof.length);
console.log('  proofTimeMs =', result.proofTimeMs);

const tx = await registry.submitReceipt(
  ethers.hexlify(result.proof),
  result.commitment,
  result.targetHash,
  ethers.ZeroAddress,
  '',
  ethers.ZeroHash
);
const receipt = await tx.wait();
console.log('[success-tx]', tx.hash);

const registryLog = receipt.logs.find(
  (log) =>
    log.address.toLowerCase() === deployment.registry.toLowerCase() &&
    log.topics[0] === RECEIPT_TOPIC
);

if (!registryLog) {
  throw new Error('Expected ComplianceReceiptIssued event not found.');
}

const decodedEvent = registry.interface.decodeEventLog(
  'ComplianceReceiptIssued',
  registryLog.data,
  registryLog.topics
);
console.log('[receipt-event]', decodedEvent);

try {
  await registry.submitReceipt(
    ethers.hexlify(result.proof),
    result.commitment,
    ethers.toBeHex(BigInt(result.targetHash) ^ 1n, 32),
    ethers.ZeroAddress,
    '',
    ethers.ZeroHash
  );
  throw new Error('Tampered target hash unexpectedly succeeded.');
} catch (error) {
  const message = String(error?.shortMessage ?? error?.message ?? error);
  console.log('[expected-failure]', message);
}
