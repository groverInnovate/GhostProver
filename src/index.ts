// GhostProver - TypeScript SDK
// Privacy-preserving compliance attestation for AI inference

export {
  generateProof,
  verifyProof,
  computeCommitment,
  computeTargetHash,
} from "./ghostprover.js";

export type { GhostProverInput, GhostProverOutput } from "./ghostprover.js";

export { poseidon2Hash512, poseidon2Hash32, poseidon2HashRaw } from "./poseidon2.js";
