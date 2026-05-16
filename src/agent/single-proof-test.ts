import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Server } from "http";
import { startDaemon } from "./daemon.js";

const port = 19080 + Math.floor(Math.random() * 1000);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ghostprover-proof-test-"));

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

async function requestJsonWithRetry<T>(url: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await requestJson<T>(url, init);
    } catch (err) {
      lastError = err;
      await sleep(500);
    }
  }
  throw lastError;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  fs.writeFileSync(
    path.join(cwd, ".ghostprover.json"),
    JSON.stringify(
      {
        preset: "saas",
        patterns: ["tech.aws_key"],
        blockOnDetection: true,
        proofMode: "background",
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
    const attest = await requestJson<{
      blocked: boolean;
      job: { id: string; status: string; patternIds: string[] };
    }>(`${base}/v1/attest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Summarize the clean SaaS access review notes for the audit packet.",
        preset: "saas",
      }),
    });

    assert(!attest.blocked, "clean one-pattern prompt was blocked");
    assert(attest.job.patternIds.length === 1, "proof acceptance test must stay one-pattern");

    let finalStatus = attest.job.status;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const lookup = await requestJsonWithRetry<{ job: { status: string; error?: string } }>(
        `${base}/v1/jobs/${attest.job.id}`
      );
      finalStatus = lookup.job.status;
      if (finalStatus === "done") break;
      if (finalStatus === "failed") {
        throw new Error(`proof job failed: ${lookup.job.error ?? "unknown error"}`);
      }
      await sleep(2000);
    }

    assert(finalStatus === "done", `proof job timed out with status=${finalStatus}`);

    const receipts = await requestJsonWithRetry<{
      receipts: {
        jobId: string;
        status: string;
        proofStatuses: { status: string; proofSize: number }[];
        storageRoot: string;
      }[];
    }>(`${base}/v1/receipts`);
    const receipt = receipts.receipts.find((item) => item.jobId === attest.job.id);
    assert(receipt, "completed proof job did not write a receipt");
    assert(receipt.status === "draft", "receipt status should be draft when onChainSubmit is disabled");
    assert(receipt.proofStatuses[0]?.status === "done", "receipt does not include done proof");
    assert(receipt.proofStatuses[0].proofSize > 0, "receipt proof size was empty");
    assert(receipt.storageRoot.startsWith("0x"), "receipt storage root was not computed");

    console.log("single proof acceptance test passed");
  } finally {
    await closeServer(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
