// ---------------------------------------------------------------------------
// cli.ts — GhostProver CLI Tool
//
// Commands:
//   ghostprover scan   --preset banking --prompt "..."
//   ghostprover prove  --preset banking --prompt "..."
//   ghostprover init
//   ghostprover list-presets
//   ghostprover list-patterns [--preset banking]
//
// Run directly:
//   node --import tsx src/cli.ts scan --preset banking --prompt "hello world"
//
// Or via npm script:
//   npm run cli -- scan --preset banking --prompt "hello world"
// ---------------------------------------------------------------------------

import { scanPrompt, generateBatchProofs } from "./batch-prover.js";
import {
  loadRegistry,
  listPresets,
  listPatterns,
  getPatternsByPreset,
} from "./registry/index.js";
import { computeCommitment, verifyProof } from "./ghostprover.js";
import { computePatternHash } from "./poseidon2.js";
import { startDaemon } from "./agent/daemon.js";
import { createDefaultConfig, resolveConfigPath } from "./agent/config.js";
import { startMcpServer } from "./agent/mcp-server.js";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// ANSI colors for terminal output
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

function banner() {
  console.log(`
${C.cyan}${C.bold}  ╔══════════════════════════════════════╗
  ║         🔐 GhostProver v2.0         ║
  ║   ZK Compliance Attestation Engine   ║
  ╚══════════════════════════════════════╝${C.reset}
`);
}

// ---------------------------------------------------------------------------
// Argument parser (simple, no dependencies)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  preset?: string;
  prompt?: string;
  file?: string;
  patternIds?: string[];
  concurrency?: number;
  output?: string;
  port?: number;
  proof?: string;
  commitment?: string;
  targetHash?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node + script
  const command = args[0] || "help";

  const result: ParsedArgs = { command };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--preset":
      case "-p":
        result.preset = args[++i];
        break;
      case "--prompt":
        result.prompt = args[++i];
        break;
      case "--file":
      case "-f":
        result.file = args[++i];
        break;
      case "--patterns":
        result.patternIds = args[++i]?.split(",");
        break;
      case "--concurrency":
      case "-c":
        result.concurrency = parseInt(args[++i], 10);
        break;
      case "--output":
      case "-o":
        result.output = args[++i];
        break;
      case "--port":
        result.port = parseInt(args[++i], 10);
        break;
      case "--proof":
        result.proof = args[++i];
        break;
      case "--commitment":
        result.commitment = args[++i];
        break;
      case "--target-hash":
        result.targetHash = args[++i];
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

