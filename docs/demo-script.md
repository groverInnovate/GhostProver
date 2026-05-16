# 3-Minute Judge Demo Script

## 0:00-0:20 — Problem

"AI coding agents can accidentally send secrets and PII into model prompts.
GhostProver gives companies a background compliance layer that proves prompts
were clean without revealing the prompts."

## 0:20-0:45 — Policy

Open the dashboard.

- Show daemon connected.
- Show the active SaaS policy.
- Explain that banking, healthcare, fintech, India KYC, and custom company
  registries use different sensitive-data patterns.

## 0:45-1:20 — Block Risky Prompt

Click **Risk sample**, then **Run scan**.

Say:

"The scan is instant and happens before inference. This prompt contains an AWS
key-like token, so GhostProver blocks it and returns the pattern ID plus byte
offset."

## 1:20-2:10 — Attest Clean Prompt

Click **Clean sample**, **Run scan**, then **Generate proofs**.

Say:

"A clean prompt creates a background proof job. The user workflow can continue
while the daemon generates ZK non-inclusion proofs."

## 2:10-2:40 — Receipt

Open **Receipts**.

Show:

- commitment
- local storage root
- job ID
- proof count
- receipt history

Say:

"The local receipt shape is ready for 0G Storage and 0G Chain anchoring. Live
0G integration plugs into this receipt adapter."

## 2:40-3:00 — Close

"GhostProver is a compliance layer for agentic AI workflows: MCP for coding
agents, local daemon for policy enforcement, ZK proofs for privacy, and 0G for
the final audit trail."
