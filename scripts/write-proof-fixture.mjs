import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { generateProof } from '../dist/index.js';
import { DEMO_PROMPT, DEMO_TARGET } from './demo-config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('[fixture] generating fresh demo proof fixture');
console.log('[fixture] prompt and target are hardcoded demo inputs');

const promptBytes = new TextEncoder().encode(DEMO_PROMPT);
const targetBytes = new TextEncoder().encode(DEMO_TARGET);
const result = await generateProof({ promptBytes, targetBytes });

const fixtureDir = path.join(repoRoot, 'Chain', 'fixtures');
fs.mkdirSync(fixtureDir, { recursive: true });
fs.writeFileSync(path.join(fixtureDir, 'proof.bin'), Buffer.from(result.proof));
fs.writeFileSync(
  path.join(fixtureDir, 'public_inputs.bin'),
  Buffer.from(ethers.getBytes(ethers.concat([result.commitment, result.targetHash])))
);
fs.writeFileSync(
  path.join(fixtureDir, 'metadata.json'),
  JSON.stringify(
    {
      prompt: DEMO_PROMPT,
      target: DEMO_TARGET,
      commitment: result.commitment,
      targetHash: result.targetHash,
      proofBytes: result.proof.length,
      proofTimeMs: result.proofTimeMs,
      demoMode: true,
    },
    null,
    2
  )
);

console.log(`[fixture] saved ${path.join(fixtureDir, 'proof.bin')}`);
console.log(`[fixture] saved ${path.join(fixtureDir, 'public_inputs.bin')}`);
