<p align="center">
  <img src="docs/assets/ghostprover.jpeg" alt="GhostProver logo" width="180" />
</p>

<h1 align="center">GhostProver — Zero-Knowledge Compliance for AI Inference</h1>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a>
</p>

GhostProver is a compliance product for AI inference.

It proves that sensitive data such as Aadhaar numbers, PAN cards, API keys, credit card numbers, and other regulated identifiers were **not** present in an AI prompt, without revealing the prompt itself.

The result is a verifiable compliance receipt that can be reviewed internally, archived, and submitted on-chain.

## Judge Quickstart

Run the background-agent demo in three terminals:

```bash
nvm use

# terminal 1: seed a clean judge-mode audit trail
npm run demo:judge

# terminal 2: start the local compliance daemon
npm run daemon

# terminal 3: start the React operator console
cd Frontend
npm run dev
```

Open `http://127.0.0.1:5173`, inspect the seeded receipt history, scan the clean sample, then scan the risk sample.

For a real one-pattern proof acceptance run:

```bash
npm run test:proof:single
```

## What GhostProver Proves

At the core of GhostProver is a Noir circuit that proves:

1. the prover knows a prompt that hashes to a public **commitment**
2. the prompt was checked against a sensitive-data rule
3. the target string or pattern does **not** appear anywhere in the prompt
4. the exact rule checked hashes to a public **pattern hash**

This gives teams a way to prove a compliance claim about a prompt without exposing the prompt itself.

## Architecture

![GhostProver architecture overview](docs/assets/architecture.png)

## Visual Overview

The repository now includes presentation-ready diagram assets under [`docs/assets/`](docs/assets/README.md) for explaining the system at a glance.

### Single Prompt Decision Flow

![GhostProver single prompt decision flow](docs/assets/prompt.png)

### ZK Proof Lifecycle

![GhostProver ZK proof lifecycle](docs/assets/proof.png)

## Product Capabilities

- **Pattern-Based Detection**: 9 built-in character classes such as `DIGIT`, `ALPHA`, `ALPHANUM`, `HEX`, and `BASE64` are evaluated in-circuit.
- **Industry Presets**: bundled registries for `india_kyc`, `banking`, `fintech`, `healthcare`, and `saas`, plus support for custom company registries.
- **Batch Proof Generation**: multiple non-inclusion proofs can be generated concurrently for a single prompt commitment.
- **On-Chain Receipts**: smart contract logic supports both single and batch receipt submission.
- **Developer Integration Surface**: TypeScript SDK, CLI, and Express middleware for application teams.
- **Agent Workflow Support**: a local daemon, MCP bridge, and operator console for coding-agent and internal review workflows.

## How GhostProver Uses 0G

GhostProver uses the 0G stack as the execution, storage, and receipt backbone for the product.

### 1. 0G Private Compute / Compute Network

The Compute integration runs inference through 0G-backed infrastructure and captures the TEE-related metadata used by the compliance flow.

In the repository, the `Compute/` workspace handles:

- live and mock inference capture
- provider discovery and attestation inspection
- request and response logging
- orchestration of the prompt -> proof -> receipt pipeline

Key files:

- [`Compute/src/inference.ts`](Compute/src/inference.ts)
- [`Compute/src/attestation.ts`](Compute/src/attestation.ts)
- [`Compute/src/verify-attestation.ts`](Compute/src/verify-attestation.ts)
- [`Compute/src/orchestrator.ts`](Compute/src/orchestrator.ts)

This is where GhostProver collects the inference-side evidence needed to pair TEE-backed execution with ZK compliance proofs.

### 2. 0G Storage

GhostProver uses 0G Storage as the archive for audit bundles.

An audit bundle can include:

- the captured inference log
- TEE-related metadata
- public proof inputs
- proof material or proof references
- timestamps and receipt metadata

The Storage adapter computes or uploads a storage root that can later be referenced by the receipt layer.

Key file:

- [`Compute/src/storage.ts`](Compute/src/storage.ts)

### 3. 0G Chain

0G Chain is the receipt and settlement layer.

