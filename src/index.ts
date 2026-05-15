// GhostProver - TypeScript SDK (v2)
// Privacy-preserving compliance attestation for AI inference
// Supports both exact-match and pattern-based non-inclusion proofs

// Core proof generation (exact + pattern mode)
export {
  generateProof,
  generatePatternProof,
  verifyProof,
  computeCommitment,
  computeTargetHash,
  computePatternHash,
} from "./ghostprover.js";

export type {
  GhostProverInput,
  PatternProofInput,
  GhostProverOutput,
} from "./ghostprover.js";

// Poseidon2 hash functions
export {
  poseidon2Hash512,
  poseidon2Hash32,
  poseidon2Hash64,
  poseidon2HashRaw,
} from "./poseidon2.js";

// Pattern registry
export {
  loadRegistry,
  getPatternById,
  getPatternsByPreset,
  listPresets,
  listPatterns,
  validatePattern,
  validateRegistry,
  CLASS,
} from "./registry/index.js";

export type {
  PatternDefinition,
  PresetDefinition,
  PatternRegistry,
} from "./registry/index.js";

// Batch proof generation
export {
  generateBatchProofs,
  scanPrompt,
  scanPatternIds,
} from "./batch-prover.js";

export type {
  BatchProofInput,
  BatchProofOutput,
  PatternProofResult,
  ProofStatus,
} from "./batch-prover.js";

// Express middleware
export {
  ghostProverMiddleware,
  loadConfig,
} from "./middleware.js";

export type {
  GhostProverMiddlewareConfig,
  GhostProverRequestContext,
} from "./middleware.js";

export {
  loadGhostProverConfig,
  loadEffectiveRegistry,
  publicConfig,
  resolvePolicyPatternIds,
} from "./config.js";

export type {
  GhostProverConfig,
  EffectiveGhostProverConfig,
} from "./config.js";

export {
  startDaemon,
} from "./daemon.js";

export {
  LocalStore,
} from "./local-store.js";

export type {
  StoredJob,
  StoredReceipt,
  JobStatus,
} from "./local-store.js";
