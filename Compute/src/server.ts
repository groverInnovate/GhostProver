/**
 * GhostProver REST API server.
 *
 * Wraps the orchestrator pipeline in HTTP endpoints for the frontend.
 *
 * Endpoints:
 *   GET  /api/health             — server + config status
 *   GET  /api/samples            — list available inference logs
 *   POST /api/inference/mock     — generate a fresh mock inference log
 *   POST /api/live-receipt/stream — run live inference + proof + storage + chain with SSE
 *   POST /api/prove              — run full pipeline (proof + storage + on-chain)
 *   POST /api/prove/stream       — same as /api/prove but with SSE progress
 *   GET  /api/receipt/:txHash    — fetch on-chain receipt details
 *
 * Run:
 *   npm run server
 *
 * Environment:
 *   PORT                — default 8790
 *   REGISTRY_ADDRESS    — GhostProverRegistry contract address
 *   ZG_RPC_URL          — 0G Chain RPC (or local Anvil http://127.0.0.1:8545)
 *   PRIVATE_KEY         — wallet for on-chain tx
 *   ZG_INDEXER_URL      — 0G Storage indexer (optional, network-aware default)
 */
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ethers } from 'ethers';
import { orchestrate } from './orchestrator.js';

const PORT = Number(process.env.PORT ?? 8790);
const SAMPLES_DIR = path.resolve(process.cwd(), 'samples');
const DEFAULT_INDEXER =
  process.env.ZG_INDEXER_URL ??
  ((process.env.ZG_NETWORK?.toLowerCase() === 'mainnet' ||
    (process.env.ZG_RPC_URL?.includes('evmrpc.0g.ai') && !process.env.ZG_RPC_URL.includes('testnet')))
    ? 'https://indexer-storage-turbo.0g.ai'
    : 'https://indexer-storage-testnet-standard.0g.ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// In-memory job tracker for SSE / status queries
type Job = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  stage: string;
  progress: number; // 0..100
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
  logs: { ts: number; level: 'info' | 'warn' | 'error'; msg: string }[];
};
const jobs = new Map<string, Job>();

function newJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function appendLog(job: Job, level: Job['logs'][number]['level'], msg: string) {
  job.logs.push({ ts: Date.now(), level, msg });
  if (job.logs.length > 200) job.logs.shift();
}

function extractSavedSamplePath(output: string): string | null {
  const match = output.match(/\[saved\]\s+(.+\.log\.json)/);
  return match?.[1]?.trim() ?? null;
}

function extractAssistantResponse(log: Record<string, unknown>): string {
  const body = (log.response as { body?: unknown } | undefined)?.body;
  if (body && typeof body === 'object') {
    const choices = (body as { choices?: unknown[] }).choices;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    if (first && typeof first === 'object') {
      const message = (first as { message?: { content?: unknown } }).message;
      if (typeof message?.content === 'string') return message.content;
    }
  }
  return typeof body === 'string' ? body : '';
}

