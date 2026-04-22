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
```


## License

MIT
