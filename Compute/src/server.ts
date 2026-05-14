/**
 * GhostProver REST API server.
 *
 * Wraps the orchestrator pipeline in HTTP endpoints for the frontend.
 *
 * Endpoints:
 *   GET  /api/health             — server + config status
 *   GET  /api/samples            — list available inference logs
 *   POST /api/inference/mock     — generate a fresh mock inference log
 *   POST /api/prove              — run full pipeline (proof + storage + on-chain)
 *   POST /api/prove/stream       — same as /api/prove but with SSE progress
 *   GET  /api/receipt/:txHash    — fetch on-chain receipt details
 *
 * Run:
 *   npm run server
 *
 * Environment:
 *   PORT                — default 8787
 *   REGISTRY_ADDRESS    — GhostProverRegistry contract address
 *   ZG_RPC_URL          — 0G Chain RPC (or local Anvil http://127.0.0.1:8545)
 *   PRIVATE_KEY         — wallet for on-chain tx
 *   ZG_INDEXER_URL      — 0G Storage indexer (optional, defaults to testnet)
 */
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { ethers } from 'ethers';
import { orchestrate } from './orchestrator.js';

const PORT = Number(process.env.PORT ?? 8787);
const SAMPLES_DIR = path.resolve(process.cwd(), 'samples');

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

// -----------------------------------------------------------------------------
// GET /api/health
// -----------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    registry: process.env.REGISTRY_ADDRESS ?? null,
    rpc: process.env.ZG_RPC_URL ?? 'http://127.0.0.1:8545',
    indexer: process.env.ZG_INDEXER_URL ?? 'https://indexer-storage-testnet-standard.0g.ai',
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
        attestationValid: log.zerogAuth?.parsed?.signature ? true : false,
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
  const { prompt, target, samplePath, skipProof, skipStorage, skipOnChain } = req.body ?? {};
  if (!target || typeof target !== 'string') {
    res.status(400).json({ error: 'target is required (string)' });
    return;
  }

  try {
    const result = await orchestrate({
      prompt,
      target,
      samplePath,
      skipProof: Boolean(skipProof),
      skipStorage: Boolean(skipStorage),
      skipOnChain: Boolean(skipOnChain),
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
  const { prompt, target, samplePath, skipStorage, skipOnChain } = req.body ?? {};
  if (!target || typeof target !== 'string') {
    res.status(400).json({ error: 'target is required (string)' });
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
    'wrote': { stage: 'prover.toml', progress: 45 },
    'generating ZK proof': { stage: 'proof', progress: 55 },
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
      samplePath,
      skipStorage: Boolean(skipStorage),
      skipOnChain: Boolean(skipOnChain),
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
// GET /api/receipt/:txHash — fetch on-chain receipt event
// -----------------------------------------------------------------------------
const RECEIPT_EVENT_ABI = [
  'event ComplianceReceiptIssued(address indexed submitter,bytes32 commitment,bytes32 targetHash,address indexed provider,string model,bytes32 storageRoot,uint256 timestamp)',
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
              provider: parsed.args.provider,
              model: parsed.args.model,
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
