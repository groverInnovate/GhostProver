import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ethers } from 'ethers';

const DEFAULT_RPC_URL = process.env.DEMO_RPC_URL ?? 'http://127.0.0.1:8545';
const DEFAULT_PRIVATE_KEY =
  process.env.DEMO_PRIVATE_KEY ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chainRoot = path.join(repoRoot, 'Chain');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readArtifact(...parts) {
  return JSON.parse(fs.readFileSync(path.join(chainRoot, ...parts), 'utf8'));
}

function linkLibrary(bytecode, address) {
  return bytecode.replace(/__\$[0-9a-fA-F]{34}\$__/g, address.slice(2));
}

console.log('[deploy] preparing generated verifier and Foundry artifacts');
run('node', [path.join(repoRoot, 'scripts', 'write-solidity-verifier.mjs')], repoRoot);
run('forge', ['build'], chainRoot);

const provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL);
const wallet = new ethers.Wallet(DEFAULT_PRIVATE_KEY, provider);
console.log('[network]', await provider.getNetwork());
console.log('[wallet]', await wallet.getAddress());

const libraryArtifact = readArtifact('out', 'generated', 'Verifier.sol', 'ZKTranscriptLib.json');
const verifierArtifact = readArtifact('out', 'generated', 'Verifier.sol', 'HonkVerifier.json');
const registryArtifact = readArtifact('out', 'GhostProverRegistry.sol', 'GhostProverRegistry.json');

const libraryFactory = new ethers.ContractFactory(
  libraryArtifact.abi,
  libraryArtifact.bytecode.object,
  wallet
);
const library = await libraryFactory.deploy();
await library.waitForDeployment();

const linkedVerifierBytecode = linkLibrary(
  verifierArtifact.bytecode.object,
  await library.getAddress()
);
const verifierFactory = new ethers.ContractFactory(
  verifierArtifact.abi,
  linkedVerifierBytecode,
  wallet
);
const verifier = await verifierFactory.deploy();
await verifier.waitForDeployment();

const registryFactory = new ethers.ContractFactory(
  registryArtifact.abi,
  registryArtifact.bytecode.object,
  wallet
);
const registry = await registryFactory.deploy(await verifier.getAddress());
await registry.waitForDeployment();

const deploymentsDir = path.join(chainRoot, 'deployments');
fs.mkdirSync(deploymentsDir, { recursive: true });
const deployment = {
  transcriptLib: await library.getAddress(),
  verifier: await verifier.getAddress(),
  registry: await registry.getAddress(),
};
fs.writeFileSync(path.join(deploymentsDir, 'local.json'), JSON.stringify(deployment, null, 2));

console.log('[deployments]', deployment);
console.log(`[deploy] saved ${path.join(deploymentsDir, 'local.json')}`);
