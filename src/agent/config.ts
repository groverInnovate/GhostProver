import * as fs from "fs";
import * as path from "path";
import {
  loadRegistry,
  validateRegistry,
  type PatternRegistry,
} from "../registry/index.js";

/**
 * Runtime policy used by the daemon, MCP server, middleware-style integrations,
 * and the React console. This is intentionally small and file-based so a team
 * can drop GhostProver into an existing repo without provisioning a database.
 */
export interface GhostProverConfig {
  preset: string;
  patterns: string[];
  customRegistryPath: string;
  blockOnDetection: boolean;
  proofMode: "background" | "scan_only";
  concurrency: number;
  daemon: {
    host: string;
    port: number;
  };
  storage: {
    dir: string;
  };
  onChainSubmit: boolean;
  registryAddress: string;
  rpcUrl: string;
}

export interface EffectiveGhostProverConfig extends GhostProverConfig {
  configPath: string;
  storageDir: string;
}

export const DEFAULT_CONFIG: GhostProverConfig = {
  preset: "saas",
  patterns: [],
  customRegistryPath: "",
  blockOnDetection: true,
  proofMode: "background",
  concurrency: 1,
  daemon: {
    host: "127.0.0.1",
    port: 8787,
  },
  storage: {
    dir: ".ghostprover",
  },
  onChainSubmit: false,
  registryAddress: "",
  rpcUrl: "https://evmrpc.0g.ai",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeConfig(base: GhostProverConfig, raw: Record<string, unknown>): GhostProverConfig {
  return {
    ...base,
    ...raw,
    patterns: Array.isArray(raw.patterns) ? raw.patterns.map(String) : base.patterns,
    blockOnDetection:
      typeof raw.blockOnDetection === "boolean" ? raw.blockOnDetection : base.blockOnDetection,
    concurrency:
      typeof raw.concurrency === "number" && Number.isFinite(raw.concurrency)
        ? raw.concurrency
        : base.concurrency,
    daemon: {
      ...base.daemon,
      ...(isObject(raw.daemon) ? raw.daemon : {}),
    },
    storage: {
      ...base.storage,
      ...(isObject(raw.storage) ? raw.storage : {}),
    },
  } as GhostProverConfig;
}

export function resolveConfigPath(cwd = process.cwd(), configPath?: string): string {
  return path.resolve(cwd, configPath ?? ".ghostprover.json");
}

export function loadGhostProverConfig(
  cwd = process.cwd(),
  configPath?: string
): EffectiveGhostProverConfig {
  const resolved = resolveConfigPath(cwd, configPath);
  let config = DEFAULT_CONFIG;

  if (fs.existsSync(resolved)) {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as Record<string, unknown>;
    config = mergeConfig(DEFAULT_CONFIG, raw);
  }

  const storageDir = path.resolve(cwd, config.storage.dir);
  return {
    ...config,
    daemon: {
      host: String(config.daemon.host ?? DEFAULT_CONFIG.daemon.host),
      port: Number(config.daemon.port ?? DEFAULT_CONFIG.daemon.port),
    },
    storage: {
      dir: String(config.storage.dir ?? DEFAULT_CONFIG.storage.dir),
    },
    configPath: resolved,
    storageDir,
  };
}

export function createDefaultConfig(): GhostProverConfig {
  return { ...DEFAULT_CONFIG, daemon: { ...DEFAULT_CONFIG.daemon }, storage: { ...DEFAULT_CONFIG.storage } };
}

export function writeDefaultConfig(cwd = process.cwd(), configPath?: string): string {
  const resolved = resolveConfigPath(cwd, configPath);
  fs.writeFileSync(resolved, JSON.stringify(createDefaultConfig(), null, 2) + "\n");
  return resolved;
}

function resolveCustomRegistryPath(config: EffectiveGhostProverConfig): string | null {
  if (!config.customRegistryPath) return null;
  return path.resolve(path.dirname(config.configPath), config.customRegistryPath);
}

/**
 * Merge the bundled registry with an optional project-local registry.
 *
 * Custom registries use the same JSON shape as `src/registry/patterns.json`.
 * This keeps company-specific policy outside the package while preserving the
 * exact circuit-facing pattern schema and validation rules.
 */
export function loadEffectiveRegistry(config: EffectiveGhostProverConfig): PatternRegistry {
  const registry = JSON.parse(JSON.stringify(loadRegistry())) as PatternRegistry;
  const customPath = resolveCustomRegistryPath(config);

  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new Error(`customRegistryPath does not exist: ${customPath}`);
    }
    const custom = JSON.parse(fs.readFileSync(customPath, "utf-8")) as Partial<PatternRegistry>;
    registry.patterns = {
      ...registry.patterns,
      ...(custom.patterns ?? {}),
    };
    registry.presets = {
      ...registry.presets,
      ...(custom.presets ?? {}),
    };
    registry.version = custom.version ?? registry.version;
    registry.description = custom.description ?? registry.description;
  }

  const validation = validateRegistry(registry);
  const failures = Object.entries(validation);
  if (failures.length > 0) {
    const details = failures
      .map(([id, errors]) => `${id}: ${errors.join("; ")}`)
      .join("\n");
    throw new Error(`Invalid pattern registry:\n${details}`);
  }

  return registry;
}

/**
 * Resolve the effective policy pattern set. Explicit `patterns` wins over the
 * selected preset so companies can start from a preset and narrow the policy.
 */
export function resolvePolicyPatternIds(
  config: EffectiveGhostProverConfig,
  registry: PatternRegistry
): string[] {
  if (config.patterns.length > 0) {
    return config.patterns;
  }
  const preset = registry.presets[config.preset];
  if (!preset) {
    const available = Object.keys(registry.presets).join(", ");
    throw new Error(`Unknown preset "${config.preset}". Available: ${available}`);
  }
  return preset.patterns;
}

export function publicConfig(config: EffectiveGhostProverConfig, registry: PatternRegistry) {
  return {
    preset: config.preset,
    patterns: config.patterns,
    customRegistryPath: config.customRegistryPath,
    blockOnDetection: config.blockOnDetection,
    proofMode: config.proofMode,
    concurrency: config.concurrency,
    daemon: config.daemon,
    storage: {
      dir: config.storage.dir,
    },
    onChainSubmit: config.onChainSubmit,
    registryAddress: config.registryAddress,
    rpcUrl: config.rpcUrl,
    policyPatternIds: resolvePolicyPatternIds(config, registry),
  };
}
