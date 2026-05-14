# GhostProver — Compute

Thin TypeScript harness around `@0glabs/0g-serving-broker` to run inference on
the 0G Compute Network, capture the raw response + `zerogAuth` TEE attestation
header, and feed the result into the Noir circuit via the **bridge**.

## Setup

```bash
cd Compute
cp .env.example .env          # fill PRIVATE_KEY with a funded testnet key
npm install
```

Faucet: https://faucet.0g.ai — wallet needs gas + at least `INITIAL_DEPOSIT`
(default 1) 0G credited into the Compute ledger.

## Commands

```bash
# --- Live inference (requires a live 0G testnet/mainnet provider) ---
npm run inference             # writes samples/inference-*.log.json
npm run inference -- "Your custom prompt here."
npm run attest                # dumps verifyService() TEE attestation to reports/
npm run list-services         # lists broker-visible services

# --- Mock inference (no provider needed — same output shape as live) ---
npm run inference:mock        # writes samples/inference-*.log.json  ← use this when testnet is down
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

## Mainnet migration path

`@0glabs/0g-serving-broker@0.4.4` has **hardcoded testnet contract addresses**.
When mainnet Compute launches, either:

1. Upgrade to a newer SDK version that auto-detects the chain, **OR**
2. Pass mainnet contract addresses explicitly:
   ```ts
   createZGComputeNetworkBroker(wallet, LEDGER_CA, INFERENCE_CA, FINE_TUNING_CA)
   ```
   and set `ZG_RPC_URL=https://evmrpc.0g.ai` in `.env`.

No other code changes needed — `inference.ts`, `mock-inference.ts`, and
`bridge.ts` all read `ZG_RPC_URL` from `.env` and are network-agnostic.

## Next (Phase 2 hand-off)

1. `Prover.toml` → `nargo prove` → `proof.json` + `public_inputs.json`
2. `GhostProverRegistry.submitReceipt(proof, publicInputs, attestationBundle)`
   on 0G Chain — `attestationBundle` = `zerogAuth.parsed` + provider signer.
3. 0G Storage audit archive: whole log uploaded, Merkle root anchored in the
   `ComplianceReceiptIssued` event.
