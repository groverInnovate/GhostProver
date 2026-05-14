# GhostProver — Chain

Solidity smart contracts for verifying GhostProver ZK proofs on-chain and issuing compliance receipts on 0G Chain.

---

## Overview

This directory contains the on-chain verification layer for GhostProver. It does one thing: take a Barretenberg Honk ZK proof from the Compute layer, verify it against the Noir-generated verifier contract, and emit a tamper-proof `ComplianceReceiptIssued` event anchoring the proof to a 0G Compute TEE provider and a 0G Storage audit bundle.

---

## Contracts

| Contract | Description |
|---|---|
| `src/GhostProverRegistry.sol` | Core registry. Verifies the ZK non-inclusion proof and emits a `ComplianceReceiptIssued` event with 0G Compute + Storage fields. |
| `src/generated/Verifier.sol` | Auto-generated Honk verifier (Barretenberg). **Do not edit manually** — regenerate with `bb write_solidity_verifier` if the Noir circuit changes. |

---

## Current State (as of 29 Apr 2026)

- ✅ `GhostProverRegistry` compiles and is deployed locally on Anvil  
- ✅ ZK proof verification works end-to-end against the Noir circuit (5/5 tests passing)  
- ✅ Event shape upgraded to include `providerAddress`, `modelId`, `storageRoot` (ready for 0G Compute wiring)  
- ✅ Fixtures in `fixtures/` regenerated and validated against the current circuit  
- ⬜ Not yet deployed to 0G Chain testnet  
- ⬜ `providerAddress` / `modelId` / `storageRoot` are zero-valued in demo mode — real 0G integration pending  

---

## Directory Structure

```
Chain/
├── src/
│   ├── GhostProverRegistry.sol   # Core contract (edit this)
│   └── generated/
│       └── Verifier.sol          # Auto-generated — do not touch
├── script/
│   └── DeployLocal.s.sol         # Foundry broadcast script for local Anvil
├── test/
│   └── GhostProverRegistry.t.sol # 5 Forge tests
├── fixtures/
│   ├── proof.bin                 # Pre-generated ZK proof (binary)
│   ├── public_inputs.bin         # 64 bytes: commitment ‖ targetHash
│   └── metadata.json             # Fixture metadata (prompt, target, hashes, timing)
├── deployments/
│   └── local.json                # Written by DeployLocal.s.sol — Anvil addresses
├── foundry.toml                  # Foundry config
└── lib/forge-std/                # Foundry standard library (git submodule)
```

---

## Event Shape

```solidity
event ComplianceReceiptIssued(
    bytes32 indexed commitment,    // Poseidon2 hash of the AI prompt
    bytes32 indexed targetHash,    // Poseidon2 hash of the sensitive field proven absent
    address indexed submitter,     // wallet that submitted the tx
    address providerAddress,       // 0G Compute TEE provider (zero in demo mode)
    string  modelId,               // AI model used, e.g. "qwen-2.5-7b-instruct" (empty in demo)
    bytes32 storageRoot,           // 0G Storage Merkle root of audit bundle (zero in demo)
    uint256 timestamp              // block.timestamp
);
```

---

## Quick Start

### Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify
forge --version   # >= 0.3.x
anvil --version
```

### 1 — Generate proof fixtures (first time or when circuit changes)

The Forge tests read pre-built proof fixtures from `fixtures/`. Generate them from the Compute layer:

```bash
cd ../Compute
npm install
npm run demo:fixture      # writes Chain/fixtures/proof.bin + public_inputs.bin
```

### 2 — Run the test suite

```bash
cd Chain
forge test -vvv
```

Expected:
```
Ran 5 tests for test/GhostProverRegistry.t.sol:GhostProverRegistryTest
[PASS] testTamperedCommitmentRejected()
[PASS] testTamperedProofRejected()
[PASS] testTamperedTargetHashRejected()
[PASS] testValidProofEmitsReceipt()
[PASS] testValidProofWithComputeFields()
5 passed; 0 failed
```

### 3 — Full local demo (proof → deploy → receipt)

```bash
# Terminal 1: start local chain
anvil

# Terminal 2: deploy contracts, writes Chain/deployments/local.json
cd Chain
forge script script/DeployLocal.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast

# Terminal 3: generate proof + submit receipt + tamper check
cd Compute
npm run demo:receipt
```

### 4 — One-shot test (regenerate fixtures + run forge tests)

```bash
cd Compute
npm run demo:test
```

This runs `write-proof-fixture` → `forge test` in one command. Use this to validate end-to-end after any circuit or contract change.

---

## What the Tests Cover

| Test | What it checks |
|---|---|
| `testValidProofEmitsReceipt` | Valid proof + commitment + targetHash → `ComplianceReceiptIssued` emitted, all fields correct (demo mode: zero 0G fields) |
| `testValidProofWithComputeFields` | Same proof but with real provider address, model ID, and storage root → verifies those fields are correctly stored and emitted |
| `testTamperedProofRejected` | Flip one byte in the proof → transaction reverts with `invalid proof` |
| `testTamperedCommitmentRejected` | XOR one bit on commitment → transaction reverts |
| `testTamperedTargetHashRejected` | XOR one bit on targetHash → transaction reverts |

---

## Regenerating `Verifier.sol`

If the Noir circuit (`Circuit/ghostprover/src/main.nr`) changes, the Solidity verifier must be regenerated:

```bash
cd ../Circuit/ghostprover

# Recompile circuit
nargo execute

# Regenerate proof artifacts
bb prove -b ./target/ghostprover.json -w ./target/ghostprover.gz -o ./target --oracle_hash keccak
bb write_vk -b ./target/ghostprover.json -o ./target --oracle_hash keccak
bb write_solidity_verifier -k ./target/vk -o ./target/Verifier.sol

# Copy to Chain (or use the npm script)
cd ../../Compute
npm run demo:verifier     # copies and regenerates Chain/src/generated/Verifier.sol
```

Then regenerate fixtures and re-run tests:
```bash
npm run demo:test
```

---

## Next Steps (for the team)

These are the outstanding items before 0G Chain testnet deployment:

1. **Deploy to 0G testnet** — create `script/Deploy0GTestnet.s.sol` targeting `https://evmrpc-testnet.0g.ai`. Set `PRIVATE_KEY` and run with `--broadcast`.
2. **Wire real 0G Compute fields** — once `Compute/src/inference.ts` captures a live TEE `providerAddress` and `processResponse` passes, pass those into `submitReceipt` instead of zeros.
3. **Wire 0G Storage root** — once the Compute layer uploads the audit bundle to 0G Storage and gets back a Merkle root, pass it as `storageRoot`.
4. **End-to-end integration test** — a single script: prompt → TEE inference → ZK proof → `submitReceipt` on 0G Chain → verify tx on explorer.
