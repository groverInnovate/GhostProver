import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadGhostProverConfig } from "./config.js";

const config = loadGhostProverConfig();
const DAEMON_URL = process.env.GHOSTPROVER_DAEMON_URL ??
  `http://${config.daemon.host}:${config.daemon.port}`;

/**
 * Stdio MCP bridge for coding-agent products.
 *
 * MCP stays thin on purpose: it does not own policy or persistence. It calls the
 * local daemon, which means Claude Code/Codex/Antigravity-style clients and the
 * dashboard all observe the same jobs, receipts, and blocking decisions.
 */
const server = new McpServer({
  name: "ghostprover",
  version: "0.2.0",
});

const promptInput = {
  prompt: z.string().min(1).describe("Prompt text to scan or attest"),
  preset: z.string().optional().describe("Optional preset override"),
  patterns: z.array(z.string()).optional().describe("Optional pattern IDs override"),
};

server.registerTool(
  "ghostprover_status",
  {
    description: "Return daemon health, effective policy, latest job, and latest receipt.",
    inputSchema: {},
  },
  async () => {
    const result: any = await daemonGet("/v1/status");
    const job = result.latestJob ? `latest job ${result.latestJob.status}` : "no jobs";
    const receipts = result.counts?.receipts ?? 0;
    return toolResult(result, `GhostProver daemon online: ${job}, ${receipts} receipt(s).`);
  }
);

server.registerTool(
  "ghostprover_scan_prompt",
  {
    description: "Scan a prompt for sensitive data using the local GhostProver daemon.",
    inputSchema: promptInput,
  },
  async (input) => {
    const result: any = await daemonPost("/v1/scan", input);
    return toolResult(
      result,
      result.blocked
        ? `Blocked: ${result.matches.length} sensitive pattern(s) detected.`
        : `Clean: ${result.patternIds.length} pattern(s) checked.`
    );
  }
);

server.registerTool(
  "ghostprover_attest_prompt",
  {
    description: "Scan a prompt and enqueue background ZK proof generation if clean.",
    inputSchema: promptInput,
  },
  async (input) => {
    const result: any = await daemonPost("/v1/attest", input);
    const summary = result.blocked
      ? `Blocked: ${result.scan.matches.length} sensitive pattern(s) detected.`
      : `Attestation job queued: ${result.job.id}`;
    return toolResult(result, summary);
  }
);

server.registerTool(
  "ghostprover_get_job",
  {
    description: "Get a GhostProver background proof job by ID.",
    inputSchema: {
      jobId: z.string().min(1),
    },
  },
  async ({ jobId }) => {
    const result: any = await daemonGet(`/v1/jobs/${encodeURIComponent(jobId)}`);
    return toolResult(result, `Job ${jobId}: ${result.job.status}`);
  }
);

server.registerTool(
  "ghostprover_list_jobs",
  {
    description: "List recent GhostProver background proof jobs.",
    inputSchema: {
      limit: z.number().int().positive().max(100).optional(),
      status: z.enum(["queued", "proving", "blocked", "done", "failed"]).optional(),
    },
  },
  async ({ limit, status }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (status) params.set("status", status);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const result: any = await daemonGet(`/v1/jobs${suffix}`);
    return toolResult(result, `${result.jobs.length} job(s).`);
  }
);

server.registerTool(
  "ghostprover_list_receipts",
  {
    description: "List locally stored GhostProver receipts.",
    inputSchema: {
      limit: z.number().int().positive().max(50).optional(),
    },
  },
  async ({ limit }) => {
    const result: any = await daemonGet("/v1/receipts");
    const receipts = result.receipts.slice(0, limit ?? 10);
    return toolResult({ receipts }, `${receipts.length} local receipt(s).`);
  }
);

server.registerTool(
  "ghostprover_list_presets",
  {
    description: "List configured GhostProver presets and patterns.",
    inputSchema: {},
  },
  async () => {
    const result: any = await daemonGet("/v1/presets");
    return toolResult(result, `${Object.keys(result.presets).length} preset(s) available.`);
  }
);

async function daemonGet(path: string): Promise<Record<string, unknown>> {
  return daemonFetch(path, { method: "GET" });
}

async function daemonPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  return daemonFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function daemonFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${DAEMON_URL}${path}`, init);
  } catch (err) {
    throw new Error(
      `GhostProver daemon is not reachable at ${DAEMON_URL}. Start it with: npm run cli -- daemon. ` +
        `Original error: ${(err as Error).message}`
    );
  }

  const text = await response.text();
  const parsed = text ? safeParseJson(text) : {};
  if (!response.ok) {
    const message =
      typeof parsed.error === "string" ? parsed.error : text || `HTTP ${response.status}`;
    throw new Error(`GhostProver daemon returned HTTP ${response.status}: ${message}`);
  }
  return parsed as Record<string, unknown>;
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function toolResult(structuredContent: Record<string, unknown>, summary: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${summary}\n\n${JSON.stringify(structuredContent, null, 2)}`,
      },
    ],
    structuredContent,
  };
}

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`GhostProver MCP server connected. Daemon: ${DAEMON_URL}`);
}
