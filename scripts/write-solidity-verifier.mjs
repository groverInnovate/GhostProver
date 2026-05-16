import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendType, Barretenberg, UltraHonkBackend } from '@aztec/bb.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const circuit = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'Circuit', 'ghostprover', 'target', 'ghostprover.json'), 'utf8')
);

console.log('[verifier] generating Solidity verifier for current circuit artifact');

const api = await Barretenberg.new({
  backend: BackendType.Wasm,
  threads: 1,
});
try {
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const vk = await backend.getVerificationKey({ verifierTarget: 'evm' });
  const solidity = await backend.getSolidityVerifier(vk, { verifierTarget: 'evm' });

  const outDir = path.join(repoRoot, 'Chain', 'src', 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'Verifier.sol'), solidity);
  console.log(`[verifier] saved ${path.join(outDir, 'Verifier.sol')}`);
} finally {
  await api.destroy();
}
