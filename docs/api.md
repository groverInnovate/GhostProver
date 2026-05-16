# GhostProver Daemon API

The daemon runs locally and is the source of truth for the React console and
MCP tools.

```bash
npm run daemon
```

Default base URL:

```text
http://127.0.0.1:8787
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Check daemon availability. |
| `GET` | `/v1/status` | Return health, effective config, counts, latest job, and latest receipt. |
| `GET` | `/v1/config` | Return effective local policy. |
| `GET` | `/v1/presets` | Return merged presets and patterns. |
| `POST` | `/v1/scan` | Fast scan only, no proof generation. |
| `POST` | `/v1/attest` | Scan, block if risky, enqueue proofs if clean. |
| `GET` | `/v1/jobs` | Return recent persisted job snapshots. Supports `limit` and `status`. |
| `GET` | `/v1/jobs/:id` | Return latest persisted job snapshot. |
| `GET` | `/v1/receipts` | Return receipt records from the daemon cache. |
| `GET` | `/v1/events` | Server-Sent Events for job and receipt updates. |

## Clean Scan

```bash
curl -s -X POST http://127.0.0.1:8787/v1/scan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"hello world","preset":"saas"}'
```

Expected result:

```json
{
  "clean": true,
  "blocked": false,
  "patternIds": ["tech.aws_key", "tech.github_pat", "..."],
  "matches": []
}
```

## Blocked Scan

```bash
curl -s -X POST http://127.0.0.1:8787/v1/scan \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"secret AKIAIOSFODNN7EXAMPLE here","preset":"saas"}'
```

Expected result:

```json
{
  "clean": false,
  "blocked": true,
  "matches": [
    { "id": "tech.aws_key", "name": "AWS Access Key ID", "offset": 7 }
  ]
}
```

## Queued Attestation

```bash
curl -s -X POST http://127.0.0.1:8787/v1/attest \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"hello world","preset":"saas","patterns":["tech.aws_key"]}'
```

Expected result:

```json
{
  "blocked": false,
  "job": {
    "status": "queued",
    "patternIds": ["tech.aws_key"]
  }
}
```

## Receipt Lookup

```bash
curl -s http://127.0.0.1:8787/v1/receipts
```

Receipts include:

- `commitment`
- `targetHashes`
- `proofStatuses`
- `storageRoot`
- `status`: `"draft"`, `"on_chain"`, or `"on_chain_failed"`
- optional `txHash`, `providerAddress`, and `modelId` when `onChainSubmit` is enabled

When `.ghostprover.json` has `onChainSubmit: true`, `POST /v1/attest` still
starts from the daemon but the completed receipt is submitted through the
Compute 0G orchestrator. A `draft` record is only the daemon queue/debug cache;
the compliance artifact is the `on_chain` receipt with a 0G transaction hash.

## Error Handling

Prompts over the circuit limit are rejected instead of truncated:

```json
{
  "error": "Prompt exceeds GhostProver's 512-byte circuit limit: 513 bytes",
  "code": "PROMPT_TOO_LARGE"
}
```

HTTP status codes are intentional: invalid input returns `400`, oversized
prompts return `413`, missing jobs return `404`, and unexpected daemon failures
return `500`.
