import { generateProof, verifyProof } from "./ghostprover.js";

async function testE2E() {
  console.log("=== End-to-End Proof Generation Test ===");
  // We use a prompt that DOES NOT contain the target field
  // GhostProver proves non-membership!
  const promptStr = "What are the treatment options for a patient with high blood pressure and diabetes ?";
  const targetStr = "234567890123"; // Aadhar number

  const promptBytes = new TextEncoder().encode(promptStr);
  const targetBytes = new TextEncoder().encode(targetStr);

  console.log(`Prompt: "${promptStr}"`);
  console.log(`Target: "${targetStr}"`);

  // 1. Generate the proof
  console.log("\nStarting proof generation...");
  const result = await generateProof({ promptBytes, targetBytes });

  console.log("\n--- Proof Generation Successful! ---");
  console.log(`Commitment:  ${result.commitment}`);
  console.log(`Target Hash: ${result.targetHash}`);
  console.log(`Proof Size:  ${result.proof.length} bytes`);
  console.log(`Time taken:  ${result.proofTimeMs} ms`);

  // 2. Verify the proof
  console.log("\nStarting proof verification...");
  const isValid = await verifyProof(result.proof, result.publicInputs);

  if (isValid) {
    console.log("\n✅ Proof is VALID!");
  } else {
    console.log("\n❌ Proof is INVALID!");
  }
}

testE2E().catch((err) => {
  console.error("Test failed:", err);
});
