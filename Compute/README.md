# GhostProver — Compute

This folder contains the Compute, attestation, storage, and orchestration layer for GhostProver.

It bridges live or mock inference into the Zero-Knowledge proving flow and prepares the data required for archival and receipt issuance on the 0G stack.

## Purpose

The Compute workspace is responsible for:

- capturing inference logs
- inspecting provider and TEE-related metadata
- bridging prompt data into `Prover.toml`
- generating or coordinating proof inputs
- uploading audit bundles to 0G Storage
- submitting receipts to the on-chain registry

In practice, this is the integration layer between GhostProver's proof system and the rest of the 0G-based pipeline.

## Main Components

| File | Role |
|---|---|
| `src/inference.ts` | Live inference capture and logging |
| `src/mock-inference.ts` | Mock inference path with the same downstream log shape |
| `src/attestation.ts` | Provider attestation inspection and reporting |
| `src/verify-attestation.ts` | TEE-related verification helpers |
| `src/bridge.ts` | Prompt/target bridge into the Noir circuit input format |
| `src/storage.ts` | 0G Storage upload and storage-root generation |
| `src/orchestrator.ts` | End-to-end orchestration across inference, proof, storage, and receipt submission |

## Typical Workflow

```text
Inference / Mock Inference
        ↓
samples/inference-*.log.json
        ↓
bridge.ts
        ↓
Circuit/ghostprover/Prover.toml
        ↓
Proof generation
        ↓
0G Storage upload
        ↓
0G Chain receipt submission
```

## Setup

```bash
cd Compute
cp .env.example .env
npm install
```

Use Node 20+ for the current 0G SDKs.

## Common Commands

### Live inference

```bash
npm run list-services
npm run attest
npm run inference -- "In one sentence, explain zero-knowledge proofs."
```

### Mock inference

```bash
npm run inference:mock
npm run inference:mock -- "Custom prompt"
```

### Bridge prompt data into the circuit

```bash
npm run bridge -- --target "234567890123"
npm run bridge -- --target "secret" --sample samples/inference-XYZ.log.json
```

### End-to-end orchestration

```bash
npm run orchestrate -- --target "234567890123"
npm run orchestrate -- --preset saas
```

## Mainnet Notes

The Compute layer is the part of GhostProver that interacts most directly with the 0G stack:

- **0G Compute / Private Compute** for inference and provider-side verification context
- **0G Storage** for archival of audit bundles
- **0G Chain** for final receipt submission through the deployed registry

Depending on the installed SDK version, you may need to provide explicit contract addresses in `.env` if mainnet contracts cannot be auto-detected from `ZG_RPC_URL`.

## Generated Artifacts

This workspace also produces or stores generated operational files such as:

- `samples/inference-*.log.json`
- `reports/attestation-*.json`
- storage upload metadata
- orchestration outputs tied to receipt submission

See [`reports/README.md`](reports/README.md) for report-specific context.

## Relationship to the Rest of the Repo

- Circuit definitions live in [`../Circuit/`](../Circuit/README.md)
- On-chain registry and verifier code live in [`../Chain/`](../Chain/README.md)
- The core TypeScript SDK lives in [`../src/`](../src/README.md)

For the full product overview, start with the root [README](../README.md).
