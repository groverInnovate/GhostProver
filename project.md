# GhostProver — Full Project Context

## What we're building
GhostProver — a privacy-preserving compliance attestation layer for AI inference. It produces a cryptographic non-disclosure receipt: a proof that a specific sensitive field (Aadhar, API key, email, etc.) was not present in an AI query prompt. Built for the 0G APAC Hackathon, Track 5: Privacy & Sovereign Infrastructure. Prize pool $150K, submission deadline May 16 2026.

## The core insight
0G's Sealed Inference runs AI inside a TEE and signs the response — proving the response is authentic. But it produces no proof of what wasn't in the input. GhostProver fills that gap with a ZK proof of non-membership, anchored on-chain. TEE + ZK are complementary: TEE proves how (private execution), ZK proves what (field was absent from input). Neither alone is a compliance receipt. Both together are.

## Why it's novel / hasn't been done
- Standard SNARKs prove membership (Merkle paths). Non-membership of a substring requires a sliding window comparison circuit — no standard library exists for this. Custom gadget = technical moat.
- 0G Sealed Inference launched March 2026. Barely any ecosystem built on it yet — first-mover window open.
- Every other Track 5 team will build a privacy mixer or TEE wrapper. GhostProver is a compliance attestation layer — orthogonal to both.
- India's DPDP Act, Singapore's PDPA, GDPR all mandate AI data processing audit trails. No tooling exists for this on decentralised infra.

## 0G Stack usage (all four layers)
- **0G Sealed Inference (TeeML)** — TEE execution + response signing
- **0G Chain (EVM)** — on-chain ZK proof verification + receipt event
- **0G Storage** — immutable full audit bundle archival
- **0G DA** — (stretch) batch proof availability

## Team roles (3 people, 10 days)
- **P1 (Mohit)** — ZK Circuit Lead: Noir proof-of-exclusion circuit, Poseidon commitment, proof generation wrapper in TS
- **P2** — Smart Contract + Chain: Solidity verifier on 0G Chain, GhostProverRegistry.sol, deployment scripts
- **P3** — Integration + Frontend: 0G Compute SDK wiring, TEE attestation, Node/TS orchestrator, React demo UI

## 10-Day Build Plan

### Phase 1 — Days 1–3: ZK Core
- P1: Scope circuit (fix input to 512 bytes max), write Noir circuit v1, test locally with Nargo, export Verifier.sol via nargo codegen-verifier
- P2 parallel: Hardhat/Foundry setup on 0G Chain testnet, deploy HelloWorld to confirm connectivity
- P3 parallel: Install @0glabs/0g-serving-broker, run inference against qwen-2.5-7b-instruct, understand SDK response shape

### Phase 2 — Days 4–6: Smart Contract + Storage
- P2: Deploy Verifier.sol on 0G Chain testnet, build GhostProverRegistry.sol
- P2+P3: 0G Storage anchoring, Merkle root in receipt event
- P3: TEE attestation verification using SDK's processResponse
- P1: TypeScript proof generation wrapper using Barretenberg/bb.js
- All: End-to-end integration test (no frontend yet)

### Phase 3 — Days 7–8: Full Integration
- P3: Backend orchestrator POST /query endpoint (commit → inference → attest → prove → submit → store → return receipt)
- P3: React demo UI (prompt input + field input + submit → show AI response + ZK proof + tx link + storage link + green receipt badge)
- P1: Circuit optimisation pass if proof gen >20s (target ≤60s)
- P2: Verify tampered proof fails on-chain (rejection demo case)

### Phase 4 — Days 9–10: Polish + Submission
- Record 3-minute demo video (live end-to-end)
- Write README + architecture doc
- Submit on HackQuest before May 16 23:59 UTC+8

## Noir Circuit Architecture

### Key Design Decisions
- **Poseidon2 sponge**: The stdlib's `Poseidon2::hash` is `pub(crate)` and inaccessible. We build our own sponge on top of the public `poseidon2_permutation([Field; 4])` primitive. State width = 4 (rate 3, capacity 1). IV = input_length × 2^64.
- **Sliding window**: 480 windows × 32 byte comparisons = 15,360 iterations → ~18-20k gates
- **Mismatch counter**: Used instead of a boolean flag to prevent compiler optimisation from silently skipping constraints.

### Nargo commands
```
nargo new ghostprover
nargo check
nargo test
nargo prove
nargo verify
nargo codegen-verifier  # outputs Verifier.sol
```

