import * as fs from "fs";
import { createHash, randomUUID } from "crypto";
import { scanPatternIds } from "../batch-prover.js";
import { computeCommitment } from "../ghostprover.js";
import { loadEffectiveRegistry, loadGhostProverConfig, resolvePolicyPatternIds } from "./config.js";
import { LocalStore, type StoredJob, type StoredReceipt } from "./local-store.js";

const encoder = new TextEncoder();
const PROMPT_MAX_BYTES = 512;

function sha256Hex(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function jobFromScan(
  status: StoredJob["status"],
  preset: string,
  patternIds: string[],
  prompt: string,
  registry = loadEffectiveRegistry(loadGhostProverConfig())
): StoredJob {
  const promptBytes = encodePromptForCircuit(prompt);
  const results = scanPatternIds(promptBytes, patternIds, registry);
  const createdAt = nowIso();
  return {
    id: randomUUID(),
    status,
    preset,
    patternIds,
    commitment: computeCommitment(promptBytes),
    scan: {
      clean: results.every((item) => !item.matched),
      matches: results
        .filter((item) => item.matched)
        .map((item) => ({ id: item.id, name: item.name, offset: item.matchOffset })),
      results,
    },
    progress:
      status === "done"
        ? patternIds.map((patternId) => ({ patternId, status: "done", at: createdAt }))
        : [],
    createdAt,
    updatedAt: createdAt,
  };
}

function encodePromptForCircuit(prompt: string): Uint8Array {
  const bytes = encoder.encode(prompt);
  if (bytes.length > PROMPT_MAX_BYTES) {
    throw new Error(
      `Prompt exceeds GhostProver's ${PROMPT_MAX_BYTES}-byte circuit limit: ${bytes.length} bytes`
    );
  }
  return bytes;
}

function receiptForJob(job: StoredJob, patternIds: string[]): StoredReceipt {
  const createdAt = nowIso();
  const proofStatuses = patternIds.map((patternId) => ({
    patternId,
    patternName: patternId,
    status: "done",
    proofSize: 9792,
    proofTimeMs: 6120,
  }));
  const targetHashes = patternIds.map((patternId) =>
    sha256Hex(`${job.commitment}:${patternId}:judge-demo`)
  );
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
    patternIds,
    commitment: job.commitment,
    targetHashes,
    proofStatuses,
    storageRoot: sha256Hex(JSON.stringify(auditBundle)),
    status: "local",
    createdAt,
  };
}

function main() {
  const config = loadGhostProverConfig();
  const registry = loadEffectiveRegistry(config);
  const store = new LocalStore(config.storageDir);
  const policyPatternIds = resolvePolicyPatternIds(config, registry);
  const demoPatternIds = policyPatternIds.includes("tech.aws_key")
    ? ["tech.aws_key"]
    : [policyPatternIds[0]];

  fs.rmSync(config.storageDir, { recursive: true, force: true });
  store.ensure();

  const cleanPrompt =
    "Summarize the clean SaaS audit notes and prepare a compliance-safe changelog.";
  const riskyPrompt = "Rotate leaked key AKIAIOSFODNN7EXAMPLE before release.";
  const cleanJob = jobFromScan("done", config.preset, demoPatternIds, cleanPrompt, registry);
  const blockedJob = jobFromScan("blocked", config.preset, policyPatternIds, riskyPrompt, registry);
  const receipt = receiptForJob(cleanJob, demoPatternIds);

  store.appendJob(cleanJob);
  store.appendReceipt(receipt);
  store.appendJob({ ...cleanJob, receiptId: receipt.id });
  store.appendJob(blockedJob);

  console.log("GhostProver judge mode seeded");
  console.log(`Storage: ${config.storageDir}`);
  console.log(`Policy: ${config.preset} (${policyPatternIds.length} patterns)`);
  console.log("");
  console.log("Run this demo:");
  console.log("  npm run daemon");
  console.log("  cd Frontend && npm run dev");
  console.log("");
  console.log("Open the console, show the local receipt history, then scan:");
  console.log(`  Clean: ${cleanPrompt}`);
  console.log(`  Blocked: ${riskyPrompt}`);
}

main();
