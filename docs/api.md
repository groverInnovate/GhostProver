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
| `GET` | `/v1/config` | Return effective local policy. |
| `GET` | `/v1/presets` | Return merged presets and patterns. |
| `POST` | `/v1/scan` | Fast scan only, no proof generation. |
| `POST` | `/v1/attest` | Scan, block if risky, enqueue proofs if clean. |
| `GET` | `/v1/jobs/:id` | Return latest persisted job snapshot. |
| `GET` | `/v1/receipts` | Return local receipts. |
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
- local `storageRoot`
- `status: "local"`

Live 0G upload and on-chain submission can replace the local receipt adapter
without changing the scan/attest API shape.
