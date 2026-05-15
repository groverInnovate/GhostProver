import * as http from "http";
import { createHash, randomUUID } from "crypto";
import { URL } from "url";
import { generateBatchProofs, scanPatternIds } from "../batch-prover.js";
import { computeCommitment } from "../ghostprover.js";
import {
  loadEffectiveRegistry,
  loadGhostProverConfig,
  publicConfig,
  resolvePolicyPatternIds,
  type EffectiveGhostProverConfig,
} from "./config.js";
import { LocalStore, type StoredJob, type StoredReceipt } from "./local-store.js";
import type { PatternRegistry } from "../registry/index.js";

interface DaemonOptions {
  cwd?: string;
  configPath?: string;
  port?: number;
}

interface ScanRequest {
  prompt?: string;
  preset?: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
}

interface ScanResponse {
  commitment: string;
  preset?: string;
  patternIds: string[];
  byteLength: number;
  clean: boolean;
  blocked: boolean;
  matches: { id: string; name: string; offset?: number }[];
  results: { id: string; name: string; matched: boolean; matchOffset?: number }[];
}

type SseClient = http.ServerResponse;

/**
 * Start the local GhostProver compliance agent.
 *
 * The daemon is the source of truth for local integrations: the React console
 * reads from it, MCP tools call it, and future editor/proxy integrations can
 * reuse the same scan/attest contract.
 */
