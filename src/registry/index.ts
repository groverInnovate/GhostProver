// ---------------------------------------------------------------------------
// registry/index.ts — Pattern Registry for GhostProver v2
//
// Loads and queries the sensitive data pattern definitions.
// Each pattern describes a character-class sequence that the ZK circuit
// will prove is absent from an AI prompt.
//
// Usage:
//   import { loadRegistry, getPatternsByPreset } from './registry/index.js';
//   const registry = loadRegistry();
//   const patterns = getPatternsByPreset(registry, 'banking');
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Character class IDs — must match Circuit constants */
export const CLASS = {
  EXACT: 0,
  DIGIT: 1,
  ALPHA_LOWER: 2,
  ALPHA_UPPER: 3,
  ALPHA: 4,
  ALPHANUM: 5,
  HEX: 6,
  BASE64: 7,
  ANY: 8,
} as const;

export interface PatternDefinition {
  name: string;
  description: string;
  industry: string[];
  regulation: string;
  pattern_types: number[];
  pattern_values: number[];
  target_len: number;
  example: string;
}

export interface PresetDefinition {
  name: string;
  description: string;
  patterns: string[];
}

export interface PatternRegistry {
  version: string;
  description: string;
  character_classes: Record<string, number>;
  patterns: Record<string, PatternDefinition>;
  presets: Record<string, PresetDefinition>;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Load the pattern registry from the bundled JSON.
 */
export function loadRegistry(): PatternRegistry {
  const data = require("./patterns.json");
  return data as PatternRegistry;
}

/**
 * Get a single pattern by its ID (e.g., "in.aadhar").
 * @throws if pattern ID is not found.
 */
export function getPatternById(
  registry: PatternRegistry,
  patternId: string
): PatternDefinition {
  const pattern = registry.patterns[patternId];
  if (!pattern) {
    const available = Object.keys(registry.patterns).join(", ");
    throw new Error(
      `Unknown pattern ID: "${patternId}". Available: ${available}`
    );
  }
  return pattern;
}

/**
 * Get all patterns for an industry preset.
 * Returns an array of { id, pattern } objects.
 */
export function getPatternsByPreset(
  registry: PatternRegistry,
  presetName: string
): { id: string; pattern: PatternDefinition }[] {
  const preset = registry.presets[presetName];
  if (!preset) {
    const available = Object.keys(registry.presets).join(", ");
    throw new Error(
      `Unknown preset: "${presetName}". Available: ${available}`
    );
  }
  return preset.patterns.map((id) => ({
    id,
    pattern: getPatternById(registry, id),
  }));
}

/**
 * List all available presets with their metadata.
 */
export function listPresets(
  registry: PatternRegistry
): { id: string; name: string; description: string; patternCount: number }[] {
  return Object.entries(registry.presets).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description,
    patternCount: preset.patterns.length,
  }));
}

/**
 * List all available patterns with brief metadata.
 */
export function listPatterns(
  registry: PatternRegistry
): { id: string; name: string; targetLen: number; industry: string[] }[] {
  return Object.entries(registry.patterns).map(([id, pat]) => ({
    id,
    name: pat.name,
    targetLen: pat.target_len,
    industry: pat.industry,
  }));
}

/**
 * Validate a pattern definition.
 * Checks that arrays are length 32, values are in valid ranges, etc.
 */
export function validatePattern(pattern: PatternDefinition): string[] {
  const errors: string[] = [];

  if (pattern.pattern_types.length !== 32) {
    errors.push(
      `pattern_types must be length 32, got ${pattern.pattern_types.length}`
    );
  }
  if (pattern.pattern_values.length !== 32) {
    errors.push(
      `pattern_values must be length 32, got ${pattern.pattern_values.length}`
    );
  }
  if (pattern.target_len < 1 || pattern.target_len > 32) {
    errors.push(
      `target_len must be 1-32, got ${pattern.target_len}`
    );
  }

  // Check class IDs are valid (0-8)
  for (let i = 0; i < pattern.target_len; i++) {
    const ct = pattern.pattern_types[i];
    if (ct < 0 || ct > 8) {
      errors.push(`pattern_types[${i}] has invalid class ID: ${ct}`);
    }
  }

  // Positions beyond target_len should be 0 (padding)
  for (let i = pattern.target_len; i < 32; i++) {
    if (pattern.pattern_types[i] !== 0) {
      errors.push(
        `pattern_types[${i}] should be 0 (padding), got ${pattern.pattern_types[i]}`
      );
    }
    if (pattern.pattern_values[i] !== 0) {
      errors.push(
        `pattern_values[${i}] should be 0 (padding), got ${pattern.pattern_values[i]}`
      );
    }
  }

  return errors;
}

/**
 * Validate the entire registry. Returns a map of patternId -> errors.
 */
export function validateRegistry(
  registry: PatternRegistry
): Record<string, string[]> {
  const results: Record<string, string[]> = {};
  for (const [id, pattern] of Object.entries(registry.patterns)) {
    const errors = validatePattern(pattern);
    if (errors.length > 0) {
      results[id] = errors;
    }
  }
  // Validate presets reference existing patterns
  for (const [presetId, preset] of Object.entries(registry.presets)) {
    for (const patId of preset.patterns) {
      if (!registry.patterns[patId]) {
        if (!results[presetId]) results[presetId] = [];
        results[presetId].push(
          `Preset "${presetId}" references unknown pattern: "${patId}"`
        );
      }
    }
  }
  return results;
}
