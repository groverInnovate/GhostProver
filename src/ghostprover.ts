// ---------------------------------------------------------------------------
// ghostprover.ts - TypeScript proof generation wrapper (v2)
//
// This is the glue between the orchestrator and the Noir circuit.
// It handles:
//   1. Input padding (prompt to 512 bytes, target to 32 bytes)
//   2. Client-side Poseidon2 commitment computation
//   3. Witness generation via noir_js
//   4. ZK proof generation via bb.js UltraHonkBackend
//
// Supports two modes:
//   - Exact mode:   prove a specific string is absent
//   - Pattern mode:  prove no string matching a character-class pattern
//                    is present (e.g. "any 12 digits" for Aadhar)
//
// Usage (exact mode - unchanged):
//   const result = await generateProof({
//     promptBytes: new TextEncoder().encode("some prompt"),
//     targetBytes: new TextEncoder().encode("234567890123"),
//   });
//
// Usage (pattern mode - new):
//   const result = await generatePatternProof({
//     promptBytes: new TextEncoder().encode("some prompt"),
//     patternTypes: [1,1,1,1,1,1,1,1,1,1,1,1, ...zeros],
//     patternValues: [0,0,0,...zeros],
//     targetLen: 12,
//   });
// ---------------------------------------------------------------------------

import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend, Barretenberg } from "@aztec/bb.js";
import { poseidon2Hash512, poseidon2Hash32, computePatternHash } from "./poseidon2.js";