function getPromptBytes(args: ParsedArgs): Uint8Array {
  if (args.prompt) {
    return new TextEncoder().encode(args.prompt);
  }
  if (args.file) {
    const content = fs.readFileSync(args.file, "utf-8");
    return new TextEncoder().encode(content);
  }
  throw new Error(
    "No prompt provided. Use --prompt \"...\" or --file path/to/file.txt"
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdScan(args: ParsedArgs) {
  const preset = args.preset ?? "saas";
  const promptBytes = getPromptBytes(args);
  const promptStr =
    args.prompt?.slice(0, 60) ?? args.file ?? "(stdin)";

  console.log(`${C.bold}Scanning prompt against preset: ${C.cyan}${preset}${C.reset}`);
  console.log(`${C.dim}Prompt: "${promptStr}${promptStr.length > 60 ? "..." : ""}"${C.reset}`);
  console.log(`${C.dim}Length: ${promptBytes.length} bytes${C.reset}\n`);

  const commitment = computeCommitment(promptBytes);
  console.log(`${C.dim}Commitment: ${commitment}${C.reset}\n`);

  const results = scanPrompt(promptBytes, preset);

  let hasMatch = false;
  for (const r of results) {
    if (r.matched) {
      hasMatch = true;
      console.log(
        `  ${C.bgRed}${C.white} ❌ FOUND ${C.reset} ${C.bold}${r.name}${C.reset} ${C.dim}(${r.id})${C.reset}`
      );
      console.log(
        `           ${C.red}Matched at byte offset ${r.matchOffset}${C.reset}\n`
      );
    } else {
      console.log(
        `  ${C.bgGreen}${C.white} ✅ CLEAN ${C.reset} ${C.bold}${r.name}${C.reset} ${C.dim}(${r.id})${C.reset}`
      );
    }
  }

  console.log();
  if (hasMatch) {
    console.log(
      `${C.red}${C.bold}⚠️  SENSITIVE DATA DETECTED — proof generation would FAIL for matched patterns${C.reset}`
    );
    console.log(
      `${C.dim}Remove the sensitive data from your prompt before proceeding.${C.reset}`
    );
    process.exit(1);
  } else {
    console.log(
      `${C.green}${C.bold}✅ All clear — no sensitive data patterns detected${C.reset}`
    );
    console.log(
      `${C.dim}Safe to generate compliance proofs with: ghostprover prove --preset ${preset}${C.reset}`
    );
  }
}

async function cmdProve(args: ParsedArgs) {
  const preset = args.preset;
  const patternIds = args.patternIds;
  const concurrency = args.concurrency ?? 3;
  const promptBytes = getPromptBytes(args);

  if (!preset && !patternIds) {
    console.error(
      `${C.red}Error: --preset or --patterns required for prove command${C.reset}`
    );
    process.exit(1);
  }

  const label = preset ?? patternIds!.join(",");
  console.log(`${C.bold}Generating proofs for: ${C.cyan}${label}${C.reset}`);
  console.log(`${C.dim}Prompt length: ${promptBytes.length} bytes${C.reset}`);
  console.log(`${C.dim}Concurrency: ${concurrency}${C.reset}\n`);

  // Pre-flight scan
  if (preset) {
    console.log(`${C.dim}Running pre-flight scan...${C.reset}`);
    const scanResults = scanPrompt(promptBytes, preset);
    const matches = scanResults.filter((r) => r.matched);
    if (matches.length > 0) {
      console.log(`\n${C.red}${C.bold}Pre-flight scan FAILED:${C.reset}`);
      for (const m of matches) {
        console.log(`  ${C.red}❌ ${m.name} found at offset ${m.matchOffset}${C.reset}`);
      }
      console.log(
        `\n${C.yellow}Proof generation would fail. Clean the prompt first.${C.reset}`
      );
      process.exit(1);
    }
    console.log(`${C.green}Pre-flight scan passed ✅${C.reset}\n`);
  }

  // Generate proofs
  const startTime = Date.now();
  console.log(`${C.bold}Generating proofs...${C.reset}\n`);

  const result = await generateBatchProofs({
    promptBytes,
    preset,
    patternIds,
    concurrency,
    onProgress: (id, status, detail) => {
      const icon =
        status === "proving" ? "⏳" :
        status === "done" ? "✅" :
        status === "failed" ? "❌" : "⬜";
      const extra = detail ? ` (${detail})` : "";
      console.log(`  ${icon} ${id}${extra}`);
    },
  });

  console.log(`\n${"─".repeat(50)}`);
  console.log(`${C.bold}Results:${C.reset}`);
  console.log(`  Commitment: ${C.cyan}${result.commitment}${C.reset}`);
  console.log(`  Total time: ${C.yellow}${result.totalTimeMs}ms${C.reset}`);
  console.log(
    `  Success: ${C.green}${result.successCount}${C.reset} / ${result.results.length}`
  );

  if (result.failCount > 0) {
    console.log(`  Failed: ${C.red}${result.failCount}${C.reset}`);
  }

  for (const r of result.results) {
    const icon = r.status === "done" ? C.green + "✅" : C.red + "❌";
    console.log(
      `\n  ${icon} ${r.patternName}${C.reset} ${C.dim}(${r.patternId})${C.reset}`
    );
    if (r.proof) {
      console.log(`     Hash:  ${C.dim}${r.proof.targetHash}${C.reset}`);
      console.log(`     Proof: ${C.dim}${r.proof.proof.length} bytes${C.reset}`);
      console.log(`     Time:  ${C.dim}${r.proofTimeMs}ms${C.reset}`);
    }
    if (r.error) {
      console.log(`     Error: ${C.red}${r.error}${C.reset}`);
    }
  }

  // Write output file if requested
  if (args.output) {
    const outputData = {
      commitment: result.commitment,
      preset: result.preset,
      totalTimeMs: result.totalTimeMs,
      results: result.results.map((r) => ({
        patternId: r.patternId,
        patternName: r.patternName,
        status: r.status,
        targetHash: r.proof?.targetHash,
        proofHex: r.proof
          ? Buffer.from(r.proof.proof).toString("hex")
          : undefined,
        proofTimeMs: r.proofTimeMs,
        error: r.error,
      })),
    };
    fs.writeFileSync(args.output, JSON.stringify(outputData, null, 2));
    console.log(`\n${C.dim}Output written to: ${args.output}${C.reset}`);
  }
}

async function cmdVerify(args: ParsedArgs) {
  if (!args.proof || !args.commitment || !args.targetHash) {
    console.error(
      `${C.red}Error: --proof, --commitment, and --target-hash are required for verify command${C.reset}`
    );
    process.exit(1);
  }

  let proofBytes: Uint8Array;
  try {
    if (args.proof.endsWith('.hex')) {
      const hexStr = fs.readFileSync(args.proof, "utf-8").trim();
      proofBytes = Buffer.from(hexStr, "hex");
    } else {
      proofBytes = fs.readFileSync(args.proof);
    }
  } catch (err) {
    console.error(`${C.red}Error reading proof file: ${(err as Error).message}${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.bold}Verifying proof...${C.reset}`);
  console.log(`  Commitment:  ${C.dim}${args.commitment}${C.reset}`);
  console.log(`  Target hash: ${C.dim}${args.targetHash}${C.reset}`);
  console.log(`  Proof size:  ${C.dim}${proofBytes.length} bytes${C.reset}\n`);

  const startTime = Date.now();
  const isValid = await verifyProof(proofBytes, [args.commitment, args.targetHash]);
  const timeMs = Date.now() - startTime;

  if (isValid) {
    console.log(`${C.bgGreen}${C.white} ✅ VERIFIED ${C.reset} ${C.green}Proof is cryptographically sound${C.reset} ${C.dim}(${timeMs}ms)${C.reset}`);
  } else {
    console.log(`${C.bgRed}${C.white} ❌ REJECTED ${C.reset} ${C.red}Proof is invalid or inputs do not match${C.reset} ${C.dim}(${timeMs}ms)${C.reset}`);
    process.exit(1);
  }
}

async function cmdInit() {
  const configPath = resolveConfigPath();

  if (fs.existsSync(configPath)) {
    console.log(
      `${C.yellow}Config already exists: ${configPath}${C.reset}`
    );
    console.log(`${C.dim}Delete it first to reinitialize.${C.reset}`);
    return;
  }

  const registry = loadRegistry();
  const presets = listPresets(registry);

  console.log(`${C.bold}Available presets:${C.reset}\n`);
  presets.forEach((p, i) => {
    console.log(
      `  ${C.cyan}${i + 1}.${C.reset} ${C.bold}${p.name}${C.reset} ${C.dim}(${p.id})${C.reset}`
    );
    console.log(`     ${C.dim}${p.description} — ${p.patternCount} patterns${C.reset}`);
  });

  // Default to saas
  const config = createDefaultConfig();

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`\n${C.green}Created: ${configPath}${C.reset}`);
  console.log(
    `${C.dim}Edit the "preset" field to match your industry, then run:${C.reset}`
  );
  console.log(`  ${C.cyan}ghostprover scan --prompt "your test prompt"${C.reset}`);
  console.log(`  ${C.cyan}ghostprover daemon${C.reset}`);
}

async function cmdDaemon(args: ParsedArgs) {
  await startDaemon({ port: args.port });
  await new Promise(() => {});
}

async function cmdMcp() {
  await startMcpServer();
}

function cmdListPresets() {
  const registry = loadRegistry();
  const presets = listPresets(registry);

  console.log(`${C.bold}Available Presets${C.reset}\n`);

  for (const p of presets) {
    console.log(
      `  ${C.cyan}${p.id.padEnd(15)}${C.reset} ${C.bold}${p.name}${C.reset}`
    );
    console.log(`  ${"".padEnd(15)} ${C.dim}${p.description}${C.reset}`);
    const patterns = getPatternsByPreset(registry, p.id);
    console.log(
      `  ${"".padEnd(15)} ${C.dim}Patterns: ${patterns.map((pp) => pp.id).join(", ")}${C.reset}\n`
    );
  }
}

function cmdListPatterns(args: ParsedArgs) {
  const registry = loadRegistry();

  if (args.preset) {
    const patterns = getPatternsByPreset(registry, args.preset);
    console.log(
      `${C.bold}Patterns in preset "${C.cyan}${args.preset}${C.reset}${C.bold}"${C.reset}\n`
    );
    for (const { id, pattern } of patterns) {
      const hash = computePatternHash(
        pattern.pattern_types,
        pattern.pattern_values
      );
      console.log(
        `  ${C.cyan}${id.padEnd(18)}${C.reset} ${C.bold}${pattern.name}${C.reset}`
      );
      console.log(
        `  ${"".padEnd(18)} ${C.dim}Length: ${pattern.target_len} | Example: ${pattern.example}${C.reset}`
      );
      console.log(
        `  ${"".padEnd(18)} ${C.dim}Hash: ${hash.slice(0, 22)}...${C.reset}`
      );
      if (pattern.regulation) {
        console.log(
          `  ${"".padEnd(18)} ${C.dim}Regulation: ${pattern.regulation}${C.reset}`
        );
      }
      console.log();
    }
  } else {
    const all = listPatterns(registry);
    console.log(`${C.bold}All Patterns (${all.length})${C.reset}\n`);
    for (const p of all) {
      const industries = p.industry.join(", ");
      console.log(
        `  ${C.cyan}${p.id.padEnd(18)}${C.reset} len=${String(p.targetLen).padStart(2)} ${C.dim}[${industries}]${C.reset}`
      );
    }
    console.log(
      `\n${C.dim}Use --preset <name> to see full details for a specific preset.${C.reset}`
    );
  }
}

function cmdHelp() {
  console.log(`${C.bold}Usage:${C.reset} ghostprover <command> [options]

${C.bold}Commands:${C.reset}
  ${C.cyan}scan${C.reset}            Scan a prompt for sensitive data patterns (no proof)
  ${C.cyan}prove${C.reset}           Generate ZK proofs for all patterns in a preset
  ${C.cyan}verify${C.reset}          Verify a raw proof against a commitment and target hash
  ${C.cyan}init${C.reset}            Create a .ghostprover.json config in current directory
  ${C.cyan}daemon${C.reset}          Start the local background compliance daemon
  ${C.cyan}mcp${C.reset}             Start the MCP server for Claude/Codex-style tools
  ${C.cyan}list-presets${C.reset}    Show available industry presets
  ${C.cyan}list-patterns${C.reset}   Show available patterns

${C.bold}Options:${C.reset}
  ${C.yellow}--preset, -p${C.reset}    Industry preset (banking, india_kyc, healthcare, fintech, saas)
  ${C.yellow}--prompt${C.reset}        Prompt text to scan/prove
  ${C.yellow}--file, -f${C.reset}      Read prompt from file instead
  ${C.yellow}--patterns${C.reset}      Comma-separated pattern IDs (alternative to preset)
  ${C.yellow}--concurrency${C.reset}   Max parallel proofs (default: 3)
  ${C.yellow}--output, -o${C.reset}    Write proof results to JSON file
  ${C.yellow}--port${C.reset}          Daemon port override
  ${C.yellow}--proof${C.reset}         Path to proof file (e.g. proof.bin)
  ${C.yellow}--commitment${C.reset}    Hex string of the Poseidon2 prompt commitment
  ${C.yellow}--target-hash${C.reset}   Hex string of the target or pattern hash
  ${C.yellow}--help, -h${C.reset}      Show this help

${C.bold}Examples:${C.reset}
  ${C.dim}# Scan a prompt for banking compliance${C.reset}
  ghostprover scan --preset banking --prompt "Transfer \\$500 to account"

  ${C.dim}# Generate proofs for all SaaS patterns${C.reset}
  ghostprover prove --preset saas --prompt "Deploy to staging server"

  ${C.dim}# Scan from a file${C.reset}
  ghostprover scan --preset india_kyc --file prompt.txt

  ${C.dim}# Generate proofs and save output${C.reset}
  ghostprover prove --preset banking --prompt "..." --output proofs.json

  ${C.dim}# Start the local daemon and MCP server${C.reset}
  ghostprover daemon
  ghostprover mcp
`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // Show banner for interactive commands
  if (!["help", "--help", "-h", "mcp"].includes(args.command)) {
    banner();
  }

  try {
    switch (args.command) {
      case "scan":
        if (args.help) { cmdHelp(); break; }
        await cmdScan(args);
        break;
      case "prove":
        if (args.help) { cmdHelp(); break; }
        await cmdProve(args);
        break;
      case "verify":
        if (args.help) { cmdHelp(); break; }
        await cmdVerify(args);
        break;
      case "init":
        await cmdInit();
        break;
      case "daemon":
        await cmdDaemon(args);
        break;
      case "mcp":
        await cmdMcp();
        break;
      case "list-presets":
        cmdListPresets();
        break;
      case "list-patterns":
        cmdListPatterns(args);
        break;
      case "help":
      case "--help":
      case "-h":
        banner();
        cmdHelp();
        break;
      default:
        console.error(`${C.red}Unknown command: ${args.command}${C.reset}\n`);
        cmdHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n${C.red}${C.bold}Error:${C.reset} ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
