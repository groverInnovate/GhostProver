# GhostProver — Circuit

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 使用的 Noir 电路工作区。

它是整个项目的密码学核心：在不泄露 Prompt 的情况下，证明某个敏感字符串或敏感模式没有出现在 Prompt 中。

## 工作区结构

```text
Circuit/
└── ghostprover/
    ├── src/main.nr
    ├── Nargo.toml
    ├── Prover.toml
    └── target/
```

## 电路能力

当前电路支持：

- 精确字符串非包含证明
- 模式化非包含证明
- 基于字符类别的描述符
- 公开 commitment 与 target hash 绑定

仓库中的其余部分则围绕该证明系统构建开发者工具、编排层、存储与收据发放流程。

## 常用命令

```bash
cd Circuit/ghostprover
nargo test
nargo execute
nargo compile
```

## 生成输出

`target/` 目录包含会被仓库其他部分消费的生成工件，包括：

- 编译后的电路输出
- proving 相关产物
- 生成的 Solidity verifier 材料

如果电路接口发生变化，下游 TypeScript 层与 Chain 层都需要重新生成或重新验证。

## 相关目录

- [`../src/`](../src/README.zh-CN.md) 通过 TypeScript SDK 对该电路进行封装
- [`../Chain/`](../Chain/README.zh-CN.md) 使用生成的 verifier 完成链上收据验证
- [`../Compute/`](../Compute/README.zh-CN.md) 负责准备输入并编排提交流程
