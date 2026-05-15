import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Server } from "http";
import { startDaemon } from "./daemon.js";

const projectRoot = process.cwd();
const port = 18080 + Math.floor(Math.random() * 1000);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ghostprover-daemon-test-"));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as T;
  assert(response.ok, `Request failed: ${url} ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const customRegistryPath = path.join(projectRoot, "examples", "custom-registry.json");
  fs.writeFileSync(
    path.join(cwd, ".ghostprover.json"),
    JSON.stringify(
      {
        preset: "saas",
        customRegistryPath,
        blockOnDetection: true,
        proofMode: "scan_only",
        concurrency: 1,
        daemon: { host: "127.0.0.1", port },
        storage: { dir: ".ghostprover-test" },
      },
      null,
      2
    )
  );

  const server = await startDaemon({ cwd, port });
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await requestJson<{ ok: boolean }>(`${base}/health`);
    assert(health.ok, "health endpoint did not return ok");

    const config = await requestJson<{ blockOnDetection: boolean; policyPatternIds: string[] }>(
      `${base}/v1/config`
    );
    assert(config.blockOnDetection === true, "config did not preserve blockOnDetection");
    assert(config.policyPatternIds.length > 0, "config did not resolve policy patterns");

    const presets = await requestJson<{ presets: Record<string, unknown> }>(`${base}/v1/presets`);
    assert(Boolean(presets.presets.acme_internal), "custom registry preset was not merged");

    const cleanScan = await requestJson<{ clean: boolean }>(`${base}/v1/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello clean world", preset: "saas" }),
    });
    assert(cleanScan.clean, "clean prompt was unexpectedly blocked");

    const blockedScan = await requestJson<{ blocked: boolean; matches: { id: string }[] }>(
      `${base}/v1/scan`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "customer id CUST-12345678 is not allowed",
          preset: "acme_internal",
        }),
      }
    );
    assert(blockedScan.blocked, "custom registry prompt was not blocked");
    assert(blockedScan.matches[0]?.id === "acme.customer_id", "wrong custom pattern matched");

    const blockedAttest = await requestJson<{
      blocked: boolean;
      job: { id: string; status: string; scan: { matches: { id: string }[] } };
    }>(`${base}/v1/attest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "deployment token gp_live_ABCDEFGHIJKLMNOPQRSTUVWX leaked",
        preset: "acme_internal",
      }),
    });
    assert(blockedAttest.blocked, "blocked attest did not return blocked=true");
    assert(blockedAttest.job.status === "blocked", "blocked attest did not persist blocked job");

    const jobLookup = await requestJson<{ job: { id: string; status: string } }>(
      `${base}/v1/jobs/${blockedAttest.job.id}`
    );
    assert(jobLookup.job.status === "blocked", "job lookup did not return persisted blocked job");

    const receipts = await requestJson<{ receipts: unknown[] }>(`${base}/v1/receipts`);
    assert(Array.isArray(receipts.receipts), "receipts endpoint did not return an array");

    console.log("daemon API tests passed");
  } finally {
    await closeServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
