# GhostProver — Compute

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 的 Compute、attestation、storage 与 orchestration 层。

它负责将实时或模拟推理接入零知识证明流程，并准备后续归档与链上收据所需的数据。

## 目录职责

Compute 工作区主要负责：

- 捕获推理日志
- 检查 provider 与 TEE 相关元数据
- 将 Prompt 数据桥接为 `Prover.toml`
- 生成或协调证明输入
- 上传审计包到 0G Storage
- 将收据提交到链上 Registry

它是 GhostProver 证明系统与 0G 工作流之间的集成层。

## 主要组件

| 文件 | 作用 |
|---|---|
| `src/inference.ts` | 实时推理捕获与日志记录 |
| `src/mock-inference.ts` | 与下游结构一致的模拟推理路径 |
| `src/attestation.ts` | Provider attestation 检查与报告输出 |
| `src/verify-attestation.ts` | TEE 相关验证辅助逻辑 |
| `src/bridge.ts` | Prompt/target 到 Noir 电路输入格式的桥接 |
| `src/storage.ts` | 0G Storage 上传与 storage-root 生成 |
| `src/orchestrator.ts` | 推理、证明、存储与收据提交的一体化编排 |

## 典型流程

```text
Inference / Mock Inference
        ↓
samples/inference-*.log.json
        ↓
bridge.ts
        ↓
Circuit/ghostprover/Prover.toml
        ↓
Proof generation
        ↓
0G Storage upload
        ↓
0G Chain receipt submission
```

## 初始化

```bash
cd Compute
cp .env.example .env
npm install
```

建议使用 Node 20+。

## 常用命令

### 实时推理

```bash
npm run list-services
npm run attest
npm run inference -- "In one sentence, explain zero-knowledge proofs."
```

### 模拟推理

```bash
npm run inference:mock
npm run inference:mock -- "Custom prompt"
```

### 将 Prompt 桥接进电路

```bash
npm run bridge -- --target "234567890123"
npm run bridge -- --target "secret" --sample samples/inference-XYZ.log.json
```

### 端到端编排

```bash
npm run orchestrate -- --target "234567890123"
npm run orchestrate -- --preset saas
```

## 主网说明

Compute 层是 GhostProver 与 0G 技术栈交互最直接的部分：

- **0G Compute / Private Compute**：用于推理与 provider 侧验证上下文
- **0G Storage**：用于审计包归档
- **0G Chain**：用于最终链上收据提交

根据所安装的 SDK 版本不同，你可能需要在 `.env` 中显式提供主网合约地址，尤其是在 SDK 无法通过 `ZG_RPC_URL` 自动识别主网时。

## 生成产物

该目录也会生成或保存一些运行时工件，例如：

- `samples/inference-*.log.json`
- `reports/attestation-*.json`
- storage 上传元数据
- 与收据提交相关的 orchestration 输出

报告相关说明见 [`reports/README.zh-CN.md`](reports/README.zh-CN.md)。

## 与仓库其他部分的关系

- 电路定义位于 [`../Circuit/`](../Circuit/README.zh-CN.md)
- 链上 Registry 与 verifier 位于 [`../Chain/`](../Chain/README.zh-CN.md)
- 核心 TypeScript SDK 位于 [`../src/`](../src/README.zh-CN.md)

如需了解完整产品概览，请从根目录 [README.zh-CN.md](../README.zh-CN.md) 开始。