// Load compiled circuit artifact
// After `nargo compile`, this JSON contains the ACIR bytecode
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const circuit = require("../Circuit/ghostprover/target/ghostprover.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for exact mode (mode=0): specific byte string absent */
export interface GhostProverInput {
  /** Raw prompt bytes (max 512). Will be zero-padded to 512. */
  promptBytes: Uint8Array;
  /** Raw target field bytes (max 32). Will be zero-padded to 32. */
  targetBytes: Uint8Array;
}

/** Input for pattern mode (mode=1): character-class pattern absent */
export interface PatternProofInput {
  /** Raw prompt bytes (max 512). Will be zero-padded to 512. */
  promptBytes: Uint8Array;
  /** Character class IDs for each position (length 32, zero-padded) */
  patternTypes: number[];
  /** Exact byte values for CLASS_EXACT positions (length 32, zero-padded) */
  patternValues: number[];
  /** Number of active positions in the pattern (1-32) */
  targetLen: number;
  /** Optional: pattern ID for logging (e.g., "in.aadhar") */
  patternId?: string;
}

export interface GhostProverOutput {
  /** The raw proof bytes */
  proof: Uint8Array;
  /** Public inputs as hex strings: [commitment, target_hash] */
  publicInputs: string[];
  /** Poseidon2 hash of the padded prompt (hex) */
  commitment: string;
  /** Poseidon2 hash of the target/pattern (hex) */
  targetHash: string;
  /** Proof generation time in milliseconds */
  proofTimeMs: number;
  /** Which mode was used */
  mode: 'exact' | 'pattern';
  /** Pattern ID if pattern mode was used */
  patternId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Zero-pad a Uint8Array to a fixed length, returning a number[].
 */
function padTo(arr: Uint8Array, len: number): number[] {
  if (arr.length > len) {
    throw new Error(`Input exceeds max length ${len}: got ${arr.length}`);
  }
  const out = new Array(len).fill(0);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[i];
  }
  return out;
}

/**
 * Convert a hex string to a number[] for Noir circuit input.
 * Handles "0x" prefix.
 */
function hexToField(hex: string): string {
  return hex.startsWith("0x") ? hex : "0x" + hex;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Generate a GhostProver ZK proof of non-membership.
 *
 * Proves that `targetBytes` does NOT appear as a contiguous substring
 * in `promptBytes`, with both bound by Poseidon2 commitments.
 *
 * @param input - The prompt and target field bytes
 * @returns Proof, public inputs, and timing info
 * @throws If the target IS found in the prompt (proof generation will fail)
 */
export async function generateProof(
  input: GhostProverInput
): Promise<GhostProverOutput> {
  const { promptBytes, targetBytes } = input;

  // Validate sizes
  if (promptBytes.length === 0) throw new Error("Prompt cannot be empty");
  if (promptBytes.length > 512) throw new Error("Prompt exceeds 512 bytes");
  if (targetBytes.length === 0) throw new Error("Target field cannot be empty");
  if (targetBytes.length > 32) throw new Error("Target field exceeds 32 bytes");

  // Pad to fixed sizes
  const paddedPrompt = padTo(promptBytes, 512);
  const paddedTarget = padTo(targetBytes, 32);

  // Compute public inputs client-side using the same Poseidon2 sponge
  const commitment = poseidon2Hash512(paddedPrompt);
  const targetHash = poseidon2Hash32(paddedTarget);

  console.log(`[GhostProver] Commitment: ${commitment}`);
  console.log(`[GhostProver] Target hash: ${targetHash}`);

  // Prepare circuit inputs (must match Noir main() v2 signature)
  const circuitInputs = {
    prompt_bytes: paddedPrompt,
    target_bytes: paddedTarget,
    pattern_types: new Array(32).fill(0),    // unused in exact mode
    pattern_values: new Array(32).fill(0),   // unused in exact mode
    target_len: targetBytes.length,
    prompt_len: promptBytes.length,
    mode: 0,                                 // exact mode
    commitment: hexToField(commitment),
    target_hash: hexToField(targetHash),
  };

  // Initialize Barretenberg, Noir, and backend
  const api = await Barretenberg.new();
  const noir = new Noir(circuit as any);
  const backend = new UltraHonkBackend(circuit.bytecode, api);

  try {
    // Generate witness
    console.log("[GhostProver] Generating witness...");
    const startTime = Date.now();
    const { witness } = await noir.execute(circuitInputs);

    // Generate proof. verifierTarget: 'evm' ensures the proof format matches
    // the Solidity verifier produced by `bb write_solidity_verifier -t evm`.
    console.log("[GhostProver] Generating proof...");
    const proof = await backend.generateProof(witness, { verifierTarget: "evm" });
    const proofTimeMs = Date.now() - startTime;

    console.log(`[GhostProver] Proof generated in ${proofTimeMs}ms`);
    console.log(`[GhostProver] Proof size: ${proof.proof.length} bytes`);

    return {
      proof: proof.proof,
      publicInputs: [commitment, targetHash],
      commitment,
      targetHash,
      proofTimeMs,
      mode: 'exact' as const,
    };
  } finally {
    // Clean up Barretenberg resources
    await api.destroy();
  }
}

/**
 * Verify a GhostProver proof.
 *
 * @param proof - The proof bytes from generateProof
 * @param publicInputs - [commitment, targetHash] hex strings
 * @returns true if the proof is valid
 */
export async function verifyProof(
  proof: Uint8Array,
  publicInputs: string[]
): Promise<boolean> {
  const api = await Barretenberg.new();
  const backend = new UltraHonkBackend(circuit.bytecode, api);

  try {
    console.log("[GhostProver] Verifying proof...");
    const isValid = await backend.verifyProof({
      proof,
      publicInputs,
    }, { verifierTarget: "evm" });
    console.log(`[GhostProver] Verification result: ${isValid}`);
    return isValid;
  } finally {
    await api.destroy();
  }
}

/**
 * Generate a GhostProver ZK proof using pattern mode.
 *
 * Proves that NO string matching the character-class pattern is present
 * in the prompt. For example, [DIGIT×12] proves no 12-digit number
 * (like an Aadhar number) appears anywhere.
 */
export async function generatePatternProof(
  input: PatternProofInput
): Promise<GhostProverOutput> {
  const { promptBytes, patternTypes, patternValues, targetLen, patternId } = input;

  // Validate
  if (promptBytes.length === 0) throw new Error("Prompt cannot be empty");
  if (promptBytes.length > 512) throw new Error("Prompt exceeds 512 bytes");
  if (patternTypes.length !== 32) throw new Error("patternTypes must be length 32");
  if (patternValues.length !== 32) throw new Error("patternValues must be length 32");
  if (targetLen < 1 || targetLen > 32) throw new Error("targetLen must be 1-32");

  // Pad prompt
  const paddedPrompt = padTo(promptBytes, 512);

  // Compute hashes
  const commitment = poseidon2Hash512(paddedPrompt);
  const patternHash = computePatternHash(patternTypes, patternValues);

  const label = patternId ?? 'pattern';
  console.log(`[GhostProver:${label}] Commitment: ${commitment}`);
  console.log(`[GhostProver:${label}] Pattern hash: ${patternHash}`);

  // Circuit inputs (mode=1 for pattern)
  const circuitInputs = {
    prompt_bytes: paddedPrompt,
    target_bytes: new Array(32).fill(0),     // unused in pattern mode
    pattern_types: patternTypes,
    pattern_values: patternValues,
    target_len: targetLen,
    prompt_len: promptBytes.length,
    mode: 1,                                 // pattern mode
    commitment: hexToField(commitment),
    target_hash: hexToField(patternHash),
  };

  const api = await Barretenberg.new();
  const noir = new Noir(circuit as any);
  const backend = new UltraHonkBackend(circuit.bytecode, api);

  try {
    console.log(`[GhostProver:${label}] Generating witness...`);
    const startTime = Date.now();
    const { witness } = await noir.execute(circuitInputs);

    console.log(`[GhostProver:${label}] Generating proof...`);
    const proof = await backend.generateProof(witness, { verifierTarget: "evm" });
    const proofTimeMs = Date.now() - startTime;

    console.log(`[GhostProver:${label}] Proof generated in ${proofTimeMs}ms`);
    console.log(`[GhostProver:${label}] Proof size: ${proof.proof.length} bytes`);

    return {
      proof: proof.proof,
      publicInputs: [commitment, patternHash],
      commitment,
      targetHash: patternHash,
      proofTimeMs,
      mode: 'pattern',
      patternId,
    };
  } finally {
    await api.destroy();
  }
}

/**
 * Compute the Poseidon2 commitment for a prompt (without generating a proof).
 * Useful for the orchestrator to publish the commitment before inference.
 */
export function computeCommitment(promptBytes: Uint8Array): string {
  if (promptBytes.length > 512) throw new Error("Prompt exceeds 512 bytes");
  const padded = padTo(promptBytes, 512);
  return poseidon2Hash512(padded);
}

/**
 * Compute the Poseidon2 hash of a target field (exact mode).
 */
export function computeTargetHash(targetBytes: Uint8Array): string {
  if (targetBytes.length > 32) throw new Error("Target field exceeds 32 bytes");
  const padded = padTo(targetBytes, 32);
  return poseidon2Hash32(padded);
}

// Re-export pattern hash computation for convenience
export { computePatternHash } from "./poseidon2.js";
