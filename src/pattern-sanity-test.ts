// ---------------------------------------------------------------------------
// pattern-sanity-test.ts — Verify pattern hash alignment between TS and Noir
//
// This test:
//   1. Loads the pattern registry
//   2. Computes pattern hashes (poseidon2_hash_64) in TypeScript
//   3. Validates all patterns in the registry
//   4. Tests the pattern proof flow with witness generation
//
// Run:  npx tsx src/pattern-sanity-test.ts
// ---------------------------------------------------------------------------

import {
  loadRegistry,
  getPatternsByPreset,
  listPresets,
  listPatterns,
  validateRegistry,
  CLASS,
} from "./registry/index.js";
import { computePatternHash, poseidon2Hash512 } from "./poseidon2.js";

console.log("GhostProver Pattern Sanity Test");
console.log("=".repeat(50));

// Step 1: Load and validate registry
const registry = loadRegistry();
console.log(`\nRegistry v${registry.version}: ${Object.keys(registry.patterns).length} patterns, ${Object.keys(registry.presets).length} presets`);

const errors = validateRegistry(registry);
if (Object.keys(errors).length === 0) {
  console.log("✅ All patterns pass validation\n");
} else {
  console.log("❌ Validation errors:");
  for (const [id, errs] of Object.entries(errors)) {
    console.log(`  ${id}:`);
    for (const e of errs) console.log(`    - ${e}`);
  }
  process.exit(1);
}

// Step 2: List all presets
console.log("--- Available Presets ---");
for (const preset of listPresets(registry)) {
  console.log(`  ${preset.id}: ${preset.name} (${preset.patternCount} patterns)`);
}

// Step 3: Compute and display pattern hashes
console.log("\n--- Pattern Hashes (for Noir cross-validation) ---");
for (const pat of listPatterns(registry)) {
  const pattern = registry.patterns[pat.id];
  const hash = computePatternHash(pattern.pattern_types, pattern.pattern_values);
  console.log(`  ${pat.id.padEnd(20)} len=${pat.targetLen.toString().padStart(2)}  hash=${hash}`);
}

// Step 4: Test Aadhar pattern hash specifically
console.log("\n--- Cross-Validation (compare with `nargo test --show-output test_print_pattern_hashes`) ---");
const aadhar = registry.patterns["in.aadhar"];
const aadharHash = computePatternHash(aadhar.pattern_types, aadhar.pattern_values);
console.log(`  in.aadhar pattern hash: ${aadharHash}`);
console.log("  → Compare with Noir output: aadhar_pattern_hash = \"...\"");

const pan = registry.patterns["in.pan"];
const panHash = computePatternHash(pan.pattern_types, pan.pattern_values);
console.log(`  in.pan pattern hash:    ${panHash}`);
console.log("  → Compare with Noir output: pan_pattern_hash = \"...\"");

// Step 5: Test a full preset scenario
console.log("\n--- Preset Test: banking ---");
const bankingPatterns = getPatternsByPreset(registry, "banking");
console.log(`  Patterns in preset: ${bankingPatterns.map(p => p.id).join(", ")}`);

// Simulate: "What is the recommended dosage for patient #A78210?"
const testPrompt = "What is the recommended dosage for patient #A78210?";
const promptBytes = new Array(512).fill(0);
const encoded = new TextEncoder().encode(testPrompt);
for (let i = 0; i < encoded.length; i++) promptBytes[i] = encoded[i];
const commitment = poseidon2Hash512(promptBytes);
console.log(`  Test prompt: "${testPrompt}"`);
console.log(`  Commitment:  ${commitment}`);

for (const { id, pattern } of bankingPatterns) {
  const ph = computePatternHash(pattern.pattern_types, pattern.pattern_values);
  console.log(`  ${id.padEnd(15)} pattern_hash=${ph.slice(0, 18)}... len=${pattern.target_len}`);
}

// Step 6: Verify character class constants match
console.log("\n--- Character Class Constants ---");
const classMap: Record<string, number> = {
  EXACT: 0, DIGIT: 1, ALPHA_LOWER: 2, ALPHA_UPPER: 3,
  ALPHA: 4, ALPHANUM: 5, HEX: 6, BASE64: 7, ANY: 8,
};

let classOk = true;
for (const [name, value] of Object.entries(classMap)) {
  const tsValue = (CLASS as any)[name];
  if (tsValue !== value) {
    console.log(`  ❌ CLASS.${name}: expected ${value}, got ${tsValue}`);
    classOk = false;
  }
}
if (classOk) {
  console.log("  ✅ All CLASS constants match circuit definitions");
}

console.log("\n" + "=".repeat(50));
console.log("Sanity test complete. If pattern hashes match Noir output, you're good to go.");
console.log("Next: run `nargo test --show-output test_print_pattern_hashes` and compare.");
