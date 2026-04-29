# GhostProver — Compute

Thin TypeScript harness around `@0glabs/0g-serving-broker` to do exactly what
Day 1 calls for: run inference against **qwen-2.5-7b-instruct** on 0G testnet,
capture the raw response body + `zerogAuth` signature header, and dump the TEE
attestation object shape so Phase 2 (the on-chain verifier + audit bundle) has
a known schema to bind to.

## Setup

```bash
cd Compute
cp .env.example .env          # then fill PRIVATE_KEY with a funded testnet key
npm install                   # or pnpm i / yarn
```

Faucet: https://faucet.0g.ai — the wallet needs both gas and at least
`INITIAL_DEPOSIT` (default 0.1) 0G credited into the Compute ledger for
inference sub-account transfers.

## Commands

```bash
npm run inference             # end-to-end call, writes samples/inference-*.log.json
npm run inference -- "Name three privacy-preserving compliance use cases."
npm run attest                # dumps verifyService() attestation bundle to reports/
npm run list-services         # prints broker-visible services and network context
```

## What gets captured

`samples/inference-<ts>.log.json`:

- `request.headers` — keys returned by `broker.inference.getRequestHeaders()`
  (includes `zerogAuth`, signed per-request by the SDK).
- `response.headers` — all response headers; TEE signature lives in
  `zerogAuth` / `ZG-Res-Key` / `ZG-*`.
- `zerogAuth.parsed` — best-effort decode of the response `zerogAuth` header
  (raw → JSON → base64(JSON)). This is the enclave-signed envelope over
  `{request_hash, response_hash, model_id, timestamp, signer}`.
- `teeVerified` — result of `broker.inference.processResponse(provider, chatID)`
  which handles the signature check internally (per the 0G docs note we do
  **not** hand-parse the header for validation, just log its shape).

`reports/attestation-<provider>.json` (from `npm run attest`):

- `signerVerification.allMatch` — TEE signer address on-chain matches enclave.
- `composeVerification.passed` — docker-compose hash matches the expected build.
- `dockerImages` — pinned image digests running inside the enclave.
- Per-step reports from Intel / NVIDIA attestation flows live alongside it.

## Next (Phase 2 hand-off)

The JSON bundle under `samples/` is the input to:

1. The Noir circuit's public-input binding (commitment = `Poseidon(prompt_bytes)`
   must equal the TEE-attested `request_hash` after the agreed preimage rule).
2. `GhostProverRegistry.submitReceipt(proof, publicInputs, attestationBundle)`
   on 0G Chain — `attestationBundle` = the `zerogAuth.parsed` object + provider
   signer address verified via `processResponse`.
3. The 0G Storage audit archive (whole log file uploaded, Merkle root anchored
   in the `ComplianceReceiptIssued` event).
