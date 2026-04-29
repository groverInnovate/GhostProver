import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function main() {
  const fixtureScript = path.resolve('src/write-proof-fixture.ts');
  const fixture = spawnSync('tsx', [fixtureScript], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (fixture.status !== 0) {
    process.exit(fixture.status ?? 1);
  }

  const forge = spawnSync('forge', ['test'], {
    cwd: path.resolve('../Chain'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(forge.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
