# GhostProver — Chain

This folder contains the Solidity and Foundry workspace for GhostProver's on-chain receipt layer.

Its role is straightforward: verify GhostProver proofs against the generated verifier contract and emit compliance receipts on 0G Chain.

## Purpose

The Chain layer is responsible for:

- verifying proof validity on-chain
- emitting receipt events for accepted submissions
- supporting both single-proof and batch-proof receipt flows
- carrying provider, model, and storage-root metadata alongside proof results

This is the settlement layer for the broader GhostProver stack.

## Core Contracts

| Contract | Role |
|---|---|
| `src/GhostProverRegistry.sol` | Main registry contract for single and batch compliance receipt submission |
| `src/generated/Verifier.sol` | Auto-generated Solidity verifier derived from the Noir circuit |

`Verifier.sol` is generated output and should not be edited manually.

## Workspace Layout

```text
Chain/
├── src/
│   ├── GhostProverRegistry.sol
│   └── generated/
│       └── Verifier.sol
├── script/
│   ├── DeployLocal.s.sol
│   ├── Deploy0G.s.sol
│   └── Deploy0GTestnet.s.sol
├── test/
│   └── GhostProverRegistry.t.sol
├── fixtures/
│   ├── proof.bin
│   ├── public_inputs.bin
│   └── metadata.json
├── deployments/
├── foundry.toml
└── lib/forge-std/
```

## Receipt Model

The registry emits compliance receipts that can bind together:

- prompt commitment
- target or pattern hash
- submitter
- provider address
- model identifier
- storage root
- timestamp

Batch receipt support allows multiple target hashes to be submitted under a shared commitment and metadata payload.

## Common Commands

### Run the test suite

```bash
cd Chain
forge test -vvv
```

### Local deploy

```bash
anvil

cd Chain
forge script script/DeployLocal.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

### Mainnet deploy

```bash
cd Chain
forge script script/Deploy0G.s.sol:Deploy0G \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### Regenerate local fixtures and rerun demo tests

```bash
cd Compute
npm run demo:test
```

## Test Coverage

The Foundry suite validates:

- valid proof acceptance
- tampered proof rejection
- tampered commitment rejection
- tampered target-hash rejection
- compute-field emission
- batch receipt submission
- batch length mismatch rejection

## Relationship to the Rest of the Repo

- The circuit definition lives in [`../Circuit/`](../Circuit/README.md)
- Proof generation and orchestration live in [`../Compute/`](../Compute/README.md)
- The main TypeScript SDK lives in [`../src/`](../src/README.md)

For a product-level overview, start with the root [README](../README.md).
