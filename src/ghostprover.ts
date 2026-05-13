// ---------------------------------------------------------------------------
// ghostprover.ts - TypeScript proof generation wrapper
//
// This is the glue between the orchestrator and the Noir circuit.
// It handles:
//   1. Input padding (prompt to 512 bytes, target to 32 bytes)
//   2. Client-side Poseidon2 commitment computation
//   3. Witness generation via noir_js
//   4. ZK proof generation via bb.js UltraHonkBackend
//
// Usage:
//   const result = await generateProof({
//     promptBytes: new TextEncoder().encode("What is the meaning of life?"),
//     targetBytes: new TextEncoder().encode("234567890123"),
//   });
// ---------------------------------------------------------------------------

import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend, Barretenberg } from "@aztec/bb.js";
import { poseidon2Hash512, poseidon2Hash32 } from "./poseidon2.js";

// Load compiled circuit artifact
// After `nargo compile`, this JSON contains the ACIR bytecode
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const circuit = require("../Circuit/ghostprover/target/ghostprover.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhostProverInput {
  /** Raw prompt bytes (max 512). Will be zero-padded to 512. */
  promptBytes: Uint8Array;
  /** Raw target field bytes (max 32). Will be zero-padded to 32. */
  targetBytes: Uint8Array;
}

export interface GhostProverOutput {
  /** The raw proof bytes */
  proof: Uint8Array;
  /** Public inputs as hex strings: [commitment, target_hash] */
  publicInputs: string[];
  /** Poseidon2 hash of the padded prompt (hex) */
  commitment: string;
  /** Poseidon2 hash of the padded target field (hex) */
  targetHash: string;
  /** Proof generation time in milliseconds */
  proofTimeMs: number;
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

  // Prepare circuit inputs (must match Noir main() signature exactly)
  const circuitInputs = {
    prompt_bytes: paddedPrompt,
    target_bytes: paddedTarget,
    target_len: targetBytes.length,
    prompt_len: promptBytes.length,
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

    // Generate proof
    console.log("[GhostProver] Generating proof...");
    const proof = await backend.generateProof(witness);
    const proofTimeMs = Date.now() - startTime;

    console.log(`[GhostProver] Proof generated in ${proofTimeMs}ms`);
    console.log(`[GhostProver] Proof size: ${proof.proof.length} bytes`);

    return {
      proof: proof.proof,
      publicInputs: [commitment, targetHash],
      commitment,
      targetHash,
      proofTimeMs,
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
    });
    console.log(`[GhostProver] Verification result: ${isValid}`);
    return isValid;
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
 * Compute the Poseidon2 hash of a target field.
 */
export function computeTargetHash(targetBytes: Uint8Array): string {
  if (targetBytes.length > 32) throw new Error("Target field exceeds 32 bytes");
  const padded = padTo(targetBytes, 32);
  return poseidon2Hash32(padded);
}
