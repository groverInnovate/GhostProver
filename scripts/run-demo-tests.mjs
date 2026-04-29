import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const verifier = spawnSync('node', [path.join(repoRoot, 'scripts', 'write-solidity-verifier.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (verifier.status !== 0) {
  process.exit(verifier.status ?? 1);
}

const fixture = spawnSync('node', [path.join(repoRoot, 'scripts', 'write-proof-fixture.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (fixture.status !== 0) {
  process.exit(fixture.status ?? 1);
}

const forge = spawnSync('forge', ['test'], {
  cwd: path.join(repoRoot, 'Chain'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(forge.status ?? 1);
