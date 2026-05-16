# GhostProver — Scripts

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含仓库级辅助脚本，用于 Demo、fixture 生成、verifier 生成以及本地合约工作流。

这些脚本支持项目运行，但并不是面向应用开发者的主要集成接口。

## 主要脚本

| 文件 | 作用 |
|---|---|
| `write-solidity-verifier.mjs` | 从编译后的 Noir 工件生成 Solidity verifier |
| `write-solidity-verifier-cli.mjs` | verifier 生成的命令行封装 |
| `write-proof-fixture.mjs` | 为本地合约测试生成 proof fixtures |
| `demo-deploy.mjs` | 部署本地 Demo verifier 与 registry |
| `demo-receipt.mjs` | 提交 Demo proof 并输出 receipt 结果 |
| `run-demo-tests.mjs` | 执行本地 Demo 校验流程 |
| `copy-registry-assets.mjs` | 复制构建与 Demo 所需的 registry 资产 |

## 更适合用于产品集成的入口

如果你要将 GhostProver 集成到应用中，建议优先从以下目录开始：

- [`../src/`](../src/README.zh-CN.md) 查看 TypeScript SDK 与 CLI
- [`../Compute/`](../Compute/README.zh-CN.md) 查看编排与 0G 集成
- [`../Chain/`](../Chain/README.zh-CN.md) 查看链上收据提交流程