function sha256Hex(value: string): string {
  return `0x${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function walletAuthorizationMessage(address: string, promptHash: string, patternIds: string[], signedAt: string): string {
  return [
    'GhostProver Live 0G Receipt Authorization',
    '',
    `Wallet: ${address}`,
    `Prompt SHA-256: ${promptHash}`,
    `Proof targets: ${[...patternIds].sort().join(',')}`,
    `Timestamp: ${signedAt}`,
    'Network: 0G Mainnet',
  ].join('\n');
}

function normalizePatternIds(patterns: unknown): string[] {
  if (!Array.isArray(patterns)) return [];
  return [...new Set(patterns.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function verifyWalletAuthorization(input: {
  prompt: string;
  patternIds: string[];
  walletAddress?: unknown;
  walletSignature?: unknown;
  walletMessage?: unknown;
  walletSignedAt?: unknown;
  promptHash?: unknown;
}): { walletAddress: string; walletSignature: string; walletMessage: string; walletSignedAt: string; promptHash: string } {
  const { prompt, patternIds } = input;
  if (!patternIds.length) throw new Error('at least one proof target is required');
  if (typeof input.walletAddress !== 'string' || !ethers.isAddress(input.walletAddress)) {
    throw new Error('valid walletAddress is required');
  }
  if (typeof input.walletSignature !== 'string' || !input.walletSignature.startsWith('0x')) {
    throw new Error('walletSignature is required');
  }
  if (typeof input.walletMessage !== 'string') throw new Error('walletMessage is required');
  if (typeof input.walletSignedAt !== 'string') throw new Error('walletSignedAt is required');
  if (typeof input.promptHash !== 'string') throw new Error('promptHash is required');

  const expectedPromptHash = sha256Hex(prompt);
  if (input.promptHash.toLowerCase() !== expectedPromptHash.toLowerCase()) {
    throw new Error('wallet authorization prompt hash does not match submitted prompt');
  }

  const signedAtMs = Date.parse(input.walletSignedAt);
  if (!Number.isFinite(signedAtMs)) throw new Error('walletSignedAt must be an ISO timestamp');
  const ageMs = Math.abs(Date.now() - signedAtMs);
  if (ageMs > 10 * 60 * 1000) throw new Error('wallet authorization has expired');

  const expectedMessage = walletAuthorizationMessage(
    input.walletAddress,
    expectedPromptHash,
    patternIds,
    input.walletSignedAt
  );
  if (input.walletMessage !== expectedMessage) {
    throw new Error('wallet authorization message does not match prompt and proof targets');
  }

  const recovered = ethers.verifyMessage(input.walletMessage, input.walletSignature);
  if (recovered.toLowerCase() !== input.walletAddress.toLowerCase()) {
    throw new Error('wallet signature does not match walletAddress');
  }

  return {
    walletAddress: ethers.getAddress(input.walletAddress),
    walletSignature: input.walletSignature,
    walletMessage: input.walletMessage,
    walletSignedAt: input.walletSignedAt,
    promptHash: expectedPromptHash,
  };
}

// -----------------------------------------------------------------------------
// GET /api/health
// -----------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    registry: process.env.REGISTRY_ADDRESS ?? null,
    rpc: process.env.ZG_RPC_URL ?? 'https://evmrpc.0g.ai',
    indexer: DEFAULT_INDEXER,
    hasPrivateKey: Boolean(process.env.PRIVATE_KEY),
    samplesAvailable: fs.existsSync(SAMPLES_DIR) ? fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.log.json')).length : 0,
  });
});

// -----------------------------------------------------------------------------
// GET /api/samples
// -----------------------------------------------------------------------------
app.get('/api/samples', (_req, res) => {
  if (!fs.existsSync(SAMPLES_DIR)) {
    res.json({ samples: [] });
    return;
  }
  const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.log.json'));
  const samples = files.map((f) => {
    const full = path.join(SAMPLES_DIR, f);
    try {
      const log = JSON.parse(fs.readFileSync(full, 'utf8'));
      return {
        file: f,
        prompt: typeof log.prompt === 'string' ? log.prompt.slice(0, 160) : '',
        provider: log.provider ?? null,
        model: log.model ?? null,
        timestamp: log.timestamp ?? null,
        attestationValid: log.teeVerified === true || Boolean(log.zerogAuth?.parsed?.signature),
      };
    } catch {
      return { file: f, prompt: '', provider: null, model: null, timestamp: null, attestationValid: false };
    }
  });
  res.json({ samples });
});

// -----------------------------------------------------------------------------
// POST /api/inference/mock — generate a fresh mock log
// -----------------------------------------------------------------------------
app.post('/api/inference/mock', async (req, res) => {
  const { prompt } = req.body ?? {};
  const env = { ...process.env } as Record<string, string>;
  if (prompt && typeof prompt === 'string') {
    env.MOCK_PROMPT = prompt;
  }
  const proc = spawn('npm', ['run', 'inference:mock'], { cwd: process.cwd(), env });
  let out = '';
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.stderr.on('data', (d) => { out += d.toString(); });
  proc.on('close', (code) => {
    if (code !== 0) {
      res.status(500).json({ error: 'mock-inference failed', output: out });
      return;
    }
    // Find the most recent sample
    const files = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.log.json'));
    files.sort();
    const latest = files[files.length - 1];
    res.json({ file: latest, log: JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, latest), 'utf8')) });
  });
});

// -----------------------------------------------------------------------------
// POST /api/prove — run the pipeline, return result when done
// -----------------------------------------------------------------------------
app.post('/api/prove', async (req, res) => {
  const { prompt, target, preset, patterns, samplePath, skipProof, skipStorage, skipOnChain, allowUnverified } = req.body ?? {};
  if ((!target || typeof target !== 'string') && !preset && !Array.isArray(patterns)) {
    res.status(400).json({ error: 'target, preset, or patterns is required' });
    return;
  }

  try {
    const result = await orchestrate({
      prompt,
      target,
      preset,
      patternIds: Array.isArray(patterns) ? patterns : undefined,
      samplePath,
      skipProof: Boolean(skipProof),
      skipStorage: Boolean(skipStorage),
      skipOnChain: Boolean(skipOnChain),
      allowUnverified: Boolean(allowUnverified),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? String(err) });
  }
});

// -----------------------------------------------------------------------------
// POST /api/prove/stream — run the pipeline, stream progress via SSE
// -----------------------------------------------------------------------------
app.post('/api/prove/stream', async (req, res) => {
  const { prompt, target, preset, patterns, samplePath, skipStorage, skipOnChain, allowUnverified } = req.body ?? {};
  if ((!target || typeof target !== 'string') && !preset && !Array.isArray(patterns)) {
    res.status(400).json({ error: 'target, preset, or patterns is required' });
    return;
  }

  const jobId = newJobId();
  const job: Job = {
    id: jobId,
    status: 'queued',
    stage: 'init',
    progress: 0,
    startedAt: Date.now(),
    logs: [],
  };
  jobs.set(jobId, job);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Patch console.log to forward orchestrator logs to SSE
  const origLog = console.log;
  const origWarn = console.warn;
  const stageMap: Record<string, { stage: string; progress: number }> = {
    'loaded inference log': { stage: 'inference', progress: 15 },
    'commitment:': { stage: 'commitment', progress: 25 },
    'TEE attestation': { stage: 'attestation', progress: 35 },
    'generating ZK proof': { stage: 'proof', progress: 55 },
    'generating batch ZK proofs': { stage: 'proof', progress: 55 },
    'proof generated': { stage: 'proof-done', progress: 80 },
    'storage root': { stage: 'storage', progress: 90 },
    'receipt submitted': { stage: 'on-chain', progress: 98 },
  };

  const interceptor = (level: 'info' | 'warn' | 'error') => (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    appendLog(job, level, msg);
    for (const [key, val] of Object.entries(stageMap)) {
      if (msg.includes(key)) {
        job.stage = val.stage;
        job.progress = val.progress;
        send('progress', { stage: job.stage, progress: job.progress, msg });
        break;
      }
    }
    send('log', { level, msg });
    origLog(...args);
  };
  console.log = interceptor('info');
  console.warn = interceptor('warn');

  job.status = 'running';
  send('progress', { stage: 'init', progress: 5, msg: 'pipeline started' });

  try {
    const result = await orchestrate({
      prompt,
      target,
      preset,
      patternIds: Array.isArray(patterns) ? patterns : undefined,
      samplePath,
      skipStorage: Boolean(skipStorage),
      skipOnChain: Boolean(skipOnChain),
      allowUnverified: Boolean(allowUnverified),
    });
    job.status = 'done';
    job.stage = 'complete';
    job.progress = 100;
    job.result = result;
    job.finishedAt = Date.now();
    send('progress', { stage: 'complete', progress: 100, msg: 'pipeline complete' });
    send('result', result);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    job.status = 'error';
    job.error = message;
    job.finishedAt = Date.now();
    send('error', { error: message });
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    send('end', { jobId });
    res.end();
  }
});

// -----------------------------------------------------------------------------
// POST /api/live-receipt/stream — live 0G inference, attested proof, storage, chain
// -----------------------------------------------------------------------------
app.post('/api/live-receipt/stream', async (req, res) => {
  const {
    prompt,
    patterns,
    preset,
    skipStorage,
    skipOnChain,
    allowUnverified,
    walletAddress,
    walletSignature,
    walletMessage,
    walletSignedAt,
    promptHash,
  } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }
  if (!preset && !Array.isArray(patterns)) {
    res.status(400).json({ error: 'preset or patterns is required' });
    return;
  }
  const patternIds = normalizePatternIds(patterns);
  let walletAuth: ReturnType<typeof verifyWalletAuthorization>;
  try {
    walletAuth = verifyWalletAuthorization({
      prompt,
      patternIds,
      walletAddress,
      walletSignature,
      walletMessage,
      walletSignedAt,
      promptHash,
    });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message ?? String(err) });
    return;
  }

  const jobId = newJobId();
  const job: Job = {
    id: jobId,
    status: 'queued',
    stage: 'init',
    progress: 0,
    startedAt: Date.now(),
    logs: [],
  };
  jobs.set(jobId, job);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const progress = (stage: string, pct: number, msg: string) => {
    job.stage = stage;
    job.progress = pct;
    appendLog(job, 'info', msg);
    send('progress', { stage, progress: pct, msg });
  };
  const log = (level: Job['logs'][number]['level'], msg: string) => {
    appendLog(job, level, msg);
    send('log', { level, msg });
  };

  job.status = 'running';
  progress('inference', 8, 'starting live 0G inference');

  try {
    const inferenceProc = spawn('npm', ['run', 'inference', '--', prompt], {
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
    });
    let inferenceOutput = '';
    inferenceProc.stdout.on('data', (chunk) => {
      const msg = chunk.toString();
      inferenceOutput += msg;
      if (msg.includes('[verifyService]')) progress('tee-provider', 18, 'provider TEE service verification running');
      if (msg.includes('=== RAW RESPONSE ===')) progress('inference-response', 28, '0G inference response received');
      if (msg.includes('TEE signature valid = true')) progress('tee-response', 36, '0G response verification succeeded');
      if (msg.includes('[saved]')) progress('sample', 42, 'attested inference sample saved');
      log('info', msg);
    });
    inferenceProc.stderr.on('data', (chunk) => {
      const msg = chunk.toString();
      inferenceOutput += msg;
      log('warn', msg);
    });

    const inferenceCode = await new Promise<number | null>((resolve) => {
      inferenceProc.on('close', resolve);
    });
    if (inferenceCode !== 0) {
      throw new Error(`0G inference failed with exit code ${inferenceCode}`);
    }

    const samplePath = extractSavedSamplePath(inferenceOutput);
    if (!samplePath) {
      throw new Error('0G inference completed but did not print a saved sample path');
    }
    const inferenceLog = JSON.parse(fs.readFileSync(samplePath, 'utf8')) as Record<string, unknown>;
    inferenceLog.walletAuthorization = {
      walletAddress: walletAuth.walletAddress,
      walletSignature: walletAuth.walletSignature,
      walletMessage: walletAuth.walletMessage,
      walletSignedAt: walletAuth.walletSignedAt,
      promptHash: walletAuth.promptHash,
      proofTargets: patternIds,
      verifiedAt: new Date().toISOString(),
    };
    fs.writeFileSync(samplePath, JSON.stringify(inferenceLog, null, 2));
    send('sample', {
      samplePath,
      provider: inferenceLog.provider ?? null,
      model: inferenceLog.model ?? null,
      teeVerified: inferenceLog.teeVerified ?? null,
      response: extractAssistantResponse(inferenceLog),
      walletAddress: walletAuth.walletAddress,
    });

    progress('proof', 48, 'generating ZK proof from attested request body');

    const origLog = console.log;
    const origWarn = console.warn;
    const stageMap: Record<string, { stage: string; progress: number }> = {
      'loaded inference log': { stage: 'sample-bound', progress: 50 },
      'SDK TEE verification from sample: true': { stage: 'tee-bound', progress: 56 },
      'generating batch ZK proofs': { stage: 'proof', progress: 62 },
      'Proof generated': { stage: 'proof-done', progress: 75 },
      'upload success': { stage: 'storage', progress: 86 },
      'storage root': { stage: 'storage', progress: 88 },
      'batch receipt submitted': { stage: 'chain', progress: 96 },
      'receipt submitted': { stage: 'chain', progress: 96 },
    };
    const intercept = (level: Job['logs'][number]['level']) => (...args: unknown[]) => {
      const msg = args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ');
      appendLog(job, level, msg);
      for (const [key, val] of Object.entries(stageMap)) {
        if (msg.includes(key)) {
          send('progress', { stage: val.stage, progress: val.progress, msg });
          break;
        }
      }
      send('log', { level, msg });
      (level === 'warn' ? origWarn : origLog)(...args);
    };
    console.log = intercept('info');
    console.warn = intercept('warn');

    try {
      const result = await orchestrate({
        samplePath,
        preset,
        patternIds: patternIds.length ? patternIds : undefined,
        skipStorage: Boolean(skipStorage),
        skipOnChain: Boolean(skipOnChain),
        allowUnverified: Boolean(allowUnverified),
      });
      job.status = 'done';
      job.stage = 'complete';
      job.progress = 100;
      job.result = result;
      job.finishedAt = Date.now();
      send('progress', { stage: 'complete', progress: 100, msg: 'live 0G receipt complete' });
      send('result', {
        ...result,
        samplePath,
        response: extractAssistantResponse(inferenceLog),
        walletAddress: walletAuth.walletAddress,
        walletPromptHash: walletAuth.promptHash,
      });
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    job.status = 'error';
    job.error = message;
    job.finishedAt = Date.now();
    send('error', { error: message });
  } finally {
    send('end', { jobId });
    res.end();
  }
});

// -----------------------------------------------------------------------------
// GET /api/receipt/:txHash — fetch on-chain receipt event
// -----------------------------------------------------------------------------
const RECEIPT_EVENT_ABI = [
  'event ComplianceReceiptIssued(bytes32 indexed commitment,bytes32 indexed targetHash,address indexed submitter,address providerAddress,string modelId,bytes32 storageRoot,uint256 timestamp)',
  'event ComplianceBatchReceiptIssued(bytes32 indexed commitment,bytes32[] targetHashes,address indexed submitter,address providerAddress,string modelId,bytes32 storageRoot,uint256 timestamp)',
];

app.get('/api/receipt/:txHash', async (req, res) => {
  const rpc = process.env.ZG_RPC_URL ?? 'http://127.0.0.1:8545';
  try {
    const provider = new ethers.JsonRpcProvider(rpc);
    const receipt = await provider.getTransactionReceipt(req.params.txHash);
    if (!receipt) {
      res.status(404).json({ error: 'receipt not found' });
      return;
    }
    const iface = new ethers.Interface(RECEIPT_EVENT_ABI);
    const events: unknown[] = [];
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed) {
          events.push({
            name: parsed.name,
            args: {
              submitter: parsed.args.submitter,
              commitment: parsed.args.commitment,
              targetHash: parsed.args.targetHash,
              targetHashes: parsed.args.targetHashes,
              provider: parsed.args.providerAddress,
              model: parsed.args.modelId,
              storageRoot: parsed.args.storageRoot,
              timestamp: parsed.args.timestamp.toString(),
            },
          });
        }
      } catch {
        // not our event
      }
    }
    res.json({
      txHash: req.params.txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
      events,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? String(err) });
  }
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[server] health: http://127.0.0.1:${PORT}/api/health`);
});
