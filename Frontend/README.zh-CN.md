# GhostProver — Frontend

[English](./README.md) | [简体中文](./README.zh-CN.md)

该目录包含 GhostProver 的 React 操作台。

Frontend 是面向人的界面层，用于承载守护进程驱动的工作流：扫描 Prompt、查看任务以及检查收据。

## 用途

该操作台主要用于：

- 交互式 Prompt 扫描
- 查看 attestation 与 receipts
- 观察 daemon 驱动的工作流进度
- 在 Demo、评审或内部演示中展示产品能力

## 主要文件

| 文件 | 作用 |
|---|---|
| `src/App.jsx` | 主应用界面与工作流 UI |
| `src/registry.js` | 前端使用的 registry 与 preset 辅助逻辑 |
| `src/scanner.js` | 前端请求格式与扫描辅助逻辑 |
| `src/styles.css` | 操作台样式 |

## 本地运行

```bash
cd Frontend
npm install
npm run dev
```

该前端默认依赖本地 GhostProver daemon 所暴露的 API。

## 相关目录

- daemon 与 MCP 入口位于 [`../src/`](../src/README.zh-CN.md)
- API 契约位于 [`../docs/api.md`](../docs/api.md)
- 产品级概览位于根目录 [README.zh-CN.md](../README.zh-CN.md)
