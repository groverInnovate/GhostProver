# GhostProver Diagrams

This file collects Mermaid diagrams that explain the main technical flows in GhostProver.

Use these diagrams for:

- project walkthroughs
- hackathon or judge presentations
- onboarding contributors
- architecture discussions
- social or technical documentation drafts

## 1. High-Level Product Architecture

```mermaid
flowchart LR
  User["Developer / Agent Workflow"] --> MCP["GhostProver MCP tools"]
  Console["React operator console"] --> Daemon["Local daemon\nHTTP + SSE"]
  MCP --> Daemon
  Daemon --> Policy[".ghostprover.json\npolicy + custom registry"]
  Policy --> Scan["Pattern scan\nprivate prompt bytes"]
  Scan -->|Sensitive data found| Block["Block response\npersist blocked job"]
  Scan -->|Clean prompt| Queue["Background proof job"]
  Queue --> Batch["Batch prover\nNoir + bb.js"]
  Batch --> Receipt["Local JSONL receipt\ncommitment + target hashes"]
  Receipt --> Stack0G["0G adapters\nCompute + Storage + Chain"]
  Daemon --> Console
```

## 2. Background Agent Workflow

```mermaid
flowchart TD
  A["Developer uses Claude Code / Codex / Antigravity"] --> B["MCP tool: scan or attest prompt"]
  B --> C["GhostProver daemon<br/>localhost:8787"]
  C --> D["Load .ghostprover.json policy"]
  D --> E["Merge bundled registry<br/>+ optional custom registry"]
  E --> F["Fast JS pre-flight scan"]
  F --> G{"Sensitive pattern found?"}

  G -->|Yes| H["Block by default"]
  H --> I["Persist blocked job<br/>.ghostprover/jobs.jsonl"]
  I --> J["Return pattern IDs + byte offsets"]

  G -->|No| K["Create queued proof job"]
  K --> L["Persist job snapshot<br/>.ghostprover/jobs.jsonl"]
  L --> M["Generate pattern proofs<br/>Noir witness + bb.js"]
  M --> N["Emit SSE progress<br/>/v1/events"]
  N --> O["Create local receipt"]
  O --> P["Persist receipt<br/>.ghostprover/receipts.jsonl"]
  P --> Q["React console shows job + receipt"]
```

## 3. End-to-End 0G Flow

```mermaid
flowchart TD
  Prompt["Prompt enters GhostProver"] --> Preflight["Pre-flight pattern scan"]
  Preflight -->|Risk detected| Stop["Block request and persist blocked job"]
  Preflight -->|Clean| Inference["0G Compute / Private Compute inference"]
  Inference --> Tee["TEE-related metadata / attestation capture"]
  Tee --> Bridge["Bridge prompt data into circuit inputs"]
  Bridge --> Proof["Generate ZK proof\nNoir + bb.js"]
  Proof --> Storage["Archive audit bundle to 0G Storage"]
  Storage --> Root["Compute / receive storage root"]
  Root --> Chain["Submit receipt to GhostProverRegistry on 0G Chain"]
  Chain --> Receipt["Compliance receipt event"]
```

## 4. ZK Proof Lifecycle

```mermaid
sequenceDiagram
  participant App as App / Agent
  participant GP as GhostProver SDK
  participant Circuit as Noir Circuit
  participant BB as Barretenberg
  participant Registry as Chain Registry

  App->>GP: Submit prompt + preset / target
  GP->>GP: Compute prompt commitment
  GP->>GP: Resolve pattern or target hash
  GP->>Circuit: Build witness inputs
  Circuit-->>GP: Solved witness
  GP->>BB: Generate proof
  BB-->>GP: Proof + public inputs
  GP->>Registry: submitReceipt / submitBatchReceipt
  Registry-->>App: Compliance receipt emitted
```

## 5. 0G Component Mapping

```mermaid
flowchart LR
  Compute["0G Compute / Private Compute"] --> Evidence["Inference output + TEE context"]
  Evidence --> Prover["GhostProver proof pipeline"]
  Prover --> Storage["0G Storage"]
  Storage --> Root["Storage root"]
  Root --> Chain["0G Chain"]
  Chain --> Receipt["On-chain compliance receipt"]
```

## 6. Local Demo Flow

```mermaid
flowchart LR
  Judge["Judge / Operator"] --> Console["Frontend console"]
  Console --> Daemon["ghostprover daemon"]
  Daemon --> Scan["Scan / attest API"]
  Scan --> Queue["Background proof job"]
  Queue --> Proof["Proof generation"]
  Proof --> LocalReceipt["Local receipt store"]
  LocalReceipt --> Console
```

## 7. Repository Structure Map

```mermaid
flowchart TD
  Root["GhostProver Repository"] --> SRC["src/\nSDK + CLI + daemon + registry"]
  Root --> CIRCUIT["Circuit/\nNoir circuit workspace"]
  Root --> CHAIN["Chain/\nSolidity verifier + registry"]
  Root --> COMPUTE["Compute/\n0G integration + orchestration"]
  Root --> FRONTEND["Frontend/\nReact operator console"]
  Root --> DOCS["docs/\narchitecture, API, guides"]
  Root --> EXAMPLES["examples/\ncustom registry samples"]
  Root --> SCRIPTS["scripts/\nhelper and demo scripts"]
```

## 8. Single Prompt Decision Flow

```mermaid
flowchart TD
  Input["Incoming prompt"] --> Policy["Load preset / pattern policy"]
  Policy --> Scan["Fast scan against sensitive patterns"]
  Scan --> Match{"Any match found?"}
  Match -->|Yes| Reject["Block prompt\nReturn matched patterns + offsets"]
  Match -->|No| Accept["Queue proof generation"]
  Accept --> Receipt["Persist proof status and receipt"]
```

## Notes

- These diagrams are documentation assets only.
- They are intentionally high level and should be paired with the more detailed docs in this folder when needed.
- For runtime/API specifics, see [`api.md`](api.md) and [`background-agent-workflow.md`](background-agent-workflow.md).
