<p align="center">
  <img src="docs/assets/ghostprover.jpeg" alt="GhostProver logo" width="180" />
</p>

<h1 align="center">GhostProver — Zero-Knowledge Compliance for AI Inference</h1>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

GhostProver is a compliance layer for AI inference.

It proves that sensitive data — such as Aadhaar numbers, PAN cards, API keys, credit card numbers, and other regulated identifiers — was **not** present in an AI prompt, without revealing the prompt itself.

The output is a verifiable compliance receipt that can be reviewed internally, stored on 0G Storage, and settled on 0G Chain. Every receipt ties together the original inference run, the TEE provider that executed it, and the ZK proof of non-inclusion — creating an end-to-end compliance record that any third party can independently verify.

## Quickstart

Requires Node ≥ 20.19.0. Run `nvm use` first (`.nvmrc` pins `23.11.1`).

Run the full demo in three terminals:

```bash
nvm use

# terminal 1 — seed a judge-mode audit trail with sample receipts
npm run demo:judge

# terminal 2 — start the local compliance daemon
npm run daemon

# terminal 3 — start the React operator console
cd Frontend && npm run dev
```

Open `http://127.0.0.1:5173` to inspect the seeded receipt history, scan the clean sample, and scan the risk sample.

To run a real end-to-end ZK proof acceptance test (single pattern):

```bash
npm run test:proof:single
```

## What GhostProver Proves

At the core of GhostProver is a **Noir circuit** that generates a zero-knowledge proof of non-inclusion. The proof shows:

1. The prover knows a prompt that hashes to a public **commitment**.
2. The prompt was checked against a specific sensitive-data rule.
3. The target string or pattern does **not** appear anywhere in the prompt.
4. The exact rule that was checked hashes to a public **pattern hash**.

No part of the actual prompt is ever revealed. A verifier only sees the commitment, the pattern hash, and whether the proof is valid.

## Architecture

![GhostProver architecture overview](docs/assets/architecture.png)

## Visual Overview

Presentation-ready diagram assets are available under [`docs/assets/`](docs/assets/README.md).

### Single Prompt Decision Flow

![GhostProver single prompt decision flow](docs/assets/prompt.png)

### ZK Proof Lifecycle

![GhostProver ZK proof lifecycle](docs/assets/proof.png)

## Product Capabilities

| Feature | Detail |
|---|---|
| **Pattern-based detection** | 9 built-in character classes (`DIGIT`, `ALPHA`, `ALPHANUM`, `HEX`, `BASE64`, and more) evaluated directly inside the Noir circuit |
| **15 sensitive-data patterns** | Grouped into 5 industry presets: `india_kyc`, `banking`, `fintech`, `healthcare`, and `saas` |
| **Custom registries** | Teams can define their own company-specific pattern sets via a JSON config |
| **Batch proof generation** | Multiple non-inclusion proofs run concurrently for a single prompt commitment |
| **Single and batch on-chain receipts** | Both `submitReceipt` and `submitBatchReceipt` are supported on-chain, reducing gas for preset-wide submissions |
| **TypeScript SDK and CLI** | Drop-in integration for Node.js apps via `npm install ghostprover` or `npx ghostprover` |
| **Express middleware** | One-line intercept for any Express-based AI gateway |
| **Local daemon and MCP bridge** | Background agent support for Claude Code, Codex-style tools, and internal operator consoles |
| **Self-contained frontend** | The React dashboard ships with a JS-side pre-flight scanner — no daemon needed for basic scans |

## How GhostProver Uses 0G

GhostProver treats the 0G stack as its execution, storage, and settlement backbone. The three layers work together to turn a single compliance check into a permanent, independently verifiable record.

### 1. Why the 0G pairing matters

GhostProver is not just a proof library, and not just a TEE wrapper.

The product combines all three 0G layers into a single product flow:

- **0G Compute** → verifiable inference context (who ran it, on what model, inside a TEE)
- **Zero-knowledge proofs** → privacy-preserving compliance claims (no prompt exposure)
- **0G Storage** → durable, retrievable audit archival
- **0G Chain** → immutable, independently verifiable receipt settlement

Together they turn a one-time prompt-compliance check into a reusable compliance record that any regulator, auditor, or counterparty can verify without ever seeing the original prompt.

## Deployed Contracts — 0G Mainnet

