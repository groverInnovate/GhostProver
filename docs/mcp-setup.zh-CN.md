# MCP 配置说明

GhostProver 为 Claude Code、Codex、Cursor、Windsurf 及 Antigravity 等编码 Agent 产品提供 stdio MCP 服务器。

```bash
npm run daemon
npm run mcp
```

MCP 服务器设计为轻量级桥接层。它本身不持有策略或持久化数据，而是将所有工具调用转发给本地守护进程（`http://127.0.0.1:8787`）。

## 工具列表

| 工具 | 说明 |
|---|---|
| `ghostprover_status` | 读取守护进程健康状态、生效策略、最新任务和最新收据。 |
| `ghostprover_scan_prompt` | 扫描 Prompt，返回干净/阻断结果。 |
| `ghostprover_attest_prompt` | 扫描 Prompt，若干净则排队生成证明。 |
| `ghostprover_list_jobs` | 列出最近的证明任务，支持按状态过滤。 |
| `ghostprover_get_job` | 按 ID 读取后台任务。 |
| `ghostprover_list_receipts` | 列出本地持久化的收据。 |
| `ghostprover_list_presets` | 列出可用的预设规则与模式。 |

## 工具调用示例

```json
{
  "prompt": "Rotate the old deployment secret AKIAIOSFODNN7EXAMPLE",
  "preset": "saas"
}
```

预期结果：

```text
Blocked: 1 sensitive pattern(s) detected.
```

## 接入各 Agent 工具

**配置块（所有工具通用）：**

```json
{
  "mcpServers": {
    "ghostprover": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/GhostProver"
    }
  }
}
```

| 工具 | 配置文件路径 |
|---|---|
| Claude Code | `~/.claude/claude_desktop_config.json` 或工作区 `.mcp.json` |
| Cursor | `~/.cursor/mcp.json` 或项目内 `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline（VS Code） | MCP Servers → Add Server UI |
| Continue（VS Code） | `~/.continue/config.json` 中的 `mcpServers` 块 |

> 启动任意 Agent 工具前，请先在单独的终端中运行 `npm run daemon`。若守护进程未启动，所有 MCP 工具调用都会返回"守护进程不可达"错误。

## 重要说明

MCP 不会自动拦截每一个 AI Prompt。Agent 工作流必须在将 Prompt 发送给模型之前，显式调用 `ghostprover_scan_prompt` 或 `ghostprover_attest_prompt`。
