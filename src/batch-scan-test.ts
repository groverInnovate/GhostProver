// ---------------------------------------------------------------------------
// batch-scan-test.ts — Test the pre-flight pattern scanner
//
// This validates that scanPrompt correctly detects pattern matches
// without generating any proofs (fast, ~0ms per scan).
//
// Run: node --import tsx src/batch-scan-test.ts
// ---------------------------------------------------------------------------

import { scanPrompt } from "./batch-prover.js";

console.log("GhostProver Batch Scan Test");
console.log("=".repeat(50));

// Test 1: Clean prompt — no sensitive data
console.log("\n=== Test 1: Clean prompt (no sensitive data) ===");
const clean = new TextEncoder().encode(
  "What are the treatment options for high blood pressure?"
);
const cleanResults = scanPrompt(clean, "banking");
for (const r of cleanResults) {
  const icon = r.matched ? "❌ FOUND" : "✅ clean";
  console.log(`  ${r.id.padEnd(15)} ${icon}${r.matched ? ` at offset ${r.matchOffset}` : ""}`);
}
const cleanCount = cleanResults.filter((r) => r.matched).length;
console.log(`  → ${cleanCount} patterns matched (expected: 0)`);

// Test 2: Prompt with Aadhar number
console.log("\n=== Test 2: Prompt contains Aadhar number ===");
const aadhar = new TextEncoder().encode(
  "Patient Aadhar 234567890123 needs treatment"
);
const aadharResults = scanPrompt(aadhar, "india_kyc");
for (const r of aadharResults) {
  const icon = r.matched ? "❌ FOUND" : "✅ clean";
  console.log(`  ${r.id.padEnd(15)} ${icon}${r.matched ? ` at offset ${r.matchOffset}` : ""}`);
}

// Test 3: Prompt with SSN
console.log("\n=== Test 3: Prompt contains SSN ===");
const ssn = new TextEncoder().encode(
  "Employee SSN is 123-45-6789 for payroll"
);
const ssnResults = scanPrompt(ssn, "banking");
for (const r of ssnResults) {
  const icon = r.matched ? "❌ FOUND" : "✅ clean";
  console.log(`  ${r.id.padEnd(15)} ${icon}${r.matched ? ` at offset ${r.matchOffset}` : ""}`);
}

// Test 4: Prompt with AWS key
console.log("\n=== Test 4: Prompt contains AWS key ===");
const aws = new TextEncoder().encode(
  "Use key AKIAIOSFODNN7EXAMPLE for S3 access"
);
const awsResults = scanPrompt(aws, "saas");
for (const r of awsResults) {
  const icon = r.matched ? "❌ FOUND" : "✅ clean";
  console.log(`  ${r.id.padEnd(15)} ${icon}${r.matched ? ` at offset ${r.matchOffset}` : ""}`);
}

// Test 5: Prompt with PAN card
console.log("\n=== Test 5: Prompt contains PAN card ===");
const pan = new TextEncoder().encode(
  "Verify PAN ABCDE1234F for tax filing"
);
const panResults = scanPrompt(pan, "india_kyc");
for (const r of panResults) {
  const icon = r.matched ? "❌ FOUND" : "✅ clean";
  console.log(`  ${r.id.padEnd(15)} ${icon}${r.matched ? ` at offset ${r.matchOffset}` : ""}`);
}

// Test 6: Credit card number (16 consecutive digits)
console.log("\n=== Test 6: Prompt contains credit card number ===");
const cc = new TextEncoder().encode(
  "Charge card 4111111111111111 for order #42"
);
const ccResults = scanPrompt(cc, "fintech");
for (const r of ccResults) {
  const icon = r.matched ? "❌ FOUND" : "✅ clean";
  console.log(`  ${r.id.padEnd(15)} ${icon}${r.matched ? ` at offset ${r.matchOffset}` : ""}`);
}

// Summary
console.log("\n" + "=".repeat(50));
console.log("Scan test complete.");
console.log("If patterns are detected correctly, proof generation will correctly");
console.log("FAIL for prompts with matching data and PASS for clean prompts.");
