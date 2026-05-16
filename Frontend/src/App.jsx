import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Blocks,
  Check,
  ChevronDown,
  ClipboardCheck,
  CloudCog,
  Database,
  FileSearch,
  Filter,
  Hash,
  History,
  KeyRound,
  Loader2,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import React from "react";
import { useEffect, useMemo, useState } from "react";
import { CLASS_LABELS, REGISTRY } from "./registry.js";
import { bytesOf } from "./scanner.js";

const API_BASE = import.meta.env.VITE_GHOSTPROVER_API ?? "http://127.0.0.1:8787";
const COMPUTE_API_BASE = import.meta.env.VITE_GHOSTPROVER_COMPUTE_API ?? "http://127.0.0.1:8790";

const SAMPLE_PROMPTS = {
  clean:
    "Summarize the security posture for our SaaS admin console and flag policy gaps in access review cadence.",
  risky:
    "Rotate the old deployment secret AKIAIOSFODNN7EXAMPLE before the next production release.",
};

const tabs = [
  { id: "console", label: "Console", icon: TerminalSquare },
  { id: "registry", label: "Registry", icon: Blocks },
  { id: "receipts", label: "Receipts", icon: ClipboardCheck },
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function shortHash(value) {
  if (!value) return "pending";
  if (value === "pending" || String(value).length <= 20) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function formatDate(value) {
  if (!value) return "pending";
  return new Date(value).toLocaleString();
}

function networkLabel(rpcUrl = "") {
  if (rpcUrl.includes("evmrpc.0g.ai")) return "0G Mainnet";
  if (rpcUrl.includes("galileo")) return "0G Galileo Testnet";
  return rpcUrl ? "Custom RPC" : "Local daemon";
}

async function apiErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem("ghostprover-history") || "[]");
  } catch {
    return [];
  }
}

function initialLiveRun() {
  return {
    running: false,
    progress: 0,
    stage: "idle",
    logs: [],
    result: null,
    sample: null,
    verification: null,
    error: "",
  };
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return { event, data: data.join("\n") };
  }
}

function presetView(id, preset) {
  const fallback = {
    india_kyc: ["KYC", "#276ef1"],
    banking: ["Bank", "#00875a"],
    healthcare: ["Health", "#c2410c"],
    fintech: ["Fin", "#7c3aed"],
    saas: ["SaaS", "#0f766e"],
  }[id] ?? [preset.name.slice(0, 5), "#276ef1"];
  return {
    ...preset,
    short: preset.short ?? fallback[0],
    accent: preset.accent ?? fallback[1],
  };
}

function patternView(pattern) {
  return {
    ...pattern,
    desc: pattern.desc ?? pattern.description,
    len: pattern.len ?? pattern.target_len,
    types: pattern.types ?? pattern.pattern_types ?? [],
  };
}

function adaptScan(response, registry) {
  return {
    presetId: response.preset,
    presetName: registry.presets[response.preset]?.name ?? response.preset,
    byteLength: response.byteLength,
    clean: response.clean,
    results: response.results.map((result) => ({
      ...result,
      offset: result.matchOffset,
      desc: registry.patterns[result.id]?.description,
      len: registry.patterns[result.id]?.target_len,
    })),
  };
}

