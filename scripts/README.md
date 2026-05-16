# GhostProver — Scripts

This folder contains repository-level helper scripts used for demos, fixture generation, verifier generation, and local contract workflows.

These scripts support the project, but they are not the main public integration surface for application developers.

## Main Scripts

| File | Role |
|---|---|
| `write-solidity-verifier.mjs` | Generate the Solidity verifier from the compiled Noir artifact |
| `write-solidity-verifier-cli.mjs` | CLI wrapper around verifier generation |
| `write-proof-fixture.mjs` | Generate proof fixtures for local contract tests |
| `demo-deploy.mjs` | Deploy the local demo verifier and registry flow |
| `demo-receipt.mjs` | Submit a demo proof and print receipt output |
| `run-demo-tests.mjs` | Run the local demo verification flow |
| `copy-registry-assets.mjs` | Copy registry assets used by build or demo flows |

## Prefer These for Product Integrations

If you are integrating GhostProver into an application, start with:

- [`../src/`](../src/README.md) for the TypeScript SDK and CLI
- [`../Compute/`](../Compute/README.md) for orchestration and 0G integration
- [`../Chain/`](../Chain/README.md) for on-chain receipt submission
