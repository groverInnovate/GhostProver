## Updates
### Update Progress Daily in this Format - Done, Issue Faced, Tomorrow's Plan

---

# Mohit Grover (P1 — ZK Circuit Lead)

### 21 April 2026
- End to End Technical Architecture Done.

### 22 April 2026
1. Wrote a basic Circuit in Noir which checks *Specific* (Not Generic) private input like Aadhaar Number, API key is not present in the prompt. (Prompt — 512 bytes, Secret — 32 bytes).
2. Wrote the Poseidon2 sponge hash as the required stdlib version was not publicly available. Non-inclusion is checked via Sliding Window Algorithm. Wrote tests for edge cases.
3. Proof size and time are sufficient for this project.

**Summary — v1 of GhostProver Circuit is complete.**

### 29 April 2026
1. Audited and cleaned the entire `Chain/` folder:
   - Deleted hand-rolled `src/Vm.sol` (was duplicating forge-std cheatcodes). Replaced with proper `forge-std/Test.sol` and `forge-std/Script.sol` imports.
   - Upgraded `GhostProverRegistry.sol`: `submitReceipt` now accepts `providerAddress`, `modelId`, `storageRoot` — the 0G Compute + Storage fields needed for a real compliance receipt. Event shape now matches the `project.md` spec exactly.
   - Updated `DeployLocal.s.sol` to inherit `forge-std/Script`.
   - Replaced default Foundry boilerplate `README.md` with project-specific contributor docs.
   - Removed dead `foundry.toml` remapping pointing at the Circuit target directory.
2. Added new test `testValidProofWithComputeFields` — verifies that the new providerAddress, modelId, and storageRoot fields are correctly stored and emitted on chain.
3. Updated `Compute/src/demo-receipt.ts` and `scripts/demo-receipt.mjs` to call the new 6-argument `submitReceipt` signature (passing zeros in demo mode).
4. Ran `npm run demo:test` from Compute: proof regenerated in ~32s, all 5 Forge tests pass.

**Issues:** None — all 5 tests green after refactor.

**Tomorrow's Plan (P2):**
- Create `script/Deploy0GTestnet.s.sol` to deploy to 0G Chain testnet (`https://evmrpc-testnet.0g.ai`).
- Coordinate with P3: once `Compute/src/inference.ts` captures a live TEE provider address and `processResponse` passes, wire those into `submitReceipt` instead of zeros.

---

# Component Status (29 Apr 2026)

| Component | Status | Owner |
|---|---|---|
| Noir ZK Circuit (v1) | ✅ Complete — 12 tests pass, proof ~32s | P1 |
| Poseidon2 sponge hash | ✅ Complete — custom sponge, matches stdlib | P1 |
| Sliding window non-inclusion | ✅ Complete — 480 × 32 comparisons, ~18–20k gates | P1 |
| GhostProverRegistry.sol | ✅ Complete — 5 tests pass, 0G fields wired | P1 |
| Verifier.sol (Honk) | ✅ Generated — do not edit | auto |
| Local Anvil demo | ✅ Working — proof → deploy → receipt | P1 |
| 0G Compute SDK wiring | ✅ Mock + live inference, TEE verify helper | P3 |
| 0G Chain testnet deploy | ✅ Deploy0GTestnet.s.sol ready | P2 |
| 0G Storage integration | ✅ storage.ts (upload + Merkle root) | P3 |
| Orchestrator backend | ✅ orchestrator.ts wires full pipeline | P3 |
| React frontend | ⬜ Not started | P3 |

---

### 14 May 2026 (Phase 2 complete)
1. **Toolchain pinned**: `nargo` 1.0.0-beta.18, `bb` CLI + `bb.js` 3.0.0-nightly.20260102, `noir_js` + `noir_wasm` 1.0.0-beta.18. Installed `bb` via `bbup -nv 1.0.0-beta.18`.
2. **Fixed circuit**: `poseidon2_permutation(state)` → `poseidon2_permutation(state, 4)` (4 call sites). `nargo execute` passes. Self-test hash `0x2a7c9afe...` matches.
3. **Fixed proof/verifier mismatch**: bb.js now passes `{ verifierTarget: 'evm' }` to `generateProof` and `getSolidityVerifier` → proof is 9792 bytes (306 fields × 32, logN=18) matching the Solidity verifier.
4. **New artifacts** (`Compute/src/`):
   - `mock-inference.ts` — generates realistic `samples/inference-*.log.json` with TEE attestation envelope.
   - `bridge.ts` — Compute → Circuit: pads prompt/target, computes Poseidon2 hashes, writes Prover.toml.
   - `storage.ts` — 0G Storage upload via `@0gfoundation/0g-storage-ts-sdk`, returns Merkle rootHash.
   - `verify-attestation.ts` — parses zerogAuth envelope, recovers ECDSA signer, verifies request/response hashes.
   - `orchestrator.ts` — full pipeline: inference → bridge → attestation verify → ZK proof → 0G Storage → on-chain receipt.
5. **New artifacts** (`Chain/script/`):
   - `Deploy0GTestnet.s.sol` — Foundry script for deploying HonkVerifier + GhostProverRegistry to 0G testnet, saves to `deployments/0g-testnet.json`.
6. **All 5 Forge tests still pass** (Verifier.sol + GhostProverRegistry.sol).
7. **End-to-end demo runs locally** on Anvil: proof gen ~6s, on-chain submission verified, tampered proofs rejected.

**Issues:** None — all 5 tests green. Live 0G testnet deploy + storage upload pending a funded testnet wallet (low priority — uses same scripts as local).

**Tomorrow's plan:**
- Build React frontend (`Frontend/` — Vite + shadcn/ui).
- Backend orchestrator endpoint: `POST /prove` → returns `{commitment, targetHash, proof, txHash, storageRoot}`.
- Run live testnet demo end-to-end once wallet is funded.