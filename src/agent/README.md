# GhostProver — Agent Runtime

[English](./README.md) | [简体中文](./README.zh-CN.md)

This folder contains the local runtime services that make GhostProver usable as a background compliance system.

## Responsibilities

The agent layer is responsible for:

- running the local daemon
- exposing the MCP bridge
- persisting job and receipt state locally
- supporting demo, judge, and verification workflows

## Main Files

| File | Role |
|---|---|
| `daemon.ts` | Local HTTP + SSE daemon |
| `mcp-server.ts` | MCP bridge for agent-based tooling |
| `config.ts` | Local configuration loading and policy resolution |
| `local-store.ts` | Local JSONL persistence for jobs and receipts |
| `judge-demo.ts` | Judge/demo seed flow |
| `daemon-test.ts` | Daemon API verification script |
| `single-proof-test.ts` | One-proof acceptance flow |

The agent runtime is the operational heart of GhostProver's local workflow.
