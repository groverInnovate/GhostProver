# GhostProver — Source

[English](./README.md) | [简体中文](./README.zh-CN.md)

This folder contains the main TypeScript implementation of GhostProver.

It turns the Noir circuit and registry model into a developer-facing product surface: SDK, CLI, middleware, daemon, MCP bridge, and local workflow tooling.

## Layout

| Path | Role |
|---|---|
| `ghostprover.ts` | Core proof generation and verification wrappers |
| `batch-prover.ts` | Batch proving and pre-flight scanning |
| `cli.ts` | Command-line interface |
| `middleware.ts` | Express integration for prompt interception and background proofs |
| `poseidon2.ts` | TypeScript Poseidon2 helpers aligned with the Noir circuit |
| `registry/` | Built-in patterns, presets, and validation helpers |
| `agent/` | Local daemon, MCP server, judge/demo helpers, and receipt store |

## Design Role

The code here is what makes GhostProver usable in real workflows:

- from application code through the SDK
- from the terminal through the CLI
- from HTTP services through middleware
- from local tools and agent environments through the daemon and MCP bridge

## Related Areas

- [`../Circuit/`](../Circuit/README.md) contains the Noir circuit workspace
- [`../Compute/`](../Compute/README.md) contains the integration and orchestration layer
- [`../Chain/`](../Chain/README.md) contains the on-chain verifier and registry

For the full product overview, start with the root [README](../README.md).
