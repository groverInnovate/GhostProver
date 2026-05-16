# GhostProver — Chain

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 的 Solidity 与 Foundry 工作区，用于实现链上收据层。

它的职责很明确：根据生成的 verifier 合约验证 GhostProver 证明，并在 0G Chain 上发出合规收据事件。

## 目录职责

Chain 层主要负责：

- 在链上验证证明有效性
- 为合法提交发出收据事件
- 支持单证明与批量证明两种收据提交流程
- 将 provider、model 与 storage root 等元数据与证明结果一起携带

## 核心合约

| 合约 | 作用 |
|---|---|
| `src/GhostProverRegistry.sol` | 单条与批量合规收据的主注册表合约 |
| `src/generated/Verifier.sol` | 从 Noir 电路生成的 Solidity verifier |

`Verifier.sol` 属于自动生成文件，不应手动修改。

## 工作区结构

```text
Chain/
├── src/
│   ├── GhostProverRegistry.sol
│   └── generated/
│       └── Verifier.sol
├── script/
│   ├── DeployLocal.s.sol
│   ├── Deploy0G.s.sol
│   └── Deploy0GTestnet.s.sol
├── test/
│   └── GhostProverRegistry.t.sol
├── fixtures/
│   ├── proof.bin
│   ├── public_inputs.bin
│   └── metadata.json
├── deployments/
├── foundry.toml
└── lib/forge-std/
```

## 收据模型

Registry 发出的合规收据可绑定：

- Prompt commitment
- 目标或模式哈希
- 提交者
- provider 地址
- 模型标识
- storage root
- 时间戳

批量收据允许在共享 commitment 与元数据的前提下提交多个 target hash。

## 常用命令

### 运行测试

```bash
cd Chain
forge test -vvv
```

### 本地部署

```bash
anvil

cd Chain
forge script script/DeployLocal.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

### 主网部署

```bash
cd Chain
forge script script/Deploy0G.s.sol:Deploy0G \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 重新生成 fixture 并运行本地 Demo 测试

```bash
cd Compute
npm run demo:test
```

## 测试覆盖

Foundry 测试覆盖以下场景：

- 有效证明通过
- 篡改 proof 被拒绝
- 篡改 commitment 被拒绝
- 篡改 target hash 被拒绝
- Compute 相关字段正确发出
- 批量收据提交
- 批量数组长度不一致时拒绝

## 与仓库其他部分的关系

- 电路定义位于 [`../Circuit/`](../Circuit/README.zh-CN.md)
- 证明生成与编排位于 [`../Compute/`](../Compute/README.zh-CN.md)
- 主 TypeScript SDK 位于 [`../src/`](../src/README.zh-CN.md)

若需查看产品级概览，请先阅读根目录 [README.zh-CN.md](../README.zh-CN.md)。
