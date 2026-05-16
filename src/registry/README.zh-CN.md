# GhostProver — Registry

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 内置的敏感数据注册表。

## 用途

Registry 定义了：

- 模式描述符
- preset 分组
- 验证辅助逻辑

它是连接业务侧合规分类与电路侧证明输入的策略词汇层。

## 文件

| 文件 | 作用 |
|---|---|
| `patterns.json` | 内置模式与预设定义 |
| `index.ts` | Registry 的加载、验证与查询辅助逻辑 |

企业自定义 Registry 可以通过仓库中其他位置说明的配置流程叠加到这些内置默认值之上。