Once a proof is generated, GhostProver submits it to the on-chain registry, where the Solidity verifier checks the proof and emits a compliance receipt event.

That receipt can bind together:

- prompt commitment
- target or pattern hash
- provider and model metadata
- storage root
- submission timestamp

Key files:

- [`Chain/src/GhostProverRegistry.sol`](Chain/src/GhostProverRegistry.sol)
- [`Chain/src/generated/Verifier.sol`](Chain/src/generated/Verifier.sol)
- [`Chain/script/Deploy0G.s.sol`](Chain/script/Deploy0G.s.sol)

### 4. Why the 0G pairing matters

GhostProver is not just a proof library and not just a TEE wrapper.

The product combines:

- **0G Compute** for verifiable inference context
- **Zero-Knowledge proofs** for privacy-preserving compliance claims
- **0G Storage** for durable audit archival
- **0G Chain** for independently verifiable receipts

That combination turns a prompt-compliance check into a reusable compliance record.

## TypeScript SDK and CLI

GhostProver provides a TypeScript SDK and CLI for integrating these checks into Node.js applications and internal tooling.

### CLI Usage

```bash
# Initialize a local config file
npx ghostprover init

# Instantly scan a prompt against an industry preset
npx ghostprover scan --preset banking --prompt "Patient query: SSN is 123456789"

# Generate parallel ZK proofs for an entire preset
npx ghostprover prove --preset saas --prompt "Clean prompt with no API keys"

# Start the local background compliance daemon
npm run daemon

# Start the MCP bridge for Claude Code / Codex style tools
npm run mcp
```

Core documentation:

- [`docs/background-agent-workflow.md`](docs/background-agent-workflow.md) — daemon and MCP architecture
- [`docs/api.md`](docs/api.md) — local daemon API contract
- [`docs/mcp-setup.md`](docs/mcp-setup.md) — MCP setup notes
- [`docs/demo-script.md`](docs/demo-script.md) — demo walkthrough
- [`docs/mainnet-receipts.md`](docs/mainnet-receipts.md) — live 0G mainnet receipt transactions

Custom registry examples:

- [`examples/custom-registry.json`](examples/custom-registry.json)
- [`examples/.ghostprover.custom.example.json`](examples/.ghostprover.custom.example.json)

### Express Middleware

```typescript
import express from 'express';
import { ghostProverMiddleware } from 'ghostprover';

const app = express();

app.use('/v1/chat/completions', ghostProverMiddleware({
  preset: 'india_kyc',
  blocking: false,
}));
```

The middleware performs a fast pre-flight scan and can queue background proof generation for clean prompts.

## Local Daemon and Operator Workflow

GhostProver also ships with a local daemon that acts as the source of truth for:

- scans
- attest requests
- queued proof jobs
- persisted receipts
- live workflow updates over SSE

This makes it practical for agent tooling, internal operator consoles, and local compliance workflows without requiring a custom backend from day one.

Related components:

- [`src/agent/daemon.ts`](src/agent/daemon.ts)
- [`src/agent/mcp-server.ts`](src/agent/mcp-server.ts)
- [`Frontend/src/App.jsx`](Frontend/src/App.jsx)

## Noir CLI Quick Start

If you want to work directly with the Noir circuit:

```bash
# Prerequisites: nargo and bb / Barretenberg CLI
cd Circuit/ghostprover

# Run circuit tests
nargo test

# Execute with Prover.toml inputs
nargo execute

# Generate proof and Solidity verifier
bb prove -b ./target/ghostprover.json -w ./target/ghostprover.gz -o ./target --oracle_hash keccak
bb write_vk -b ./target/ghostprover.json -o ./target --oracle_hash keccak
bb write_solidity_verifier -k ./target/vk -o ./target/Verifier.sol
```

## Contract Receipt Demo

The repository includes a local proof-to-contract demo flow for quickly
validating the on-chain receipt path before spending 0G mainnet funds.

```bash
# terminal 1
anvil

# terminal 2
cd Compute
npm run demo:deploy

# terminal 3
npm run demo:receipt
```

