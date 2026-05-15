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
import { bytesOf, digestHex, makeDemoReceipt, scanPreset } from "./scanner.js";

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
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem("ghostprover-history") || "[]");
  } catch {
    return [];
  }
}

function App() {
  const [activeTab, setActiveTab] = useState("console");
  const [selectedPreset, setSelectedPreset] = useState("saas");
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS.clean);
  const [scan, setScan] = useState(null);
  const [commitment, setCommitment] = useState("");
  const [proofRun, setProofRun] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [registryFilter, setRegistryFilter] = useState("all");
  const [registrySearch, setRegistrySearch] = useState("");

  const preset = REGISTRY.presets[selectedPreset];
  const promptBytes = bytesOf(prompt).length;
  const blockedCount = scan?.results.filter((item) => item.matched).length ?? 0;
  const cleanCount = scan?.results.filter((item) => !item.matched).length ?? 0;

  useEffect(() => {
    localStorage.setItem("ghostprover-history", JSON.stringify(history.slice(0, 12)));
  }, [history]);

  const registryItems = useMemo(() => {
    return Object.entries(REGISTRY.patterns)
      .filter(([id, pattern]) => {
        const inFilter =
          registryFilter === "all" || REGISTRY.presets[registryFilter].patterns.includes(id);
        const query = registrySearch.trim().toLowerCase();
        const inSearch =
          !query ||
          id.toLowerCase().includes(query) ||
          pattern.name.toLowerCase().includes(query) ||
          pattern.desc.toLowerCase().includes(query) ||
          pattern.industry.join(" ").toLowerCase().includes(query);
        return inFilter && inSearch;
      })
      .map(([id, pattern]) => ({ id, ...pattern }));
  }, [registryFilter, registrySearch]);

  async function runScan() {
    const nextScan = scanPreset(prompt, selectedPreset);
    const nextCommitment = await digestHex(`${selectedPreset}:${prompt.slice(0, 512)}`);
    setScan(nextScan);
    setCommitment(nextCommitment);
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

    const base = scan.results.map((result) => ({
      ...result,
      status: "queued",
      proofSize: 10560,
    }));
    setProofRun(base);
    setReceipt(null);

    for (const result of scan.results) {
      setProofRun((current) =>
        current.map((item) => (item.id === result.id ? { ...item, status: "proving" } : item))
      );
      await new Promise((resolve) => setTimeout(resolve, 520));
      setProofRun((current) =>
        current.map((item) =>
          item.id === result.id
            ? { ...item, status: "done", proofMs: 42000 + item.len * 911 }
            : item
        )
      );
    }

    const nextReceipt = makeDemoReceipt(scan, commitment);
    setReceipt(nextReceipt);
    setHistory((current) => [
      {
        id: `${Date.now()}`,
        preset: scan.presetName,
        commitment,
        clean: true,
        proofs: scan.results.length,
        createdAt: nextReceipt.submittedAt,
        storageRoot: nextReceipt.storageRoot,
      },
      ...current,
    ]);
    setActiveTab("receipts");
  }

  function resetRun() {
    setScan(null);
    setProofRun([]);
    setReceipt(null);
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
            <span className="status-dot live" />
            <span>0G Galileo Testnet</span>
          </div>
          <div className="network-grid">
            <span>Verifier</span>
            <strong>Honk</strong>
            <span>Circuit</span>
            <strong>v2</strong>
            <span>Mode</span>
            <strong>Pattern</strong>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operator workspace</p>
            <h1>Compliance proof desk</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={resetRun} type="button" title="Reset run">
              <RefreshCw size={18} />
            </button>
            <button
              className="primary-action"
              onClick={runProofs}
              disabled={!scan?.clean}
              type="button"
            >
              <Play size={17} />
              Generate proofs
            </button>
          </div>
        </header>

        {activeTab === "console" && (
          <section className="console-grid">
            <div className="main-column">
              <section className="surface intake-surface">
                <div className="surface-head">
                  <div>
                    <p className="section-kicker">Prompt intake</p>
                    <h2>Scan before inference</h2>
                  </div>
                  <div className={cx("byte-pill", promptBytes > 480 && "warn")}>
                    {Math.min(promptBytes, 512)} / 512 bytes
                  </div>
                </div>

                <div className="preset-strip">
                  {Object.entries(REGISTRY.presets).map(([id, item]) => (
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
                  ))}
                </div>

                <textarea
                  className="prompt-box"
                  value={prompt}
                  maxLength={512}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    resetRun();
                  }}
                  aria-label="Prompt"
                />

                <div className="intake-actions">
                  <div className="sample-buttons">
                    <button type="button" onClick={() => setPrompt(SAMPLE_PROMPTS.clean)}>
                      Clean sample
                    </button>
                    <button type="button" onClick={() => setPrompt(SAMPLE_PROMPTS.risky)}>
                      Risk sample
                    </button>
                  </div>
                  <button
                    className="scan-button"
                    type="button"
                    disabled={promptBytes === 0}
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
                  {(scan?.results ?? preset.patterns.map((id) => ({ id, ...REGISTRY.patterns[id] }))).map(
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
                    {Object.entries(REGISTRY.presets).map(([id, item]) => (
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
                        <span>{new Date(item.createdAt).toLocaleString()}</span>
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
        ["Provider", receipt.providerAddress],
        ["Model", receipt.modelId],
        ["Registry", receipt.registry],
        ["Chain", receipt.chain],
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
        <div className="receipt-state">
          <Hash size={15} />
          Batch receipt sealed
        </div>
      )}
    </div>
  );
}

export default App;