function App() {
  const [activeTab, setActiveTab] = useState("console");
  const [selectedPreset, setSelectedPreset] = useState("saas");
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS.clean);
  const [registry, setRegistry] = useState(REGISTRY);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [scan, setScan] = useState(null);
  const [commitment, setCommitment] = useState("");
  const [proofRun, setProofRun] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [latestJob, setLatestJob] = useState(null);
  const [apiError, setApiError] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const [registryFilter, setRegistryFilter] = useState("all");
  const [registrySearch, setRegistrySearch] = useState("");
  const [liveRun, setLiveRun] = useState(initialLiveRun);

  const preset = presetView(selectedPreset, registry.presets[selectedPreset] ?? REGISTRY.presets.saas);
  const promptBytes = bytesOf(prompt).length;
  const maxPromptBytes = config?.maxPromptBytes ?? status?.maxPromptBytes ?? 512;
  const promptTooLarge = promptBytes > maxPromptBytes;
  const blockedCount = scan?.results.filter((item) => item.matched).length ?? 0;
  const cleanCount = scan?.results.filter((item) => !item.matched).length ?? 0;

  useEffect(() => {
    localStorage.setItem("ghostprover-history", JSON.stringify(history.slice(0, 12)));
  }, [history]);

  useEffect(() => {
    let eventSource;

    async function loadDaemonState() {
      try {
        const [statusResponse, presetsResponse, receiptsResponse, jobsResponse] = await Promise.all([
          fetch(`${API_BASE}/v1/status`),
          fetch(`${API_BASE}/v1/presets`),
          fetch(`${API_BASE}/v1/receipts`),
          fetch(`${API_BASE}/v1/jobs?limit=12`),
        ]);
        if (!statusResponse.ok || !presetsResponse.ok || !receiptsResponse.ok || !jobsResponse.ok) {
          throw new Error("daemon request failed");
        }
        const nextStatus = await statusResponse.json();
        const nextConfig = nextStatus.config;
        const nextRegistry = await presetsResponse.json();
        const receipts = await receiptsResponse.json();
        const jobPayload = await jobsResponse.json();
        const nextJobs = jobPayload.jobs ?? [];
        setStatus(nextStatus);
        setConfig(nextConfig);
        setJobs(nextJobs);
        setRegistry(nextRegistry);
        setSelectedPreset(nextConfig.preset ?? "saas");
        setDaemonOnline(true);
        setApiError("");
        setLatestJob(nextStatus.latestJob ?? nextJobs[0] ?? null);
        setReceipt(nextStatus.latestReceipt ?? receipts.receipts[0] ?? null);
        setHistory(
          receipts.receipts.map((item) => ({
            id: item.id,
            preset: nextRegistry.presets[item.preset]?.name ?? item.preset,
            commitment: item.commitment,
            clean: true,
            proofs: item.proofStatuses.length,
            createdAt: item.createdAt,
            storageRoot: item.storageRoot,
          }))
        );

        eventSource = new EventSource(`${API_BASE}/v1/events`);
        eventSource.addEventListener("job", (event) => {
          const job = JSON.parse(event.data);
          if (!job.scan?.results) return;
          setLatestJob(job);
          setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 12));
          setProofRun(job.patternIds.map((id) => {
            const result = job.scan.results.find((item) => item.id === id);
            const latest = [...job.progress].reverse().find((item) => item.patternId === id);
            const status = job.status === "done"
              ? "done"
              : job.status === "failed"
                ? "failed"
                : result?.matched
                  ? "blocked"
                  : latest?.status ?? job.status;
            return {
              ...(result ?? { id }),
              status,
              proofSize: status === "done" ? 10560 : 0,
            };
          }));
        });
        eventSource.addEventListener("receipt", (event) => {
          const nextReceipt = JSON.parse(event.data);
          setReceipt(nextReceipt);
          setLatestJob((current) => current ? { ...current, status: "done", receiptId: nextReceipt.id } : current);
          setHistory((current) => [
            {
              id: nextReceipt.id,
              preset: nextRegistry.presets[nextReceipt.preset]?.name ?? nextReceipt.preset,
              commitment: nextReceipt.commitment,
              clean: true,
              proofs: nextReceipt.proofStatuses.length,
              createdAt: nextReceipt.createdAt,
              storageRoot: nextReceipt.storageRoot,
            },
            ...current.filter((item) => item.id !== nextReceipt.id),
          ]);
          setActiveTab("receipts");
        });
      } catch {
        setDaemonOnline(false);
        setApiError("Daemon is offline. Start the local agent with npm run daemon.");
      }
    }

    loadDaemonState();
    return () => {
      eventSource?.close();
    };
  }, []);

  const registryItems = useMemo(() => {
    return Object.entries(registry.patterns)
      .filter(([id, pattern]) => {
        const inFilter =
          registryFilter === "all" || registry.presets[registryFilter].patterns.includes(id);
        const query = registrySearch.trim().toLowerCase();
        const view = patternView(pattern);
        const inSearch =
          !query ||
          id.toLowerCase().includes(query) ||
          pattern.name.toLowerCase().includes(query) ||
          view.desc.toLowerCase().includes(query) ||
          pattern.industry.join(" ").toLowerCase().includes(query);
        return inFilter && inSearch;
      })
      .map(([id, pattern]) => ({ id, ...patternView(pattern) }));
  }, [registry, registryFilter, registrySearch]);

  async function runScan() {
    if (!daemonOnline) {
      setApiError("Daemon is offline. Start the local agent with npm run daemon.");
      return;
    }
    if (promptTooLarge) {
      setApiError(`Prompt is ${promptBytes} bytes; GhostProver accepts ${maxPromptBytes} bytes.`);
      return;
    }
    let response;
    try {
      response = await fetch(`${API_BASE}/v1/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, preset: selectedPreset }),
      });
    } catch {
      setDaemonOnline(false);
      setApiError("Scan failed because the daemon did not respond.");
      return;
    }
    if (!response.ok) {
      setApiError(await apiErrorMessage(response, "Scan failed."));
      return;
    }
    const payload = await response.json();
    setApiError("");
    const nextScan = adaptScan(payload, registry);
    setScan(nextScan);
    setCommitment(payload.commitment);
    setReceipt(null);
    setProofRun(
      nextScan.results.map((result) => ({
        ...result,
        status: result.matched ? "blocked" : "queued",
        proofSize: result.matched ? 0 : 10560,
      }))
    );
  }

  async function runProofs() {
    if (!scan || !scan.clean) return;
    if (!daemonOnline) {
      setApiError("Daemon is offline. Start the local agent with npm run daemon.");
      return;
    }
    if (promptTooLarge) {
      setApiError(`Prompt is ${promptBytes} bytes; GhostProver accepts ${maxPromptBytes} bytes.`);
      return;
    }

    setProofRun(scan.results.map((result) => ({ ...result, status: "queued", proofSize: 0 })));
    let response;
    try {
      response = await fetch(`${API_BASE}/v1/attest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, preset: selectedPreset }),
      });
    } catch {
      setDaemonOnline(false);
      setApiError("Attestation failed because the daemon did not respond.");
      return;
    }
    if (!response.ok) {
      setApiError(await apiErrorMessage(response, "Attestation failed."));
      return;
    }
    const payload = await response.json();
    setApiError("");
    setLatestJob(payload.job);
    if (payload.blocked) {
      setScan(adaptScan(payload.scan, registry));
      setProofRun(payload.job.scan.results.map((result) => ({
        ...result,
        status: result.matched ? "blocked" : "queued",
      })));
    }
  }

  async function runLiveReceipt() {
    if (!scan || !scan.clean) return;
    if (promptTooLarge) {
      setApiError(`Prompt is ${promptBytes} bytes; GhostProver accepts ${maxPromptBytes} bytes.`);
      return;
    }

    const demoPattern = scan.results.find((item) => item.id === "tech.aws_key")?.id ?? scan.results[0]?.id;
    if (!demoPattern) {
      setApiError("No policy pattern is available for the live receipt run.");
      return;
    }

    setApiError("");
    setLiveRun({ ...initialLiveRun(), running: true, stage: "queued", logs: [] });

    let response;
    try {
      response = await fetch(`${COMPUTE_API_BASE}/api/live-receipt/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, patterns: [demoPattern] }),
      });
    } catch {
      setLiveRun((current) => ({
        ...current,
        running: false,
        error: `Compute server is offline. Start it with: cd Compute && npm run server`,
      }));
      return;
    }

    if (!response.ok || !response.body) {
      const message = await apiErrorMessage(response, "Live 0G receipt failed to start.");
      setLiveRun((current) => ({
        ...current,
        running: false,
        error: message,
      }));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const parsed = parseSseBlock(block.trim());
          if (!parsed) continue;
          if (parsed.event === "progress") {
            setLiveRun((current) => ({
              ...current,
              stage: parsed.data.stage,
              progress: parsed.data.progress,
              logs: [{ level: "info", msg: parsed.data.msg }, ...current.logs].slice(0, 12),
            }));
          } else if (parsed.event === "sample") {
            setLiveRun((current) => ({ ...current, sample: parsed.data }));
          } else if (parsed.event === "log") {
            setLiveRun((current) => ({
              ...current,
              logs: [{ level: parsed.data.level, msg: parsed.data.msg }, ...current.logs].slice(0, 12),
            }));
          } else if (parsed.event === "result") {
            finalResult = parsed.data;
            const nextReceipt = {
              id: parsed.data.txHash,
              jobId: parsed.data.samplePath,
              preset: selectedPreset,
              patternIds: [demoPattern],
              commitment: parsed.data.commitment,
              targetHashes: parsed.data.targetHashes ?? [],
              proofStatuses: [
                {
                  patternId: demoPattern,
                  patternName: registry.patterns[demoPattern]?.name ?? demoPattern,
                  status: "done",
                  proofSize: 10560,
                  proofTimeMs: parsed.data.proofTimeMs,
                },
              ],
              storageRoot: parsed.data.storageRoot,
              status: parsed.data.txHash ? "on_chain" : "on_chain_failed",
              txHash: parsed.data.txHash,
              providerAddress: parsed.data.provider,
              modelId: parsed.data.model,
              createdAt: new Date().toISOString(),
            };
            setReceipt(nextReceipt);
            setCommitment(parsed.data.commitment);
            setActiveTab("console");
            setLiveRun((current) => ({
              ...current,
              result: parsed.data,
              progress: 100,
              stage: "complete",
            }));
          } else if (parsed.event === "error") {
            setLiveRun((current) => ({
              ...current,
              running: false,
              error: parsed.data.error ?? "Live 0G receipt failed.",
            }));
          }
        }
      }
    } finally {
      setLiveRun((current) => ({ ...current, running: false, result: finalResult ?? current.result }));
    }
  }

  async function verifyLiveReceipt() {
    const txHash = liveRun.result?.txHash ?? receipt?.txHash;
    if (!txHash) return;
    setLiveRun((current) => ({ ...current, verification: "checking" }));
    try {
      const response = await fetch(`${COMPUTE_API_BASE}/api/receipt/${txHash}`);
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Receipt verification failed."));
      const payload = await response.json();
      setLiveRun((current) => ({ ...current, verification: payload }));
    } catch (err) {
      setLiveRun((current) => ({ ...current, verification: { error: err.message } }));
    }
  }

  function resetRun() {
    setScan(null);
    setProofRun([]);
    setReceipt(null);
    setLatestJob(null);
    setApiError("");
    setCommitment("");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <LockKeyhole size={20} />
          </div>
          <div>
            <div className="brand-title">GhostProver</div>
            <div className="brand-subtitle">ZK Compliance Console</div>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={cx("nav-item", activeTab === tab.id && "active")}
                onClick={() => setActiveTab(tab.id)}
                type="button"
                title={tab.label}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-panel">
          <div className="panel-label">Network</div>
          <div className="network-row">
            <span className={cx("status-dot", daemonOnline && "live")} />
            <span>{networkLabel(config?.rpcUrl)}</span>
          </div>
          <div className="network-grid">
            <span>Registry</span>
            <strong>{config?.registryAddress ? shortHash(config.registryAddress) : "unset"}</strong>
            <span>Submit</span>
            <strong>{config?.onChainSubmit ? "on-chain" : "draft"}</strong>
            <span>Mode</span>
            <strong>{config?.proofMode ?? "background"}</strong>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operator workspace</p>
            <h1>Build, Scan, And Prove</h1>
            <p className={cx("daemon-state", daemonOnline ? "online" : "offline")}>
              {daemonOnline
                ? `${networkLabel(config?.rpcUrl)} policy active at ${API_BASE}`
                : `Daemon offline. Start it with: npm run cli -- daemon`}
            </p>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={resetRun} type="button" title="Reset run">
              <RefreshCw size={18} />
            </button>
            <button
              className="primary-action"
              onClick={runProofs}
              disabled={!scan?.clean || !daemonOnline || promptTooLarge}
              type="button"
            >
              <Play size={17} />
              Generate ZK proof
            </button>
            <button
              className="primary-action live"
              onClick={runLiveReceipt}
              disabled={!scan?.clean || liveRun.running || promptTooLarge}
              type="button"
              title="Run live 0G inference, bind proof to the attested request, upload to 0G Storage, and submit on-chain"
            >
              {liveRun.running ? <Loader2 size={17} className="spin" /> : <BadgeCheck size={17} />}
              Run live 0G receipt
            </button>
          </div>
        </header>

        {apiError && (
          <div className="error-banner" role="status">
            <div className="error-banner-content">
              <AlertTriangle size={17} />
              <span>{apiError}</span>
            </div>
            {!daemonOnline && (
              <code className="error-code-snippet" onClick={(e) => {
                navigator.clipboard.writeText("npm run daemon");
                e.target.innerText = "Copied!";
                setTimeout(() => e.target.innerText = "npm run daemon", 2000);
              }} title="Click to copy">
                npm run daemon
              </code>
            )}
          </div>
        )}

        {activeTab === "console" && (
          <section className="console-grid">
            <div className="main-column">
              <section className="surface intake-surface">
                <div className="surface-head">
                  <div>
                    <p className="section-kicker">Prompt intake</p>
                    <h2>Scan before inference</h2>
                  </div>
                  <div className={cx("byte-pill", promptBytes > maxPromptBytes * 0.9 && "warn", promptTooLarge && "danger")}>
                    {promptBytes} / {maxPromptBytes} bytes
                  </div>
                </div>

                <div className="preset-strip">
                  {Object.entries(registry.presets).map(([id, rawItem]) => {
                    const item = presetView(id, rawItem);
                    return (
                    <button
                      key={id}
                      className={cx("preset-chip", selectedPreset === id && "selected")}
                      style={{ "--preset": item.accent }}
                      onClick={() => {
                        setSelectedPreset(id);
                        resetRun();
                      }}
                      type="button"
                    >
                      <span>{item.short}</span>
                      <small>{item.patterns.length}</small>
                    </button>
                    );
                  })}
                </div>

                <textarea
                  className="prompt-box"
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    resetRun();
                  }}
                  aria-label="Prompt"
                />

                <div className="intake-actions">
                  <div className="sample-buttons">
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(SAMPLE_PROMPTS.clean);
                        resetRun();
                      }}
                    >
                      Clean sample
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(SAMPLE_PROMPTS.risky);
                        resetRun();
                      }}
                    >
                      Risk sample
                    </button>
                  </div>
                  <button
                    className="scan-button"
                    type="button"
                    disabled={promptBytes === 0 || !daemonOnline || promptTooLarge}
                    onClick={runScan}
                  >
                    <FileSearch size={18} />
                    Run scan
                  </button>
                </div>
              </section>

              <section className="surface">
                <div className="surface-head">
                  <div>
                    <p className="section-kicker">Pattern results</p>
                    <h2>{scan ? preset.name : "Awaiting scan"}</h2>
                  </div>
                  {scan && (
                    <div className={cx("verdict", scan.clean ? "clean" : "blocked")}>
                      {scan.clean ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                      {scan.clean ? "Clean" : `${blockedCount} blocked`}
                    </div>
                  )}
                </div>

                <div className="result-list">
                  {(scan?.results ?? preset.patterns.map((id) => ({ id, ...patternView(registry.patterns[id]) }))).map(
                    (item) => (
                      <div
                        key={item.id}
                        className={cx(
                          "result-row",
                          item.matched && "found",
                          item.matched === false && "clear"
                        )}
                      >
                        <div className="result-icon">
                          {item.matched ? (
                            <X size={16} />
                          ) : item.matched === false ? (
                            <Check size={16} />
                          ) : (
                            <Search size={16} />
                          )}
                        </div>
                        <div className="result-copy">
                          <strong>{item.name}</strong>
                          <span>{item.id}</span>
                        </div>
                        <div className="result-meta">
                          {item.matched ? `offset ${item.offset}` : item.matched === false ? "clear" : `${item.len} bytes`}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>
            </div>

            <aside className="side-column">
              <SubmissionProofPanel
                config={config}
                daemonOnline={daemonOnline}
                latestJob={latestJob}
                receipt={receipt}
                scan={scan}
                selectedPreset={selectedPreset}
              />

              <LiveReceiptPanel
                liveRun={liveRun}
                computeApiBase={COMPUTE_API_BASE}
                onVerify={verifyLiveReceipt}
              />

              <RuntimePanel config={config} status={status} jobs={jobs} />

              <MetricGrid
                cleanCount={cleanCount}
                blockedCount={blockedCount}
                proofRun={proofRun}
                selectedCount={preset.patterns.length}
              />

              <section className="surface">
                <div className="surface-head compact">
                  <div>
                    <p className="section-kicker">Proof run</p>
                    <h2>Batch prover</h2>
                  </div>
                  <CloudCog size={20} />
                </div>
                <div className="proof-list">
                  {(proofRun.length ? proofRun : preset.patterns.map((id) => ({ id, status: "idle" }))).map(
                    (item) => (
                      <ProofRow key={item.id} item={item} />
                    )
                  )}
                </div>
              </section>

              <section className="surface receipt-preview">
                <div className="surface-head compact">
                  <div>
                    <p className="section-kicker">Receipt</p>
                    <h2>0G anchor</h2>
                  </div>
                  <Database size={20} />
                </div>
                <ReceiptFields receipt={receipt} commitment={commitment} />
              </section>
            </aside>
          </section>
        )}

        {activeTab === "registry" && (
          <section className="surface registry-surface">
            <div className="surface-head">
              <div>
                <p className="section-kicker">Registry</p>
                <h2>Pattern catalog</h2>
              </div>
              <div className="registry-tools">
                <label className="search-control">
                  <Search size={16} />
                  <input
                    value={registrySearch}
                    onChange={(event) => setRegistrySearch(event.target.value)}
                    placeholder="Search"
                  />
                </label>
                <label className="select-control">
                  <Filter size={16} />
                  <select
                    value={registryFilter}
                    onChange={(event) => setRegistryFilter(event.target.value)}
                  >
                    <option value="all">All presets</option>
                    {Object.entries(registry.presets).map(([id, item]) => (
                      <option key={id} value={id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </label>
              </div>
            </div>

            <div className="registry-table">
              {registryItems.map((pattern) => (
                <article key={pattern.id} className="pattern-card">
                  <div className="pattern-top">
                    <div>
                      <h3>{pattern.name}</h3>
                      <p>{pattern.desc}</p>
                    </div>
                    <span>{pattern.len}</span>
                  </div>
                  <div className="pattern-classes">
                    {pattern.types.slice(0, Math.min(pattern.types.length, 14)).map((type, index) => (
                      <span key={`${pattern.id}-${index}`}>{CLASS_LABELS[type]}</span>
                    ))}
                  </div>
                  <div className="pattern-tags">
                    <code>{pattern.id}</code>
                    <span>{pattern.regulation || "internal"}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "receipts" && (
          <section className="receipts-grid">
            <section className="surface">
              <div className="surface-head">
                <div>
                  <p className="section-kicker">Jobs</p>
                  <h2>Proof queue</h2>
                </div>
                <Activity size={22} />
              </div>
              <div className="history-list">
                {jobs.length === 0 ? (
                  <div className="empty-state">
                    <CloudCog size={24} />
                    <span>No proof jobs recorded</span>
                  </div>
                ) : (
                  jobs.map((item) => (
                    <article key={item.id} className="job-row">
                      <div>
                        <strong>{item.preset ?? "custom policy"}</strong>
                        <span>{formatDate(item.updatedAt)}</span>
                      </div>
                      <code>{shortHash(item.commitment)}</code>
                      <span className={cx("status-badge", item.status)}>{item.status}</span>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="surface">
              <div className="surface-head">
                <div>
                  <p className="section-kicker">Latest receipt</p>
                  <h2>{receipt ? "Batch receipt ready" : "No receipt yet"}</h2>
                </div>
                <BadgeCheck size={22} />
              </div>
              <ReceiptFields receipt={receipt} commitment={commitment} expanded />
            </section>

            <section className="surface">
              <div className="surface-head">
                <div>
                  <p className="section-kicker">History</p>
                  <h2>Recent attestations</h2>
                </div>
                <History size={22} />
              </div>
              <div className="history-list">
                {history.length === 0 ? (
                  <div className="empty-state">
                    <ClipboardCheck size={24} />
                    <span>No attestations recorded</span>
                  </div>
                ) : (
                  history.map((item) => (
                    <article key={item.id} className="history-row">
                      <div>
                        <strong>{item.preset}</strong>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <code>{shortHash(item.commitment)}</code>
                      <span className="history-badge">{item.proofs} proofs</span>
                    </article>
                  ))
                )}
              </div>
            </section>
          </section>
        )}
      </main>
    </div>
  );
}

function SubmissionProofPanel({ config, daemonOnline, latestJob, receipt, scan, selectedPreset }) {
  const steps = [
    {
      label: "Policy",
      detail: config?.policyPatternIds?.length
        ? `${selectedPreset} · ${config.policyPatternIds.length} patterns`
        : selectedPreset,
      status: config ? "done" : "waiting",
      icon: KeyRound,
    },
    {
      label: "Daemon",
      detail: daemonOnline ? "HTTP + SSE connected" : "offline",
      status: daemonOnline ? "done" : "blocked",
      icon: Server,
    },
    {
      label: "Scan",
      detail: scan ? (scan.clean ? "clean prompt" : "sensitive data found") : "awaiting prompt",
      status: scan ? (scan.clean ? "done" : "blocked") : "waiting",
      icon: FileSearch,
    },
    {
      label: "Proof job",
      detail: latestJob ? latestJob.status : "not started",
      status: latestJob?.status === "done" ? "done" : latestJob?.status === "blocked" ? "blocked" : latestJob ? "active" : "waiting",
      icon: CloudCog,
    },
    {
      label: "Receipt",
      detail: receipt
        ? receipt.status === "on_chain"
          ? shortHash(receipt.txHash)
          : receipt.status === "on_chain_failed"
            ? "0G submission failed"
            : "draft pending 0G"
        : "awaiting proof",
      status: receipt ? "done" : "waiting",
      icon: Database,
    },
  ];

  return (
    <section className="surface submission-panel">
      <div className="surface-head compact">
        <div>
          <p className="section-kicker">0G receipt flow</p>
          <h2>Compliance artifact</h2>
        </div>
        <ClipboardCheck size={20} />
      </div>
      <div className="submission-status">
        <span className={cx("status-dot", daemonOnline && "live")} />
        <strong>
          {receipt?.status === "on_chain"
            ? "Anchored on 0G"
            : receipt?.status === "on_chain_failed"
              ? "0G submission failed"
              : receipt
                ? "Draft cached"
                : scan?.clean
                  ? "Ready to prove"
                  : scan
                    ? "Blocked"
                    : "Ready"}
        </strong>
        <code>{config?.storage?.dir ?? ".ghostprover"}</code>
      </div>
      <div className="workflow-list">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div className={cx("workflow-step", step.status)} key={step.label}>
              <div className="workflow-icon">
                <Icon size={15} />
              </div>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LiveReceiptPanel({ liveRun, computeApiBase, onVerify }) {
  const result = liveRun.result;
  const sample = liveRun.sample;
  const verificationError =
    liveRun.verification && typeof liveRun.verification === "object" && liveRun.verification.error;
  const verifiedEvents =
    liveRun.verification && typeof liveRun.verification === "object" && liveRun.verification.events;

  const steps = [
    ["Inference", sample ? "done" : liveRun.progress >= 8 ? "active" : "waiting"],
    ["TEE", result?.attestationValid || sample?.teeVerified ? "done" : liveRun.progress >= 36 ? "active" : "waiting"],
    ["Proof", liveRun.progress >= 75 ? "done" : liveRun.progress >= 48 ? "active" : "waiting"],
    ["Storage", result?.storageRoot ? "done" : liveRun.progress >= 86 ? "active" : "waiting"],
    ["Chain", result?.txHash ? "done" : liveRun.progress >= 96 ? "active" : "waiting"],
  ];

  return (
    <section className="surface live-receipt-panel">
      <div className="surface-head compact">
        <div>
          <p className="section-kicker">Live 0G receipt</p>
          <h2>{result?.txHash ? "On-chain artifact" : liveRun.running ? "Pipeline running" : "Ready"}</h2>
        </div>
        {liveRun.running ? <Loader2 size={20} className="spin" /> : <BadgeCheck size={20} />}
      </div>

      <div className="live-progress">
        <div className="progress-track">
          <span style={{ width: `${liveRun.progress}%` }} />
        </div>
        <div className="progress-meta">
          <strong>{liveRun.progress}%</strong>
          <span>{liveRun.stage}</span>
        </div>
      </div>

      <div className="live-step-grid">
        {steps.map(([label, status]) => (
          <div className={cx("live-step", status)} key={label}>
            {status === "done" ? <Check size={14} /> : status === "active" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            <span>{label}</span>
          </div>
        ))}
      </div>

      {sample?.response && (
        <div className="model-response">
          <span>Model response</span>
          <p>{sample.response}</p>
        </div>
      )}

      <div className="receipt-fields compact-fields">
        <div className="receipt-field">
          <span>Compute API</span>
          <code>{computeApiBase}</code>
        </div>
        <div className="receipt-field">
          <span>TEE verified</span>
          <code>{String(result?.attestationValid ?? sample?.teeVerified ?? "pending")}</code>
        </div>
        <div className="receipt-field">
          <span>Provider</span>
          <code>{shortHash(result?.provider ?? sample?.provider)}</code>
        </div>
        <div className="receipt-field">
          <span>Model</span>
          <code>{result?.model ?? sample?.model ?? "pending"}</code>
        </div>
        <div className="receipt-field">
          <span>Storage root</span>
          <code>{shortHash(result?.storageRoot)}</code>
        </div>
        <div className="receipt-field">
          <span>Chain tx</span>
          <code>{shortHash(result?.txHash)}</code>
        </div>
      </div>

      {result?.txHash && (
        <button className="verify-button" type="button" onClick={onVerify}>
          <ShieldCheck size={16} />
          Verify on-chain receipt
        </button>
      )}

      {liveRun.verification === "checking" && (
        <div className="receipt-state">
          <Loader2 size={15} className="spin" />
          Checking registry event
        </div>
      )}
      {verifiedEvents && (
        <div className="receipt-state">
          <Hash size={15} />
          Verified {verifiedEvents.length} registry event(s)
        </div>
      )}
      {verificationError && (
        <div className="receipt-state failed">
          <AlertTriangle size={15} />
          {verificationError}
        </div>
      )}
      {liveRun.error && (
        <div className="receipt-state failed">
          <AlertTriangle size={15} />
          {liveRun.error}
        </div>
      )}
    </section>
  );
}

function RuntimePanel({ config, status, jobs }) {
  const counts = status?.counts?.byStatus ?? {};
  const rows = [
    ["RPC", config?.rpcUrl ?? "pending"],
    ["Registry", config?.registryAddress || "not configured"],
    ["Proof mode", config?.proofMode ?? "background"],
    ["Policy", `${config?.policyPatternIds?.length ?? 0} patterns`],
    ["Jobs", `${jobs.length} recent / ${status?.counts?.jobs ?? 0} total`],
  ];

  return (
    <section className="surface runtime-panel">
      <div className="surface-head compact">
        <div>
          <p className="section-kicker">Runtime</p>
          <h2>{networkLabel(config?.rpcUrl)}</h2>
        </div>
        <Server size={20} />
      </div>
      <div className="runtime-grid">
        {rows.map(([label, value]) => (
          <div className="runtime-row" key={label}>
            <span>{label}</span>
            <code>{value}</code>
          </div>
        ))}
      </div>
      <div className="status-strip">
        {["queued", "proving", "blocked", "done", "failed"].map((key) => (
          <span className={cx("status-badge", key)} key={key}>
            {key} {counts[key] ?? 0}
          </span>
        ))}
      </div>
    </section>
  );
}

function MetricGrid({ cleanCount, blockedCount, proofRun, selectedCount }) {
  const done = proofRun.filter((item) => item.status === "done").length;
  const proving = proofRun.some((item) => item.status === "proving");
  const metrics = [
    { label: "Patterns", value: selectedCount, icon: Blocks },
    { label: "Clean", value: cleanCount || "-", icon: ShieldCheck },
    { label: "Blocked", value: blockedCount || "0", icon: AlertTriangle },
    { label: "Proofs", value: proving ? `${done}/${proofRun.length}` : done || "-", icon: Activity },
  ];

  return (
    <section className="metric-grid">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div className="metric-card" key={metric.label}>
            <Icon size={17} />
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        );
      })}
    </section>
  );
}

function ProofRow({ item }) {
  const pattern = REGISTRY.patterns[item.id] ?? item;
  const icon =
    item.status === "done" ? (
      <Check size={15} />
    ) : item.status === "proving" ? (
      <Loader2 size={15} className="spin" />
    ) : item.status === "blocked" ? (
      <X size={15} />
    ) : (
      <Sparkles size={15} />
    );

  return (
    <div className={cx("proof-row", item.status)}>
      <div className="proof-icon">{icon}</div>
      <div>
        <strong>{pattern.name}</strong>
        <span>{item.status === "done" ? `${item.proofSize} bytes` : item.status}</span>
      </div>
    </div>
  );
}

function ReceiptFields({ receipt, commitment, expanded = false }) {
  const rows = receipt
    ? [
        ["Commitment", receipt.commitment],
        ["Storage root", receipt.storageRoot],
        ["Tx hash", receipt.txHash],
        ["Provider", receipt.providerAddress],
        ["Model", receipt.modelId],
        ["Job", receipt.jobId],
        ["Status", receipt.status],
        ["Patterns", String(receipt.patternIds?.length ?? 0)],
        ["Created", receipt.createdAt],
      ]
    : [
        ["Commitment", commitment || "pending"],
        ["Storage root", "pending"],
        ["Provider", "pending"],
        ["Model", "pending"],
      ];

  return (
    <div className={cx("receipt-fields", expanded && "expanded")}>
      {rows.map(([label, value]) => (
        <div className="receipt-field" key={label}>
          <span>{label}</span>
          <code>{expanded ? value : shortHash(value)}</code>
        </div>
      ))}
      {receipt && (
        <div className={cx("receipt-state", receipt.status === "on_chain_failed" && "failed")}>
          <Hash size={15} />
          {receipt.status === "on_chain"
            ? "0G receipt anchored"
            : receipt.status === "on_chain_failed"
              ? "0G submission failed"
              : "Draft cached for 0G"}
        </div>
      )}
    </div>
  );
}

export default App;
