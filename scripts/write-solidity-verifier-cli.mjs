/**
 * Generate the Solidity verifier using the `bb` CLI.
 *
 * The bb.js getSolidityVerifier currently emits a template with $LOG_N
 * placeholders unsubstituted. The bb CLI renders these properly.
 *
 * Workflow:
 *   1. Write the verification key via `bb write_vk`
 *   2. Write the Solidity verifier via `bb write_solidity_verifier`
 *
 * Requires `bb` to be in PATH (install via `bbup -nv 1.0.0-beta.18`).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const circuitPath = path.join(repoRoot, 'Circuit', 'ghostprover', 'target', 'ghostprover.json');
const outDir = path.join(repoRoot, 'Chain', 'src', 'generated');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostprover-vk-'));

const bbPath = process.env.BB_PATH ?? path.join(os.homedir(), '.bb', 'bb');

if (!fs.existsSync(bbPath)) {
  console.error(`[verifier] bb not found at ${bbPath}`);
  console.error(`[verifier] install via: curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash`);
  console.error(`[verifier] then: bbup -nv 1.0.0-beta.18`);
  process.exit(1);
}

if (!fs.existsSync(circuitPath)) {
  console.error(`[verifier] circuit artifact not found at ${circuitPath}`);
  console.error(`[verifier] run \`nargo compile\` in Circuit/ghostprover first`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

console.log('[verifier] writing verification key...');
const vkResult = spawnSync(bbPath, [
  'write_vk',
  '-b', circuitPath,
  '-o', tmpDir,
  '-t', 'evm',
], { stdio: 'inherit' });

if (vkResult.status !== 0) {
  console.error('[verifier] bb write_vk failed');
  process.exit(vkResult.status ?? 1);
}

const vkPath = path.join(tmpDir, 'vk');
if (!fs.existsSync(vkPath)) {
  console.error(`[verifier] vk not produced at ${vkPath}`);
  process.exit(1);
}

console.log('[verifier] writing Solidity verifier...');
const solResult = spawnSync(bbPath, [
  'write_solidity_verifier',
  '-k', vkPath,
  '-o', path.join(outDir, 'Verifier.sol'),
  '-t', 'evm',
], { stdio: 'inherit' });

if (solResult.status !== 0) {
  console.error('[verifier] bb write_solidity_verifier failed');
  process.exit(solResult.status ?? 1);
}

console.log(`[verifier] saved ${path.join(outDir, 'Verifier.sol')}`);
fs.rmSync(tmpDir, { recursive: true, force: true });
