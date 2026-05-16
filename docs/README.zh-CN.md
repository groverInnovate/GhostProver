# GhostProver — Documentation

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 的主要文字文档。

其中既包括架构说明、集成指南、Demo 材料，也包括项目规划与实现历史。

## 内容

| 文件 | 作用 |
|---|---|
| `background-agent-workflow.md` | 系统架构与 daemon / MCP 工作流 |
| `api.md` | 本地 daemon API 参考 |
| `mcp-setup.md` | Agent 工具的 MCP 配置说明 |
| `demo-script.md` | Demo / 评审演示脚本 |
| `limitations.md` | 当前范围说明与后续扩展方向 |
| `project-plan.md` | 原始项目规划与构建计划 |
| `implementation-log.md` | 详细里程碑与实现日志 |
| `handoff-summary.md` | 给后续贡献者的简明交接说明 |
| `assets/` | 文档、展示与演示用静态资源 |

## 推荐阅读顺序

1. 先从根目录 [README.zh-CN.md](../README.zh-CN.md) 了解产品整体概览
2. 阅读 `background-agent-workflow.md` 理解系统架构与运行流程
3. 如果你需要集成 daemon，请继续阅读 `api.md`
4. 如果你要接入 Agent 工具，请阅读 `mcp-setup.md`
5. 若要了解项目历史与上下文，可继续阅读 `project-plan.md`、`implementation-log.md` 与 `handoff-summary.md`
