# GhostProver — Circuit

This folder contains the Noir circuit workspace used by GhostProver.

It is the cryptographic core of the project: the part that proves a sensitive string or pattern does not appear in a prompt while keeping the prompt private.

## Workspace Layout

```text
Circuit/
└── ghostprover/
    ├── src/main.nr
    ├── Nargo.toml
    ├── Prover.toml
    └── target/
```

## What the Circuit Supports

The current circuit supports:

- exact non-inclusion proofs
- pattern-based non-inclusion proofs
- character-class driven descriptors
- public commitment and target-hash binding

The rest of the repository builds developer tooling, orchestration, storage, and receipt issuance around this proof system.

## Common Commands

```bash
cd Circuit/ghostprover
nargo test
nargo execute
nargo compile
```

## Generated Outputs

The `target/` folder contains compiled and generated artifacts consumed by other parts of the repository, including:

- compiled circuit output
- proving inputs and related artifacts
- generated Solidity verifier material

If the circuit interface changes, the downstream TypeScript and Chain layers must be regenerated or revalidated.

## Related Areas

- [`../src/`](../src/README.md) wraps this circuit in the TypeScript SDK
- [`../Chain/`](../Chain/README.md) uses the generated verifier for on-chain receipts
- [`../Compute/`](../Compute/README.md) prepares inputs and orchestrates proof submission
