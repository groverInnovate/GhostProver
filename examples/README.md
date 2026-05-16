# GhostProver — Examples

[English](./README.md) | [简体中文](./README.zh-CN.md)

This folder contains sample configuration assets for extending GhostProver without changing source code.

## Included Files

| File | Role |
|---|---|
| `custom-registry.json` | Example custom registry with company-specific patterns and presets |
| `.ghostprover.custom.example.json` | Example local config showing how to load a custom registry |
| `.ghostprover.mainnet.example.json` | Example daemon config that enables live 0G mainnet receipt submission |

## When to Use These

Use these examples when you want to:

- define internal sensitive-data patterns
- create organization-specific compliance presets
- test GhostProver with policy files outside the bundled defaults
- run the React/MCP daemon path against the deployed 0G mainnet registry

They are reference assets, not required runtime files.
