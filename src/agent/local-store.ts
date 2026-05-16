import * as fs from "fs";
import * as path from "path";

/**
 * Append-only local persistence for the background agent.
 *
 * Jobs are written repeatedly as JSONL snapshots. Reads collapse snapshots by
 * job id, which gives us simple durability and a useful audit trail without
 * needing SQLite or migrations during the hackathon/product-prototype phase.
 */
export type JobStatus = "queued" | "proving" | "blocked" | "done" | "failed";

export interface StoredJob {
  id: string;
  status: JobStatus;
  preset?: string;
  patternIds: string[];
  commitment: string;
  scan: {
    clean: boolean;
    matches: { id: string; name: string; offset?: number }[];
    results: { id: string; name: string; matched: boolean; matchOffset?: number }[];
  };
  progress: { patternId: string; status: string; detail?: string; at: string }[];
  metadata?: Record<string, unknown>;
  error?: string;
  receiptId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredReceipt {
  id: string;
  jobId: string;
  preset?: string;
  patternIds: string[];
  commitment: string;
  targetHashes: string[];
  proofStatuses: {
    patternId: string;
    patternName: string;
    status: string;
    proofSize: number;
    proofTimeMs: number;
    error?: string;
  }[];
  storageRoot: string;
  status: "draft" | "on_chain" | "on_chain_failed";
  txHash?: string;
  providerAddress?: string;
  modelId?: string;
  onChainError?: string;
  createdAt: string;
}

export class LocalStore {
  readonly jobsPath: string;
  readonly receiptsPath: string;

  constructor(readonly dir: string) {
    this.jobsPath = path.join(dir, "jobs.jsonl");
    this.receiptsPath = path.join(dir, "receipts.jsonl");
  }

  ensure() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  appendJob(job: StoredJob) {
    this.ensure();
    fs.appendFileSync(this.jobsPath, JSON.stringify(job) + "\n");
  }

  appendReceipt(receipt: StoredReceipt) {
    this.ensure();
    fs.appendFileSync(this.receiptsPath, JSON.stringify(receipt) + "\n");
  }

  listJobs(): StoredJob[] {
    return latestById(readJsonl<StoredJob>(this.jobsPath));
  }

  getJob(id: string): StoredJob | undefined {
    return this.listJobs().find((job) => job.id === id);
  }

  listReceipts(): StoredReceipt[] {
    return readJsonl<StoredReceipt>(this.receiptsPath).map(normalizeReceipt).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
}

function normalizeReceipt(receipt: StoredReceipt): StoredReceipt {
  const legacy = receipt as Omit<StoredReceipt, "status"> & {
    status: "local" | StoredReceipt["status"];
  };
  return legacy.status === "local" ? { ...receipt, status: "draft" } : receipt;
}

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function latestById<T extends { id: string; updatedAt?: string; createdAt: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) =>
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
  );
}
