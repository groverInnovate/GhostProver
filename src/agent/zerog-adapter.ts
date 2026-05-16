import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { EffectiveGhostProverConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface ZerogReceiptResult {
  txHash: string | null;
  storageRoot: string | null;
  provider: string;
  model: string;
  attestationValid: boolean | null;
  targetHashes?: string[];
}

/**
 * Bridge the local daemon into the Compute workspace's live 0G pipeline.
 *
 * The daemon remains the product API (`/v1/attest` for frontend/MCP), while
 * Compute owns 0G-specific concerns: live storage upload, receipt submission,
 * provider metadata, and SDK compatibility. This intentionally shells out
 * through the Compute package so the root SDK does not need to depend on the
 * heavier 0G Compute/Storage SDKs.
 */
export async function submitReceiptTo0G(input: {
  cwd: string;
  prompt: string;
  patternIds: string[];
  config: EffectiveGhostProverConfig;
}): Promise<ZerogReceiptResult> {
  if (!input.config.registryAddress) {
    throw new Error("onChainSubmit is true but registryAddress is not configured");
  }

  const computeDir = path.resolve(input.cwd, "Compute");
  const args = [
    "run",
    "orchestrate",
    "--",
    "--prompt",
    input.prompt,
    "--patterns",
    input.patternIds.join(","),
  ];

  const env = {
    ...process.env,
    REGISTRY_ADDRESS: process.env.REGISTRY_ADDRESS || input.config.registryAddress,
    ZG_RPC_URL: process.env.ZG_RPC_URL || input.config.rpcUrl,
    ZG_NETWORK:
      process.env.ZG_NETWORK ||
      (input.config.rpcUrl.includes("evmrpc.0g.ai") && !input.config.rpcUrl.includes("testnet")
        ? "mainnet"
        : "custom"),
    GHOSTPROVER_PROOF_CONCURRENCY: String(input.config.concurrency),
  };

  const { stdout, stderr } = await execFileAsync("npm", args, {
    cwd: computeDir,
    env,
    maxBuffer: 1024 * 1024 * 20,
  });

  const parsed = parseOrchestratorResult(stdout);
  if (!parsed) {
    throw new Error(
      `0G orchestrator completed but did not print a parseable result.\n${stderr || stdout}`
    );
  }
  return parsed;
}

function parseOrchestratorResult(stdout: string): ZerogReceiptResult | null {
  const marker = "=== Orchestration Complete ===";
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex === -1) return null;

  const afterMarker = stdout.slice(markerIndex + marker.length);
  const jsonStart = afterMarker.indexOf("{");
  if (jsonStart === -1) return null;

  const jsonText = afterMarker.slice(jsonStart).trim();
  const payload = JSON.parse(jsonText) as {
    txHash: string | null;
    storageRoot: string | null;
    provider: string;
    model: string;
    attestationValid: boolean | null;
    targetHashes?: string[];
  };

  return {
    txHash: payload.txHash,
    storageRoot: payload.storageRoot,
    provider: payload.provider,
    model: payload.model,
    attestationValid: payload.attestationValid,
    targetHashes: payload.targetHashes,
  };
}
