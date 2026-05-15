# GhostProver — Compute

TypeScript harness around the 0G Compute Direct SDK. It runs live mainnet
inference, verifies provider/response TEE attestations through the SDK, archives
the audit bundle to 0G Storage, and submits GhostProver receipts on 0G Chain.

## Setup

```bash
cd Compute
cp .env.example .env          # fill PRIVATE_KEY with a funded mainnet key
npm install
```

Use Node 20+ for the current 0G SDKs. The wallet needs mainnet 0G for gas,
Compute ledger funding, provider sub-account transfer, Storage upload, and
Registry deployment.

## Commands

```bash
# --- Live inference (mainnet by default in .env.example) ---
npm run inference             # writes samples/inference-*.log.json
npm run inference -- "Your custom prompt here."
npm run attest                # dumps verifyService() TEE attestation to reports/
npm run list-services         # lists broker-visible services

# --- Mock inference (no provider needed — same output shape as live) ---
npm run inference:mock        # writes samples/inference-*.log.json
npm run inference:mock -- "Custom prompt"

# --- Bridge: Compute → Circuit ---
# Reads the latest samples/inference-*.log.json, computes Poseidon2 commitments,
# writes Circuit/ghostprover/Prover.toml ready for `nargo execute`.
npm run bridge -- --target "234567890123"
npm run bridge -- --target "ssn-field" --prompt "Override prompt directly"
npm run bridge -- --target "secret" --sample samples/inference-XYZ.log.json
```

### Full end-to-end (mock path)

```bash
npm run inference:mock && npm run bridge -- --target "234567890123"
cd ../Circuit/ghostprover && nargo execute   # witness solved ✓
```

### Full end-to-end (mainnet path)

```bash
# 1. Confirm provider discovery on mainnet.
npm run list-services

# 2. Verify the selected provider's TEE service.
npm run attest

# 3. Run live inference and require processResponse() to pass.
npm run inference -- "In one sentence, explain zero-knowledge proofs."

# 4. Deploy the GhostProver registry on 0G mainnet from ../Chain, then copy
#    deployments/0g-mainnet.json.registry into REGISTRY_ADDRESS in Compute/.env.
cd ../Chain
forge script script/Deploy0G.s.sol:Deploy0G \
  --rpc-url https://evmrpc.0g.ai \
  --private-key $PRIVATE_KEY \
  --broadcast

# 5. Submit an exact receipt or a preset batch receipt from Compute.
cd ../Compute
npm run orchestrate -- --target "234567890123"
npm run orchestrate -- --preset saas
```

## Architecture

```
inference:mock  ──┐
inference       ──┴──▶  samples/inference-<ts>.log.json
                                │
                             bridge.ts
                                │
                         Poseidon2 sponge (JS, matches Noir stdlib)
                         Self-test: 0x2a7c9afe... ← verified against
                         nargo test test_print_prover_hashes
                                │
                   Circuit/ghostprover/Prover.toml  (auto-generated)
                                │
                           nargo execute / nargo prove
```

## What gets captured in `samples/inference-*.log.json`

- `mock: true` — present only for mock runs; absent for live runs.
- `prompt` — the input text sent to the model.
- `zerogAuth.parsed` — enclave-signed envelope: `{request_hash, response_hash,
  model, provider, signer, timestamp, nonce, signature}`.
- `teeVerified` — `broker.inference.processResponse()` result (TEE sig valid).
- `chatID` — response ID used for `processResponse`.

## Mainnet contract configuration

The adapter prefers `@0gfoundation/0g-compute-ts-sdk` and falls back to
`@0glabs/0g-serving-broker`. If your installed SDK can auto-detect mainnet from
`ZG_RPC_URL=https://evmrpc.0g.ai`, no contract env vars are needed. If it cannot,
set all three:

```bash
ZG_LEDGER_CA=0x...
ZG_INFERENCE_CA=0x...
ZG_FINE_TUNING_CA=0x...
```

On mainnet, old hardcoded-testnet SDKs fail fast instead of silently using the
wrong contracts.

## Troubleshooting

- **No providers**: run `npm run list-services`, confirm `ZG_NETWORK=mainnet`,
  `ZG_RPC_URL=https://evmrpc.0g.ai`, and relax `MODEL_FILTER` or set
  `PROVIDER_ADDRESS`.
- **Missing contracts**: install the latest SDK or set all three `ZG_*_CA`
  addresses.
- **Insufficient balance**: set `INITIAL_DEPOSIT=3` for first ledger creation
  and `PROVIDER_TRANSFER_AMOUNT` to fund the selected provider sub-account.
- **Attestation failure**: `npm run inference` records `providerVerified` and
  `teeVerified`; `npm run orchestrate` refuses live unverified samples unless
  `--allow-unverified` is passed for diagnostics.
- **Storage upload failure**: mainnet orchestration refuses to submit a receipt
  with a local-only root unless `ALLOW_LOCAL_STORAGE_ROOT=true` is set for
  diagnostics.
- **Node engine warning**: use Node 20+ for live SDK calls.

## Next (Phase 2 hand-off)

1. `Prover.toml` → `nargo prove` → `proof.json` + `public_inputs.json`
2. `GhostProverRegistry.submitReceipt(proof, publicInputs, attestationBundle)`
   on 0G Chain — `attestationBundle` = `zerogAuth.parsed` + provider signer.
3. 0G Storage audit archive: whole log uploaded, Merkle root anchored in the
   `ComplianceReceiptIssued` event.
