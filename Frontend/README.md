# GhostProver — Frontend

[English](./README.md) | [简体中文](./README.zh-CN.md)

This folder contains the React-based operator console for GhostProver.

The frontend is the human-facing interface for the daemon-backed workflow: scanning prompts, reviewing jobs, and inspecting receipts.

## Purpose

The operator console is intended for:

- interactive prompt scanning
- reviewing attestations and receipts
- watching daemon-backed workflow progress
- demonstrating the product during demos, judging, or internal reviews

## Main Files

| File | Role |
|---|---|
| `src/App.jsx` | Main application shell and workflow UI |
| `src/registry.js` | Registry and preset helpers used by the interface |
| `src/scanner.js` | Frontend-side request formatting and scan helpers |
| `src/styles.css` | Visual styling for the console |

## Run Locally

```bash
cd Frontend
npm install
npm run dev
```

The frontend expects the local GhostProver daemon to be available at the configured API base URL.

## Related Areas

- The daemon and MCP entry points live under [`../src/`](../src/README.md)
- The API contract is documented in [`../docs/api.md`](../docs/api.md)
- The product overview lives in the root [README](../README.md)
