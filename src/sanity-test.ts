// ---------------------------------------------------------------------------
// sanity-test.ts - Verify TS Poseidon2 matches Noir circuit output
//
// CRITICAL: Run this before wiring into the full flow.
// A hash mismatch here means silently invalid proofs that fail on-chain.
//
// Usage:
//   npx tsx src/sanity-test.ts
//
// Then compare the output with:
//   cd Circuit/ghostprover && nargo test --show-output test_print_prover_hashes
// ---------------------------------------------------------------------------

import { poseidon2Hash512, poseidon2Hash32 } from "./poseidon2.js";

function padTo(arr: number[], len: number): number[] {
  const out = new Array(len).fill(0);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  return out;
}

// Test case 1: "Hello World" prompt + "SECRET" target
// This matches test_field_not_present in the circuit
function testHelloWorld() {
  console.log("=== Test 1: Hello World / SECRET ===");

  const promptStr = "Hello World";
  const targetStr = "SECRET";

  const promptBytes = Array.from(Buffer.from(promptStr, "ascii"));
  const targetBytes = Array.from(Buffer.from(targetStr, "ascii"));

  const paddedPrompt = padTo(promptBytes, 512);
  const paddedTarget = padTo(targetBytes, 32);

  const commitment = poseidon2Hash512(paddedPrompt);
  const targetHash = poseidon2Hash32(paddedTarget);

  console.log(`Prompt:      "${promptStr}" (${promptStr.length} bytes)`);
  console.log(`Target:      "${targetStr}" (${targetStr.length} bytes)`);
  console.log(`Commitment:  ${commitment}`);
  console.log(`Target hash: ${targetHash}`);
  console.log();
}

// Test case 2: Medical AI query + Aadhar number
// This matches test_print_prover_hashes in the circuit
function testMedicalQuery() {
  console.log("=== Test 2: Medical Query / Aadhar (Prover.toml scenario) ===");

  const promptStr =
    "What are the treatment options for a patient with high blood pressure and diabetes?";
  const targetStr = "234567890123";

  const promptBytes = Array.from(Buffer.from(promptStr, "ascii"));
  const targetBytes = Array.from(Buffer.from(targetStr, "ascii"));

  const paddedPrompt = padTo(promptBytes, 512);
  const paddedTarget = padTo(targetBytes, 32);

  const commitment = poseidon2Hash512(paddedPrompt);
  const targetHash = poseidon2Hash32(paddedTarget);

  console.log(`Prompt:      "${promptStr}" (${promptStr.length} bytes)`);
  console.log(`Target:      "${targetStr}" (${targetStr.length} bytes)`);
  console.log(`Commitment:  ${commitment}`);
  console.log(`Target hash: ${targetHash}`);
  console.log();

  // These should match the output of:
  //   nargo test --show-output test_print_prover_hashes
  console.log("Compare these values with nargo test output.");
  console.log(
    "If they match, the TS <-> Noir sponge is compatible and proofs will verify on-chain."
  );
  console.log(
    "If they DON'T match, proof generation will fail silently. Do NOT proceed."
  );
}

// Test case 3: All-zeros (edge case)
function testAllZeros() {
  console.log("\n=== Test 3: All-zeros (edge case) ===");

  const paddedPrompt = new Array(512).fill(0);
  const paddedTarget = new Array(32).fill(0);

  const commitment = poseidon2Hash512(paddedPrompt);
  const targetHash = poseidon2Hash32(paddedTarget);

  console.log(`Commitment (512 zeros): ${commitment}`);
  console.log(`Target hash (32 zeros): ${targetHash}`);
}

console.log("GhostProver Poseidon2 Sanity Test");
console.log("=================================\n");

testHelloWorld();
testMedicalQuery();
testAllZeros();

console.log("\n=================================");
console.log("Done. Compare outputs with nargo test --show-output");
