# GhostProver

Privacy-preserving proof that a sensitive field (Aadhar number, API key, email) was **not** present in an AI inference prompt.

## How it works

A ZK circuit proves three things simultaneously:

1. The prover knows a prompt that hashes to a public **commitment**
2. The prover knows a target field that hashes to a public **target_hash**
3. The target field does **not** appear as a substring anywhere in the prompt

The result is a cryptographic non-disclosure receipt — verifiable on-chain without revealing either the prompt or the sensitive data.

## Architecture

```
User prompt (private)  ─┐
                        ├─► Noir Circuit ─► ZK Proof ─► Verifier.sol ─► On-chain receipt
Sensitive field (private) ┘
```


## Quick start

```bash
# Prerequisites: nargo v1.0.0-beta.20, bb (Barretenberg CLI)

cd Circuit/ghostprover

# Run tests (12 test cases including edge cases)
nargo test

# Execute the circuit with Prover.toml inputs
nargo execute

# Generate proof + Solidity verifier
bb prove -b ./target/ghostprover.json -w ./target/ghostprover.gz -o ./target --oracle_hash keccak
bb write_vk -b ./target/ghostprover.json -o ./target --oracle_hash keccak
bb write_solidity_verifier -k ./target/vk -o ./target/Verifier.sol
```

## Local receipt demo

This repository now includes a **demo-mode** local receipt flow. It proves the
ZK proof can be generated and verified on-chain locally, but it is **not** full
0G integration yet.

```bash
# terminal 1
anvil

# terminal 2
cd Compute
npm run demo:deploy

# terminal 3
npm run demo:receipt
```

Generate a fresh proof fixture and run the local receipt tests with one command:

```bash
cd Compute
npm run demo:test
```

The demo test flow covers:
- valid proof emits `ComplianceReceiptIssued`
- tampered proof is rejected
- tampered commitment is rejected
- tampered target hash is rejected

## Demo limitations

The local receipt demo is intentionally partial:

- The prompt and target are hardcoded local sample inputs.
- There is no live 0G provider in the flow.
- There is no TEE attestation, `zerogAuth`, or `processResponse()` verification.
- There is no 0G Storage upload or storage root.
- The chain target is local Anvil, not 0G Chain.
- The verifier artifact is reused from the checked-in Noir output.

The missing integration step is the eventual binding between the proof
commitment and a real TEE-attested request identity from 0G Compute.


## Project structure

```
Circuit/ghostprover/
├── src/main.nr       # ZK circuit (non-inclusion logic + Poseidon2 sponge)
├── Nargo.toml        # Noir project config
├── Prover.toml       # Example inputs (medical AI query + Aadhar number)
└── target/
    ├── Verifier.sol  # Auto-generated Solidity verifier
    ├── proof         # Binary proof
    └── vk            # Verification key

Chain/
├── src/GhostProverRegistry.sol   # Demo-mode receipt registry
├── script/DeployLocal.s.sol      # Local Anvil deployment script
└── test/GhostProverRegistry.t.sol # Valid/tamper proof tests

Compute/
└── src/demo-receipt.ts           # Local proof-to-receipt demo driver
```


## License

MIT
