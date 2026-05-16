// ---------------------------------------------------------------------------
// poseidon2.ts - TypeScript Poseidon2 sponge hash matching our Noir circuit
//
// Uses @zkpassport/poseidon2 which implements the identical BN254 sponge:
//   - State width = 4 (rate 3, capacity 1)
//   - IV = input_length * 2^64
//   - Fixed-length mode (no variable-length suffix)
//
// Verified against the Noir stdlib source (poseidon2.nr) and our circuit's
// poseidon2_hash_512 / poseidon2_hash_32 functions.
// ---------------------------------------------------------------------------

import { poseidon2Hash } from "@zkpassport/poseidon2";

/**
 * Poseidon2 hash of 512 field elements (matching circuit's poseidon2_hash_512).
 * Input: array of 512 numbers (byte values 0-255, interpreted as Field elements).
 * Output: hex string "0x..." of the BN254 field element.
 */
export function poseidon2Hash512(bytes: number[]): string {
  if (bytes.length !== 512) {
    throw new Error(`poseidon2Hash512 expects 512 elements, got ${bytes.length}`);
  }
  const fields = bytes.map((b) => BigInt(b));
  const hash = poseidon2Hash(fields);
  return "0x" + hash.toString(16).padStart(64, "0");
}

/**
 * Poseidon2 hash of 32 field elements (matching circuit's poseidon2_hash_32).
 * Input: array of 32 numbers (byte values 0-255, interpreted as Field elements).
 * Output: hex string "0x..." of the BN254 field element.
 */
export function poseidon2Hash32(bytes: number[]): string {
  if (bytes.length !== 32) {
    throw new Error(`poseidon2Hash32 expects 32 elements, got ${bytes.length}`);
  }
  const fields = bytes.map((b) => BigInt(b));
  const hash = poseidon2Hash(fields);
  return "0x" + hash.toString(16).padStart(64, "0");
}

/**
 * Raw Poseidon2 hash returning BigInt (for internal use).
 */
export function poseidon2HashRaw(bytes: number[]): bigint {
  const fields = bytes.map((b) => BigInt(b));
  return poseidon2Hash(fields);
}

/**
 * Poseidon2 hash of 64 field elements (matching circuit's poseidon2_hash_64).
 * Used for hashing pattern descriptors: pattern_types[32] ++ pattern_values[32].
 * Output: hex string "0x..." of the BN254 field element.
 */
export function poseidon2Hash64(bytes: number[]): string {
  if (bytes.length !== 64) {
    throw new Error(`poseidon2Hash64 expects 64 elements, got ${bytes.length}`);
  }
  const fields = bytes.map((b) => BigInt(b));
  const hash = poseidon2Hash(fields);
  return "0x" + hash.toString(16).padStart(64, "0");
}

/**
 * Compute the pattern descriptor hash.
 * Concatenates pattern_types[32] and pattern_values[32] into a 64-element
 * array and hashes it. This matches the circuit's target_hash in pattern mode.
 */
export function computePatternHash(
  patternTypes: number[],
  patternValues: number[]
): string {
  if (patternTypes.length !== 32 || patternValues.length !== 32) {
    throw new Error(
      `Pattern arrays must be length 32, got types=${patternTypes.length} values=${patternValues.length}`
    );
  }
  const descriptor = [...patternTypes, ...patternValues];
  return poseidon2Hash64(descriptor);
}
