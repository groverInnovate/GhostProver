# MCP Setup

GhostProver exposes a stdio MCP server for coding-agent products such as
Claude Code, Codex, and Antigravity.

```bash
npm run daemon
npm run mcp
```

The MCP server is intentionally thin. It does not own policy or persistence;
it forwards all tool calls to the local daemon at `http://127.0.0.1:8787`.

## Tools

| Tool | Purpose |
|---|---|
| `ghostprover_scan_prompt` | Scan a prompt and return clean/blocked results. |
| `ghostprover_attest_prompt` | Scan, then enqueue proofs if the prompt is clean. |
| `ghostprover_get_job` | Read a background job by ID. |
| `ghostprover_list_receipts` | List locally persisted receipts. |
| `ghostprover_list_presets` | List available presets and patterns. |

## Example Tool Input

```json
{
  "prompt": "Rotate the old deployment secret AKIAIOSFODNN7EXAMPLE",
  "preset": "saas"
}
```

Expected summary:

```text
Blocked: 1 sensitive pattern(s) detected.
```

## Important Integration Note

MCP does not automatically intercept every prompt in every coding tool. The
agent workflow must call GhostProver before sending sensitive AI requests, or
the product must add a separate proxy/editor hook later.