## End-to-End Technical Flow (7 steps)

### Step 1 — Prompt Commitment (client, before anything leaves machine)
Compute commitment = Poseidon2(prompt_bytes) client-side. Poseidon used because it's ZK-friendly (~300 constraints vs SHA256's ~25k). Commitment is public; prompt travels only to TEE.

### Step 2 — Sealed Inference (inside TEE)
Encrypted prompt sent to 0G Compute node (qwen-2.5-7b-instruct, TeeML). TEE decrypts in hardware-isolated memory, runs inference, signs {request_hash, response_hash, model_id, timestamp} with its enclave private key. Nobody can read the prompt, not even 0G.

### Step 3 — Attestation Verification (orchestrator backend)
Use SDK: `const isValid = await broker.inference.processResponse(providerAddress, responseContent, chatID)`. Returns boolean. Store {chatID, providerAddress, isVerified: true, timestamp} in audit bundle.

### Step 4 — ZK Proof Generation (Barretenberg/bb.js, ~15–30s)
Feed raw prompt bytes + target field into Noir prover. Circuit proves: (1) Poseidon(prompt_bytes) == commitment, (2) target_field not a substring of prompt_bytes. Output: {proof: "0x...", publicInputs: [commitment, targetFieldHash]}.

### Step 5 — On-Chain Verification (GhostProverRegistry.sol on 0G Chain)
Submit transaction `submitReceipt(proof, publicInputs, attestationBundle)`. Contract calls Noir-generated `Verifier.verify()` — reverts if proof invalid.

```solidity
event ComplianceReceiptIssued(
  bytes32 indexed queryHash,
  bytes32 indexed targetFieldHash,
  address providerAddress,
  string  modelId,
  bytes32 storageRoot,
  uint256 timestamp
);
```

### Step 6 — Audit Archive (0G Storage)
Upload full JSON bundle {commitment, attestation, proof, publicInputs, responseHash, schemaIds, timestamp}. Get Merkle root back.

### Step 7 — Response to User (frontend)
AI response + green "Compliance receipt issued" badge + 0G Chain tx link + 0G Storage receipt link.

**Timing**: Step 1 <50ms, Step 2 1–5s, Step 3 <500ms, Step 4 15–30s, Step 5 2–10s, Step 6 1–3s. Total ~20–50s.

## Standardisation / Schema Registry

Three layers:
1. **Industry Schema Registry** (on-chain, once): SCHEMA_AADHAR, SCHEMA_PAN, SCHEMA_API_KEY, SCHEMA_EMAIL, SCHEMA_SSH_KEY etc.
2. **Company Profile** (registered once at onboarding): Company declares which schema IDs apply.
3. **Automatic silent proof at runtime**: SDK reads profile, generates one ZK proof per registered field in parallel background threads.

## 0G SDK — Key Finding on Attestation
The @0glabs/0g-serving-broker SDK's `processResponse(providerAddress, content, chatID)` handles TEE signature verification internally and returns a boolean. You do NOT need to hand-parse any zerogAuth header.

## Biggest Risks + Mitigations
- **ZK proof gen too slow**: If >2min, switch to hash-comparison approach
- **0G Chain testnet flaky**: Keep Hardhat local fork as fallback
- **zerogAuth format**: SDK handles it — use processResponse
- **Team coordination**: Daily 15-min EOD sync, single status.md

## Pitch Framework

### To technical judges (3-min structure):
- 30s — "AI agents process trade secrets with no way to prove what wasn't leaked"
- 60s — "Noir circuit proves non-membership; verifier on 0G Chain; TEE attestation confirms execution integrity; together = compliance receipt"
- 60s — live demo (prompt → proof → tx on explorer)
- 30s — "ZK + TEE composition is the novelty; neither alone is sufficient"

### Hard Q&A answers:
- "Can prover lie about prompt?" → Commitment + TEE attestation both cover request hash; both must match
- "Why not just TEE?" → TEE gives runtime privacy, no exportable proof; on-chain ZK receipt is independently verifiable
- "512-byte limit?" → Demo scope; scales via chunking
- "Is substring non-membership actually hard?" → Yes — no standard library; wrote custom sliding window gadget

### The analogy
"A notarized NDA receipt for AI inference. An NDA is a promise. Notarization is a verifiable proof. GhostProver is the cryptographic equivalent."

### DPDP Act angle
India's Digital Personal Data Protection Act enforcement timelines are landing right now. APAC-focused hackathon. No competing team will make this connection.
