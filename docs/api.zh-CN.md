# GhostProver 守护进程 API

守护进程在本地运行，是 React 操作台与 MCP 工具的统一数据来源。

```bash
npm run daemon
```

默认 base URL：

```text
http://127.0.0.1:8787
```

## 接口列表

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 检查守护进程是否可用。 |
| `GET` | `/v1/status` | 返回健康状态、生效配置、统计信息、最新任务和最新收据。 |
| `GET` | `/v1/config` | 返回当前生效的本地策略。 |
| `GET` | `/v1/presets` | 返回合并后的预设规则与模式列表。 |
| `POST` | `/v1/scan` | 仅做快速扫描，不生成证明。 |
| `POST` | `/v1/attest` | 扫描 Prompt：有风险则阻断，无风险则排队生成证明。 |
| `GET` | `/v1/jobs` | 返回最近持久化的任务快照，支持 `limit` 和 `status` 参数。 |
| `GET` | `/v1/jobs/:id` | 返回指定任务的最新快照。 |
| `GET` | `/v1/receipts` | 返回守护进程缓存中的收据记录。 |
| `GET` | `/v1/events` | 通过 SSE 推送任务与收据的实时更新。 |

## 干净扫描示例

```bash
curl -s -X POST http://127.0.0.1:8787/v1/scan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"hello world","preset":"saas"}'
```

预期结果：

```json
{
  "clean": true,
  "blocked": false,
  "patternIds": ["tech.aws_key", "tech.github_pat", "..."],
  "matches": []
}
```

## 阻断扫描示例

```bash
curl -s -X POST http://127.0.0.1:8787/v1/scan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"secret AKIAIOSFODNN7EXAMPLE here","preset":"saas"}'
```

预期结果：

```json
{
  "clean": false,
  "blocked": true,
  "matches": [
    { "id": "tech.aws_key", "name": "AWS Access Key ID", "offset": 7 }
  ]
}
```

## 排队合规证明示例

```bash
curl -s -X POST http://127.0.0.1:8787/v1/attest \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"hello world","preset":"saas","patterns":["tech.aws_key"]}'
```

预期结果：

```json
{
  "blocked": false,
  "job": {
    "status": "queued",
    "patternIds": ["tech.aws_key"]
  }
}
```

## 收据查询

```bash
curl -s http://127.0.0.1:8787/v1/receipts
```

收据字段包含：

- `commitment`
- `targetHashes`
- `proofStatuses`
- `storageRoot`
- `status`：`"draft"`、`"on_chain"` 或 `"on_chain_failed"`
- 当启用 `onChainSubmit` 时，还包含可选的 `txHash`、`providerAddress` 和 `modelId`

当 `.ghostprover.json` 中配置了 `onChainSubmit: true` 时，`POST /v1/attest` 仍从守护进程发起，但最终收据会通过 Compute 0G Orchestrator 提交。`draft` 记录只是守护进程的调试缓存，最终合规工件是具有 0G 交易哈希的 `on_chain` 收据。

## 错误处理

超出电路限制的 Prompt 会被拒绝，而非截断：

```json
{
  "error": "Prompt exceeds GhostProver's 512-byte circuit limit: 513 bytes",
  "code": "PROMPT_TOO_LARGE"
}
```

HTTP 状态码含义明确：无效输入返回 `400`，Prompt 过大返回 `413`，任务不存在返回 `404`，守护进程内部错误返回 `500`。