| Contract | Address |
|---|---|
| `GhostProverRegistry` | [`0x9595BD4e6b868C64001904EeF76d838D78604B6e`](https://chainscan.0g.ai/address/0x9595BD4e6b868C64001904EeF76d838D78604B6e) |
| `Verifier` (Honk, auto-generated) | [`0x17B9D7B36Bf6E77F7dbc010B4B2be662A3f1dF78`](https://chainscan.0g.ai/address/0x17B9D7B36Bf6E77F7dbc010B4B2be662A3f1dF78) |

- **Network**: 0G Mainnet (`https://evmrpc.0g.ai`)
- **Deployment record**: [`Chain/deployments/0g-mainnet.json`](Chain/deployments/0g-mainnet.json)
- **Live receipt transactions**: [`docs/mainnet-receipts.md`](docs/mainnet-receipts.md)

To submit a receipt against the live registry, set `REGISTRY_ADDRESS` in `Compute/.env` to the `GhostProverRegistry` address above and follow the [0G Mainnet Runbook](#0g-mainnet-runbook).

### 2. 0G Compute

GhostProver runs AI inference through 0G Compute and captures the TEE-attested execution context. This gives each compliance receipt a verifiable link to the specific provider and model that handled the prompt.

The `Compute/` workspace handles:

- Live and mock inference capture
- Provider discovery and attestation inspection
- Request and response logging
- Full orchestration of the prompt → proof → receipt pipeline

Key files:

| File | Role |
|---|---|
| [`Compute/src/inference.ts`](Compute/src/inference.ts) | Live 0G Compute inference calls |
| [`Compute/src/mock-inference.ts`](Compute/src/mock-inference.ts) | Mock mode for local demos without a live provider |
| [`Compute/src/attestation.ts`](Compute/src/attestation.ts) | TEE attestation capture |
| [`Compute/src/verify-attestation.ts`](Compute/src/verify-attestation.ts) | Attestation verification logic |
| [`Compute/src/broker.ts`](Compute/src/broker.ts) | 0G serving broker integration |
| [`Compute/src/bridge.ts`](Compute/src/bridge.ts) | Compute-side bridge for proof and receipt hand-off |
| [`Compute/src/orchestrator.ts`](Compute/src/orchestrator.ts) | End-to-end pipeline orchestration |
| [`Compute/src/server.ts`](Compute/src/server.ts) | Standalone Compute API server |

### 3. 0G Storage

GhostProver uses 0G Storage to archive the full audit bundle for each inference run. The bundle can include:

- The captured inference log
- TEE-related metadata
- Public proof inputs
- Proof material or proof references
- Timestamps and receipt metadata

The storage adapter uploads the bundle and returns a Merkle storage root. That root is then written into the on-chain receipt, so anyone can retrieve and verify the full audit trail later.

Key file: [`Compute/src/storage.ts`](Compute/src/storage.ts)

### 4. 0G Chain

0G Chain is the final settlement layer. Once a ZK proof is generated, GhostProver submits it to the on-chain registry. The Solidity verifier checks the proof and emits a compliance receipt event that binds together:

- Prompt commitment (Poseidon2 hash)
- Target or pattern hash
- 0G Compute provider address
- Model identifier
- 0G Storage Merkle root
- Block timestamp

Key files:

| File | Role |
|---|---|
| [`Chain/src/GhostProverRegistry.sol`](Chain/src/GhostProverRegistry.sol) | Main registry contract — single and batch receipt submission |
| [`Chain/src/generated/Verifier.sol`](Chain/src/generated/Verifier.sol) | Auto-generated Honk verifier derived from the Noir circuit |
| [`Chain/script/Deploy0G.s.sol`](Chain/script/Deploy0G.s.sol) | Mainnet deploy script |
| [`Chain/script/Deploy0GTestnet.s.sol`](Chain/script/Deploy0GTestnet.s.sol) | Testnet deploy script |
| [`Chain/script/DeployLocal.s.sol`](Chain/script/DeployLocal.s.sol) | Local Anvil deploy script |

`Verifier.sol` is generated output and should not be edited manually.

## TypeScript SDK and CLI

GhostProver ships as a TypeScript SDK and CLI for integrating compliance checks into Node.js apps and internal tooling.

### CLI

```bash
# Set up a local config file
npx ghostprover init

# Instantly scan a prompt against an industry preset (fast JS-side check, no ZK)
npx ghostprover scan --preset banking --prompt "Patient query: SSN is 123456789"

# Generate full ZK proofs for every pattern in a preset (runs in parallel)
npx ghostprover prove --preset saas --prompt "Clean prompt with no API keys"

# Start the local background compliance daemon
npm run daemon

# Start the MCP bridge for Claude Code / Codex-style agent tools
npm run mcp
```

Core docs:

- [`docs/background-agent-workflow.md`](docs/background-agent-workflow.md) — daemon and MCP architecture
- [`docs/api.md`](docs/api.md) — local daemon HTTP API reference
- [`docs/mcp-setup.md`](docs/mcp-setup.md) — MCP setup guide
- [`docs/demo-script.md`](docs/demo-script.md) — step-by-step demo walkthrough
- [`docs/mainnet-receipts.md`](docs/mainnet-receipts.md) — live 0G mainnet receipt transactions
- [`docs/limitations.md`](docs/limitations.md) — known constraints and recommended next steps

Custom registry examples:

- [`examples/custom-registry.json`](examples/custom-registry.json)
- [`examples/.ghostprover.custom.example.json`](examples/.ghostprover.custom.example.json)

### Express Middleware

Drop GhostProver into any Express-based AI gateway with a single `app.use`:

```typescript
import express from 'express';
import { ghostProverMiddleware } from 'ghostprover';

const app = express();

app.use('/v1/chat/completions', ghostProverMiddleware({
  preset: 'india_kyc',
  blocking: false,
}));
```

The middleware runs an instant JS-side pre-flight scan on every request and queues a background ZK proof for clean prompts.

## Local Daemon and Operator Workflow

GhostProver includes a local daemon that acts as the backend for:

- Prompt scans
- Attest requests (`POST /v1/attest`)
- Queued ZK proof jobs
- Persisted receipts (`.ghostprover/receipts.jsonl`)
- Live workflow updates over SSE

This makes it practical for agent tooling, internal operator consoles, and local compliance workflows — no custom backend needed from day one.

When `onChainSubmit` is set to `true` in the config, the daemon delegates final receipt submission to the Compute orchestrator via the 0G adapter. The resulting `txHash`, provider, model, and 0G Storage root are written into the receipts file as a live compliance artifact.

Related source files:

- [`src/agent/daemon.ts`](src/agent/daemon.ts) — the HTTP + SSE daemon process
- [`src/agent/mcp-server.ts`](src/agent/mcp-server.ts) — the MCP tool bridge
- [`src/agent/zerog-adapter.ts`](src/agent/zerog-adapter.ts) — bridges the daemon to the live 0G Compute pipeline for on-chain submission
- [`Frontend/src/App.jsx`](Frontend/src/App.jsx) — React operator console
- [`Frontend/src/scanner.js`](Frontend/src/scanner.js) — JS-side pre-flight scanner (self-contained, no daemon required)
- [`Frontend/src/registry.js`](Frontend/src/registry.js) — bundled pattern registry for in-browser use

## Noir Circuit Quick Start

To work directly with the Noir circuit (requires `nargo` and the Barretenberg CLI `bb`):

```bash
cd Circuit/ghostprover

# Run all 17 circuit tests
nargo test

# Execute a proof with the inputs in Prover.toml
nargo execute

# Generate a proof and write the Solidity verifier
bb prove -b ./target/ghostprover.json -w ./target/ghostprover.gz -o ./target --oracle_hash keccak
bb write_vk -b ./target/ghostprover.json -o ./target --oracle_hash keccak
bb write_solidity_verifier -k ./target/vk -o ./target/Verifier.sol
```

Pinned toolchain: `nargo` 1.0.0-beta.18, `@aztec/bb.js` 3.0.0-nightly.20260102, Barretenberg CLI 1.0.0-beta.18.

## Local Contract Demo

The repository includes a local end-to-end demo that validates the full proof → contract → receipt path before spending real 0G mainnet funds.

```bash
# terminal 1 — start a local Ethereum node
anvil

# terminal 2 — deploy the registry and verifier contracts locally,
#               then submit a receipt using the pre-generated proof fixture
node scripts/demo-deploy.mjs
node scripts/demo-receipt.mjs
```

To regenerate a fresh proof fixture and re-run all contract tests:

```bash
cd Compute && npm run demo:test
```

The test suite covers:

- Valid proof acceptance
- Tampered proof rejection
- Tampered commitment rejection
- Tampered target hash rejection
- Batch receipt submission and length mismatch rejection
- Compute field emission in receipt events (7 tests total, all passing)

## 0G Mainnet Runbook

For the full live path against the 0G mainnet, follow these steps. Requires Node ≥ 20.19.0 (run `nvm use` from the repo root).

### Step 1 — Configure live Compute

```bash
cd Compute
cp .env.example .env
# Add your PRIVATE_KEY and mainnet values to Compute/.env

npm install
npm run list-services   # browse available 0G Compute providers
npm run attest          # inspect TEE attestation for the chosen provider
npm run inference -- "In one sentence, explain zero-knowledge proofs."
```

### Step 2 — Deploy the receipt registry to 0G mainnet

```bash
cd Chain
forge script script/Deploy0G.s.sol:Deploy0G \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $PRIVATE_KEY \
  --broadcast
```

The deployed addresses are written to `Chain/deployments/0g-mainnet.json`.

### Step 3 — Submit a compliance receipt

```bash
cd Compute
# Set REGISTRY_ADDRESS in Compute/.env from the output of Step 2
npm run orchestrate -- --preset saas
```

If the SDK cannot auto-detect chain contracts, set the relevant addresses manually in `Compute/.env`.

### Step 4 — Use the React console against 0G mainnet

The frontend talks to the local daemon. To connect the UI to the live 0G pipeline:

```bash
# From the repo root
cp examples/.ghostprover.mainnet.example.json .ghostprover.json
# Set PRIVATE_KEY in Compute/.env (already copied in Step 1)

npm run daemon

# In a new terminal
cd Frontend && npm run dev
```

With `onChainSubmit: true` in `.ghostprover.json`, every clean attestation that passes the daemon's `/v1/attest` endpoint will be routed through the Compute orchestrator and settled on 0G Chain. The receipt — including `txHash`, provider, model, and 0G Storage root — is appended to `.ghostprover/receipts.jsonl`.

## Repository Layout

```text
├── src/
│   ├── index.ts               ← SDK public export entry point
│   ├── ghostprover.ts         ← core scanner and proof engine
│   ├── batch-prover.ts        ← parallel batch proof runner
│   ├── cli.ts                 ← CLI (scan, prove, init, daemon, mcp)
│   ├── middleware.ts           ← Express middleware
│   ├── poseidon2.ts           ← Poseidon2 hash helper
│   ├── registry/              ← pattern registry and industry presets
│   └── agent/
│       ├── daemon.ts          ← HTTP + SSE compliance daemon
│       ├── mcp-server.ts      ← MCP tool bridge
│       ├── zerog-adapter.ts   ← bridges daemon → live 0G pipeline
│       ├── local-store.ts     ← receipt persistence
│       └── config.ts          ← config loader
├── Circuit/
│   └── ghostprover/
│       ├── src/main.nr        ← Noir circuit (dual-mode: exact + pattern)
│       ├── Prover.toml        ← example circuit inputs
│       └── target/            ← compiled circuit artifacts
├── Chain/
│   ├── src/
│   │   ├── GhostProverRegistry.sol
│   │   └── generated/Verifier.sol
│   ├── script/
│   │   ├── Deploy0G.s.sol
│   │   ├── Deploy0GTestnet.s.sol
│   │   └── DeployLocal.s.sol
│   ├── test/GhostProverRegistry.t.sol
│   ├── fixtures/              ← pre-generated proof and public input binaries
│   └── deployments/           ← recorded deployment addresses
├── Compute/
│   ├── src/                   ← inference, attestation, storage, orchestrator
│   └── reports/               ← captured inference and attestation reports
├── Frontend/
│   └── src/
│       ├── App.jsx            ← operator console (React + glassmorphism UI)
│       ├── scanner.js         ← self-contained JS pre-flight scanner
│       ├── registry.js        ← bundled pattern registry for in-browser use
│       └── styles.css
├── docs/                      ← all project documentation
├── examples/                  ← sample configs and custom registry templates
└── scripts/                   ← helper scripts (deploy, fixture, verifier)
```

## Repository Guide

If you are reading this for the first time, these are the most useful starting points:

- [`src/README.md`](src/README.md) — TypeScript SDK, CLI, middleware, daemon, and registry overview
- [`Circuit/README.md`](Circuit/README.md) — Noir circuit workspace overview
- [`Chain/README.md`](Chain/README.md) — Solidity verifier and receipt registry
- [`Compute/README.md`](Compute/README.md) — 0G Compute, attestation, storage, and orchestration
- [`Frontend/README.md`](Frontend/README.md) — React operator console overview
- [`docs/README.md`](docs/README.md) — full documentation index
- [`examples/README.md`](examples/README.md) — custom registry and config examples
- [`scripts/README.md`](scripts/README.md) — helper script reference

Additional documents:

- [`docs/project-plan.md`](docs/project-plan.md) — original build plan and hackathon context
- [`docs/implementation-log.md`](docs/implementation-log.md) — milestone log and implementation history
- [`docs/handoff-summary.md`](docs/handoff-summary.md) — concise continuation brief for the next developer or agent
- [`docs/limitations.md`](docs/limitations.md) — known constraints and recommended next improvements
- [`docs/diagrams.md`](docs/diagrams.md) — detailed Mermaid flow diagrams

## License

MIT
