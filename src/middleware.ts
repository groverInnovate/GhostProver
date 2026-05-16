// ---------------------------------------------------------------------------
// middleware.ts — Express middleware for automatic GhostProver attestation
//
// Intercepts outgoing AI API calls, scans prompts for sensitive data,
// and generates ZK proofs in the background. Non-blocking — the AI
// request proceeds immediately while proofs are generated async.
//
// Usage:
//   import express from 'express';
//   import { ghostProverMiddleware } from './middleware.js';
//
//   const app = express();
//   app.use(ghostProverMiddleware({
//     preset: 'banking',
//     onProofComplete: (result) => console.log('Proof done:', result),
//   }));
// ---------------------------------------------------------------------------

import { scanPrompt, generateBatchProofs, type BatchProofOutput } from "./batch-prover.js";
import { computeCommitment } from "./ghostprover.js";
import { loadRegistry, type PatternRegistry } from "./registry/index.js";
import type { IncomingMessage, ServerResponse } from "http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhostProverMiddlewareConfig {
  /** Industry preset to use for scanning/proving */
  preset: string;

  /**
   * URL patterns to intercept. Requests whose URL matches any of these
   * will have their prompt extracted and scanned.
   * Default: ['/api/', '/v1/', '/chat/', '/completions']
   */
  interceptPaths?: string[];

  /**
   * JSON field path to extract the prompt from request body.
   * Default: 'prompt' (also checks 'messages[last].content')
   */
  promptField?: string;

  /** Callback when proofs are generated (async, non-blocking) */
  onProofComplete?: (result: BatchProofOutput) => void;

  /** Callback when a scan detects sensitive data */
  onSensitiveDataDetected?: (
    patternId: string,
    patternName: string,
    offset: number
  ) => void;

  /** If true, block requests that contain sensitive data (default: false — warn only) */
  blockOnDetection?: boolean;

  /** Max concurrent proofs (default: 2) */
  concurrency?: number;

  /** If true, skip proof generation and only scan (default: false) */
  scanOnly?: boolean;
}

export interface GhostProverRequestContext {
  /** Poseidon2 commitment of the prompt */
  commitment: string;
  /** Pattern scan results */
  scanResults: {
    id: string;
    name: string;
    matched: boolean;
    matchOffset?: number;
  }[];
  /** Whether proofs are being generated (async) */
  provingInProgress: boolean;
  /** Promise that resolves when proofs are complete (if generating) */
  proofPromise?: Promise<BatchProofOutput>;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express-compatible middleware that automatically scans and
 * attests AI prompts using GhostProver.
 */
export function ghostProverMiddleware(config: GhostProverMiddlewareConfig) {
  const {
    preset,
    interceptPaths = ["/api/", "/v1/", "/chat/", "/completions"],
    promptField = "prompt",
    onProofComplete,
    onSensitiveDataDetected,
    blockOnDetection = false,
    concurrency = 2,
    scanOnly = false,
  } = config;

  // Pre-load registry on startup
  const registry = loadRegistry();
  console.log(
    `[GhostProver Middleware] Loaded preset "${preset}" with ${registry.presets[preset]?.patterns.length ?? 0} patterns`
  );

  return function middleware(
    req: IncomingMessage & { body?: any; ghostProver?: GhostProverRequestContext },
    res: ServerResponse,
    next: () => void
  ) {
    // Only intercept matching paths
    const url = req.url ?? "";
    const shouldIntercept = interceptPaths.some((p) => url.includes(p));
    if (!shouldIntercept || req.method !== "POST") {
      return next();
    }

    // Extract prompt from request body
    const body = req.body;
    if (!body) {
      return next();
    }

    let promptText: string | undefined;

    // Try direct field
    if (body[promptField]) {
      promptText = String(body[promptField]);
    }
    // Try OpenAI-style messages array
    else if (Array.isArray(body.messages) && body.messages.length > 0) {
      const lastMsg = body.messages[body.messages.length - 1];
      promptText = lastMsg?.content ? String(lastMsg.content) : undefined;
    }
    // Try Anthropic-style prompt
    else if (body.prompt) {
      promptText = String(body.prompt);
    }

    if (!promptText) {
      return next();
    }

    const encoder = new TextEncoder();
    const promptBytes = encoder.encode(promptText);
    if (promptBytes.length > 512) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Prompt exceeds GhostProver's 512-byte circuit limit",
          byteLength: promptBytes.length,
          maxBytes: 512,
        })
      );
      return;
    }

    // Scan
    const commitment = computeCommitment(promptBytes);
    const scanResults = scanPrompt(promptBytes, preset);
    const matches = scanResults.filter((r) => r.matched);

    // Attach context to request
    const context: GhostProverRequestContext = {
      commitment,
      scanResults,
      provingInProgress: false,
    };

    // Handle matches
    if (matches.length > 0) {
      for (const m of matches) {
        console.warn(
          `[GhostProver] ⚠️ Sensitive data detected: ${m.name} (${m.id}) at offset ${m.matchOffset}`
        );
        onSensitiveDataDetected?.(m.id, m.name, m.matchOffset!);
      }

      if (blockOnDetection) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "GhostProver: Sensitive data detected in prompt",
            patterns: matches.map((m) => ({
              id: m.id,
              name: m.name,
              offset: m.matchOffset,
            })),
          })
        );
        return;
      }
    }

    // Add commitment header
    if (typeof (res as any).setHeader === "function") {
      (res as any).setHeader("X-GhostProver-Commitment", commitment);
      (res as any).setHeader(
        "X-GhostProver-Patterns",
        scanResults
          .filter((r) => !r.matched)
          .map((r) => r.id)
          .join(",")
      );
    }

    // Generate proofs in background (non-blocking)
    if (!scanOnly && matches.length === 0) {
      context.provingInProgress = true;
      context.proofPromise = generateBatchProofs({
        promptBytes,
        preset,
        concurrency,
        onProgress: (id, status, detail) => {
          console.log(`[GhostProver:bg] ${id}: ${status}${detail ? ` (${detail})` : ""}`);
        },
      }).then((result) => {
        context.provingInProgress = false;
        onProofComplete?.(result);
        return result;
      }).catch((err) => {
        context.provingInProgress = false;
        console.error("[GhostProver] Proof generation failed:", err);
        throw err;
      });
    }

    // Attach context and proceed
    (req as any).ghostProver = context;
    next();
  };
}

/**
 * Load config from .ghostprover.json if it exists.
 * Returns a partial config that can be spread into ghostProverMiddleware().
 */
export function loadConfig(
  configPath?: string
): Partial<GhostProverMiddlewareConfig> {
  // Dynamic import to avoid requiring fs at module load for browser compat
  let fs: typeof import("fs");
  let path: typeof import("path");
  try {
    fs = require("fs");
    path = require("path");
  } catch {
    return {};
  }

  const resolved = configPath ?? path.resolve(".ghostprover.json");

  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      preset: parsed.preset,
      blockOnDetection: parsed.blockOnDetection,
      concurrency: parsed.concurrency,
      scanOnly: parsed.scanOnly ?? parsed.proofMode === "scan_only",
    };
  } catch {
    return {};
  }
}