You can also generate a fresh proof fixture and run the receipt contract tests with:

```bash
cd Compute
npm run demo:test
```

This covers:

- valid proof acceptance
- tampered proof rejection
- tampered commitment rejection
- tampered target hash rejection

## 0G Mainnet Runbook

For the full live path, use the 0G mainnet runbook below.
Use Node 20+ for the current 0G Compute tooling.

### 1. Configure live Compute

```bash
nvm use

# terminal 1: configure live Compute
cd Compute
cp .env.example .env
# Fill PRIVATE_KEY and mainnet configuration values
npm install
npm run list-services
npm run attest
npm run inference -- "In one sentence, explain zero-knowledge proofs."
```

### 2. Deploy the receipt registry to 0G mainnet

```bash
cd Chain
forge script script/Deploy0G.s.sol:Deploy0G \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 3. Submit a GhostProver receipt for the captured sample

```bash
cd Compute
# copy Chain/deployments/0g-mainnet.json registry into REGISTRY_ADDRESS first
npm run orchestrate -- --preset saas
```

If an SDK cannot auto-detect the correct chain contracts, set the relevant Compute contract addresses in `Compute/.env`.

### 4. Use the React console against 0G mainnet

The frontend talks to the local `/v1/*` daemon. To make that same UI submit
through the live 0G pipeline, copy
[`examples/.ghostprover.mainnet.example.json`](examples/.ghostprover.mainnet.example.json)
to `.ghostprover.json`, copy
[`Compute/.env.mainnet.example`](Compute/.env.mainnet.example) to
`Compute/.env`, set `PRIVATE_KEY`, then run:

```bash
npm run daemon
cd Frontend
npm run dev
```

When `onChainSubmit` is `true`, clean attestations still start from
`POST /v1/attest`, but the daemon hands final receipt submission to the
Compute orchestrator and stores the resulting `txHash`, provider, model, and
0G Storage root in `.ghostprover/receipts.jsonl`. Without `onChainSubmit`, that
file is only a draft queue/debug cache, not the final compliance artifact.

## Repository Layout

```text
├── src/
│   ├── ghostprover.ts
│   ├── batch-prover.ts
│   ├── cli.ts
│   ├── middleware.ts
│   ├── poseidon2.ts
│   ├── registry/
│   └── agent/
├── Circuit/
│   └── ghostprover/
│       ├── src/main.nr
│       └── target/
├── Chain/
│   ├── src/GhostProverRegistry.sol
│   └── test/GhostProverRegistry.t.sol
├── Compute/
│   ├── src/
│   └── reports/
├── Frontend/
│   └── src/
├── docs/
│   ├── background-agent-workflow.md
│   ├── api.md
│   ├── mcp-setup.md
│   ├── demo-script.md
│   ├── mainnet-receipts.md
│   ├── project-plan.md
│   ├── implementation-log.md
│   └── handoff-summary.md
├── examples/
└── scripts/
```

## Repository Guide

If you are navigating the repository for the first time, these are the most useful entry points:

- [`src/README.md`](src/README.md) — TypeScript SDK, CLI, middleware, daemon, and registry overview
- [`Circuit/README.md`](Circuit/README.md) — Noir circuit workspace overview
- [`Chain/README.md`](Chain/README.md) — Solidity verifier and receipt registry flow
- [`Compute/README.md`](Compute/README.md) — 0G Compute, attestation, storage, and orchestration helpers
- [`Frontend/README.md`](Frontend/README.md) — React operator console overview
- [`docs/README.md`](docs/README.md) — documentation index
- [`examples/README.md`](examples/README.md) — custom registry and config examples
- [`scripts/README.md`](scripts/README.md) — repository helper scripts

Additional project documents:

- [`docs/project-plan.md`](docs/project-plan.md) — original build plan and hackathon context
- [`docs/implementation-log.md`](docs/implementation-log.md) — milestone log and implementation history
- [`docs/handoff-summary.md`](docs/handoff-summary.md) — concise continuation brief

## License

MIT