export async function startDaemon(options: DaemonOptions = {}): Promise<http.Server> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadGhostProverConfig(cwd, options.configPath);
  const registry = loadEffectiveRegistry(config);
  const store = new LocalStore(config.storageDir);
  store.ensure();

  const state = {
    config: {
      ...config,
      daemon: {
        ...config.daemon,
        port: options.port ?? config.daemon.port,
      },
    },
    registry,
    store,
    clients: new Set<SseClient>(),
  };

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res, state);
    } catch (err) {
      sendJson(res, 500, {
        error: (err as Error).message,
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(state.config.daemon.port, state.config.daemon.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(
    `[GhostProver daemon] listening on http://${state.config.daemon.host}:${state.config.daemon.port}`
  );
  console.log(`[GhostProver daemon] policy preset=${state.config.preset} storage=${state.config.storageDir}`);
  return server;
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: {
    config: EffectiveGhostProverConfig;
    registry: PatternRegistry;
    store: LocalStore;
    clients: Set<SseClient>;
  }
) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "ghostprover-daemon" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/config") {
    sendJson(res, 200, publicConfig(state.config, state.registry));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/presets") {
    sendJson(res, 200, {
      presets: state.registry.presets,
      patterns: state.registry.patterns,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/events") {
    openSse(res, state.clients);
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/receipts") {
    sendJson(res, 200, { receipts: state.store.listReceipts() });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
    const id = decodeURIComponent(url.pathname.replace("/v1/jobs/", ""));
    const job = state.store.getJob(id);
    if (!job) {
      sendJson(res, 404, { error: `Job not found: ${id}` });
      return;
    }
    sendJson(res, 200, { job });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/scan") {
    const body = await readJson<ScanRequest>(req);
    sendJson(res, 200, scanRequest(body, state.config, state.registry));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/attest") {
    const body = await readJson<ScanRequest>(req);
    const scan = scanRequest(body, state.config, state.registry);

    if (scan.blocked) {
      const job = createJob("blocked", scan, body.metadata);
      state.store.appendJob(job);
      broadcast(state.clients, "job", job);
      sendJson(res, 200, { blocked: true, scan, job });
      return;
    }

    const job = createJob("queued", scan, body.metadata);
    state.store.appendJob(job);
    broadcast(state.clients, "job", job);
    sendJson(res, 202, { blocked: false, scan, job });

    if (state.config.proofMode !== "scan_only") {
      void runProofJob(job, body.prompt ?? "", state);
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

/**
 * Convert a prompt into policy results without generating proofs.
 * Proof generation is deliberately gated behind `/v1/attest` so callers can
 * use fast scans in interactive UX and reserve bb.js work for clean prompts.
 */
function scanRequest(
  body: ScanRequest,
  config: EffectiveGhostProverConfig,
  registry: PatternRegistry
): ScanResponse {
  const prompt = body.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error("Request body must include a non-empty string prompt");
  }

  const promptBytes = new TextEncoder().encode(prompt).slice(0, 512);
  const preset = body.preset ?? config.preset;
  const patternIds = body.patterns?.length
    ? body.patterns
    : preset === config.preset
      ? resolvePolicyPatternIds(config, registry)
      : registry.presets[preset]?.patterns;

  if (!patternIds?.length) {
    throw new Error(`No patterns configured for preset "${preset}"`);
  }

  const results = scanPatternIds(promptBytes, patternIds, registry);
  const matches = results
    .filter((result) => result.matched)
    .map((result) => ({
      id: result.id,
      name: result.name,
      offset: result.matchOffset,
    }));
  const clean = matches.length === 0;

  return {
    commitment: computeCommitment(promptBytes),
    preset,
    patternIds,
    byteLength: promptBytes.length,
    clean,
    blocked: !clean && config.blockOnDetection,
    matches,
    results,
  };
}

function createJob(
  status: StoredJob["status"],
  scan: ScanResponse,
  metadata?: Record<string, unknown>
): StoredJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status,
    preset: scan.preset,
    patternIds: scan.patternIds,
    commitment: scan.commitment,
    scan: {
      clean: scan.clean,
      matches: scan.matches,
      results: scan.results,
    },
    progress: [],
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Run one background proof job. Progress is persisted and emitted over SSE so
 * the UI can update live while JSONL remains the durable recovery source.
 */
async function runProofJob(
  job: StoredJob,
  prompt: string,
  state: {
    config: EffectiveGhostProverConfig;
    registry: PatternRegistry;
    store: LocalStore;
    clients: Set<SseClient>;
  }
) {
  let current = updateJob(job, { status: "proving" });
  state.store.appendJob(current);
  broadcast(state.clients, "job", current);

  try {
    const promptBytes = new TextEncoder().encode(prompt).slice(0, 512);
    const result = await generateBatchProofs({
      promptBytes,
      patternIds: current.patternIds,
      concurrency: state.config.concurrency,
      registry: state.registry,
      onProgress: (patternId, status, detail) => {
        current = {
          ...current,
          progress: [
            ...current.progress,
            { patternId, status, detail, at: new Date().toISOString() },
          ],
          updatedAt: new Date().toISOString(),
        };
        state.store.appendJob(current);
        broadcast(state.clients, "job", current);
      },
    });

    const receipt = createReceipt(current, result.results);
    current = updateJob(current, { status: "done", receiptId: receipt.id });
    state.store.appendReceipt(receipt);
    state.store.appendJob(current);
    broadcast(state.clients, "receipt", receipt);
    broadcast(state.clients, "job", current);
  } catch (err) {
    current = updateJob(current, {
      status: "failed",
      error: (err as Error).message,
    });
    state.store.appendJob(current);
    broadcast(state.clients, "job", current);
  }
}

function updateJob(job: StoredJob, patch: Partial<StoredJob>): StoredJob {
  return {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Local receipt shape mirrors the future 0G bundle: commitment, target hashes,
 * proof statuses, and a storage root. For now the root is a SHA-256 digest of
 * the local audit bundle; live 0G Storage can replace this adapter later.
 */
function createReceipt(
  job: StoredJob,
  results: {
    patternId: string;
    patternName: string;
    status: "done" | "failed";
    proof?: { targetHash: string; proof: Uint8Array };
    error?: string;
    proofTimeMs: number;
  }[]
): StoredReceipt {
  const createdAt = new Date().toISOString();
  const proofStatuses = results.map((result) => ({
    patternId: result.patternId,
    patternName: result.patternName,
    status: result.status,
    proofSize: result.proof?.proof.length ?? 0,
    proofTimeMs: result.proofTimeMs,
    error: result.error,
  }));
  const targetHashes = results
    .map((result) => result.proof?.targetHash)
    .filter((hash): hash is string => Boolean(hash));
  const auditBundle = {
    jobId: job.id,
    preset: job.preset,
    commitment: job.commitment,
    targetHashes,
    proofStatuses,
    createdAt,
  };

  return {
    id: randomUUID(),
    jobId: job.id,
    preset: job.preset,
    patternIds: job.patternIds,
    commitment: job.commitment,
    targetHashes,
    proofStatuses,
    storageRoot: sha256Hex(JSON.stringify(auditBundle)),
    status: "local",
    createdAt,
  };
}

function sha256Hex(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

function setCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  if (!res.headersSent) {
    setCors(res);
    res.writeHead(status, { "Content-Type": "application/json" });
  }
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function openSse(res: http.ServerResponse, clients: Set<SseClient>) {
  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

function broadcast(clients: Set<SseClient>, event: string, payload: unknown) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}
