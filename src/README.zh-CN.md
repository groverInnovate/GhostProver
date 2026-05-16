# GhostProver — Source

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 的主要 TypeScript 实现。

它将 Noir 电路与规则注册表转化为开发者可直接使用的产品接口：SDK、CLI、middleware、daemon、MCP bridge 以及本地工作流工具。

## 结构

| 路径 | 作用 |
|---|---|
| `ghostprover.ts` | 核心证明生成与验证封装 |
| `batch-prover.ts` | 批量证明与预扫描逻辑 |
| `cli.ts` | 命令行接口 |
| `middleware.ts` | Express 集成，用于请求拦截与后台证明 |
| `poseidon2.ts` | 与 Noir 电路对齐的 TypeScript Poseidon2 工具 |
| `registry/` | 内置模式、预设与验证辅助逻辑 |
| `agent/` | 本地 daemon、MCP server、judge/demo 辅助与收据存储 |

## 设计角色

该目录中的代码让 GhostProver 能够真正服务于实际工作流：

- 通过 SDK 嵌入应用代码
- 通过 CLI 服务终端流程
- 通过 middleware 服务 HTTP 系统
- 通过 daemon 与 MCP bridge 服务本地工具与 Agent 环境

## 相关目录

- [`../Circuit/`](../Circuit/README.zh-CN.md) 包含 Noir 电路工作区
- [`../Compute/`](../Compute/README.zh-CN.md) 包含集成与编排层
- [`../Chain/`](../Chain/README.zh-CN.md) 包含链上 verifier 与 registry

如需完整产品概览，请从根目录 [README.zh-CN.md](../README.zh-CN.md) 开始。
