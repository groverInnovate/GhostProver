// ---------------------------------------------------------------------------
// batch-prover.ts — Parallel multi-pattern proof generator
//
// Given a company preset (e.g., "banking"), generates ZK proofs for all
// patterns in that preset concurrently. Each proof attests that the prompt
// does NOT contain any string matching that pattern.
//
// Usage:
//   import { generateBatchProofs } from './batch-prover.js';
//   const results = await generateBatchProofs({
//     promptBytes: new TextEncoder().encode("some AI prompt"),
//     preset: "banking",
//     onProgress: (id, status) => console.log(`${id}: ${status}`),
//   });
// ---------------------------------------------------------------------------

import {
  generatePatternProof,
  generateProof,
  computeCommitment,
  type GhostProverOutput,
  type PatternProofInput,
} from "./ghostprover.js";
import {
  loadRegistry,
  getPatternsByPreset,
  getPatternById,
  type PatternRegistry,
  type PatternDefinition,
} from "./registry/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProofStatus = "queued" | "proving" | "done" | "failed";

export interface BatchProofInput {
  /** Raw prompt bytes (max 512) */
  promptBytes: Uint8Array;
  /** Preset name (e.g., "banking", "india_kyc") OR array of pattern IDs */
  preset?: string;
  /** Individual pattern IDs to prove (alternative to preset) */
  patternIds?: string[];
  /** Progress callback: called when each pattern's status changes */
  onProgress?: (patternId: string, status: ProofStatus, detail?: string) => void;
  /** Max concurrent proofs (default: 3 — memory-limited by Barretenberg) */
  concurrency?: number;
}

export interface PatternProofResult {
  /** Pattern ID (e.g., "in.aadhar") */
  patternId: string;
  /** Pattern name (e.g., "Aadhar Number") */
  patternName: string;
  /** Status of this proof */
  status: "done" | "failed";
  /** Proof output (if successful) */
  proof?: GhostProverOutput;
  /** Error message (if failed) */
  error?: string;
  /** Time taken for this specific proof (ms) */
  proofTimeMs: number;
}

export interface BatchProofOutput {
  /** Poseidon2 commitment of the prompt (same across all patterns) */
  commitment: string;
  /** Preset name used */
  preset?: string;
  /** Results per pattern */
  results: PatternProofResult[];
  /** Total wall-clock time (ms) */
  totalTimeMs: number;
  /** Number of successful proofs */
  successCount: number;
  /** Number of failed proofs */
  failCount: number;
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Generate ZK proofs for multiple patterns in parallel.
 *
 * @param input - Prompt bytes + preset or pattern IDs
 * @returns Batch proof output with results per pattern
 */
export async function generateBatchProofs(
  input: BatchProofInput
): Promise<BatchProofOutput> {
  const { promptBytes, preset, patternIds, onProgress, concurrency = 3 } = input;

  if (!preset && (!patternIds || patternIds.length === 0)) {
    throw new Error("Either 'preset' or 'patternIds' must be provided");
  }

  const registry = loadRegistry();
  const startTime = Date.now();

  // Resolve patterns
  let patterns: { id: string; pattern: PatternDefinition }[];
  if (preset) {
    patterns = getPatternsByPreset(registry, preset);
  } else {
    patterns = patternIds!.map((id) => ({
      id,
      pattern: getPatternById(registry, id),
    }));
  }

  // Compute commitment once (same prompt for all patterns)
  const commitment = computeCommitment(promptBytes);
  console.log(`[BatchProver] Commitment: ${commitment}`);
  console.log(`[BatchProver] Generating ${patterns.length} proofs (concurrency=${concurrency})...`);

  // Build proof tasks
  const tasks = patterns.map(({ id, pattern }) => {
    return async (): Promise<PatternProofResult> => {
      onProgress?.(id, "proving");
      const proofStart = Date.now();

      try {
        const proof = await generatePatternProof({
          promptBytes,
          patternTypes: pattern.pattern_types,
          patternValues: pattern.pattern_values,
          targetLen: pattern.target_len,
          patternId: id,
        });

        const proofTimeMs = Date.now() - proofStart;
        onProgress?.(id, "done", `${proofTimeMs}ms`);

        return {
          patternId: id,
          patternName: pattern.name,
          status: "done",
          proof,
          proofTimeMs,
        };
      } catch (err) {
        const proofTimeMs = Date.now() - proofStart;
        const error = (err as Error).message ?? String(err);
        onProgress?.(id, "failed", error);

        return {
          patternId: id,
          patternName: pattern.name,
          status: "failed",
          error,
          proofTimeMs,
        };
      }
    };
  });

  // Run with concurrency limit
  const results = await withConcurrencyLimit(tasks, concurrency);

  const totalTimeMs = Date.now() - startTime;
  const successCount = results.filter((r) => r.status === "done").length;
  const failCount = results.filter((r) => r.status === "failed").length;

  console.log(
    `[BatchProver] Complete: ${successCount}/${results.length} proofs succeeded in ${totalTimeMs}ms`
  );

  return {
    commitment,
    preset,
    results,
    totalTimeMs,
    successCount,
    failCount,
  };
}

/**
 * Scan a prompt against all patterns in a preset and report which would match.
 * This is a fast pre-flight check — no proof generation, just pattern scanning.
 *
 * @returns Array of pattern IDs that WOULD match (i.e., the prompt contains
 *          a substring matching the pattern — proof would FAIL for these).
 */
export function scanPrompt(
  promptBytes: Uint8Array,
  preset: string
): { id: string; name: string; matched: boolean; matchOffset?: number }[] {
  const registry = loadRegistry();
  const patterns = getPatternsByPreset(registry, preset);

  const results: { id: string; name: string; matched: boolean; matchOffset?: number }[] = [];

  for (const { id, pattern } of patterns) {
    const { matched, offset } = scanSinglePattern(
      promptBytes,
      pattern.pattern_types,
      pattern.pattern_values,
      pattern.target_len
    );
    results.push({
      id,
      name: pattern.name,
      matched,
      matchOffset: matched ? offset : undefined,
    });
  }

  return results;
}

/**
 * Check if a single pattern matches anywhere in the prompt bytes.
 * Mirrors the circuit's sliding window logic in plain TypeScript.
 */
function scanSinglePattern(
  promptBytes: Uint8Array,
  patternTypes: number[],
  patternValues: number[],
  targetLen: number
): { matched: boolean; offset: number } {
  const promptLen = promptBytes.length;

  for (let i = 0; i <= promptLen - targetLen; i++) {
    let allMatch = true;
    for (let j = 0; j < targetLen; j++) {
      if (!matchesClass(promptBytes[i + j], patternTypes[j], patternValues[j])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return { matched: true, offset: i };
    }
  }

  return { matched: false, offset: -1 };
}

/**
 * TypeScript mirror of the circuit's matches_class function.
 */
function matchesClass(byte: number, classType: number, classValue: number): boolean {
  switch (classType) {
    case 0: return byte === classValue;                                     // EXACT
    case 1: return byte >= 48 && byte <= 57;                                // DIGIT
    case 2: return byte >= 97 && byte <= 122;                               // ALPHA_LOWER
    case 3: return byte >= 65 && byte <= 90;                                // ALPHA_UPPER
    case 4: return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122); // ALPHA
    case 5: return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122); // ALPHANUM
    case 6: return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102); // HEX
    case 7: return ((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte === 43 || byte === 47 || byte === 61); // BASE64
    case 8: return true;                                                    // ANY
    default: return false;
  }
}
