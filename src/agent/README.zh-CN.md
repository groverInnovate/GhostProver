# GhostProver — Agent Runtime

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含让 GhostProver 成为后台合规系统的本地运行时服务。

## 职责

Agent 层主要负责：

- 运行本地 daemon
- 暴露 MCP bridge
- 本地持久化任务与收据状态
- 支持 Demo、评审与验证流程

## 主要文件

| 文件 | 作用 |
|---|---|
| `daemon.ts` | 本地 HTTP + SSE daemon |
| `mcp-server.ts` | 面向 Agent 工具的 MCP bridge |
| `config.ts` | 本地配置加载与策略解析 |
| `local-store.ts` | 任务与收据的本地 JSONL 持久化 |
| `judge-demo.ts` | 评审 / Demo 预置流程 |
| `daemon-test.ts` | daemon API 验证脚本 |
| `single-proof-test.ts` | 单证明验收流程 |

Agent Runtime 是 GhostProver 本地工作流的运行核心。
