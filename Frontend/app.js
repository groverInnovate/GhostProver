// ============================================================
// GhostProver Frontend — app.js
// Self-contained: embeds registry data, mirrors circuit scan logic
// No build step, no npm, no framework — pure JS
// ============================================================

// --- Embedded Registry (mirrors src/registry/patterns.json) ---
const REGISTRY = {
  patterns: {
    "in.aadhar":     { name: "Aadhar Number",        desc: "12-digit Indian identity number", industry: ["india_kyc","banking","healthcare","fintech"], regulation: "Aadhar Act 2016", types: [1,1,1,1,1,1,1,1,1,1,1,1], len: 12, example: "234567890123" },
    "in.pan":        { name: "PAN Card",              desc: "Indian PAN (AAAAA0000A)",         industry: ["india_kyc","banking","fintech"],              regulation: "Income Tax Act",   types: [3,3,3,3,3,1,1,1,1,3],   len: 10, example: "ABCDE1234F" },
    "in.passport":   { name: "Indian Passport",       desc: "Letter + 7 digits",               industry: ["india_kyc"],                                  regulation: "Passport Act",     types: [3,1,1,1,1,1,1,1],       len: 8,  example: "A1234567" },
    "in.voter":      { name: "Indian Voter ID",       desc: "3 letters + 7 digits",            industry: ["india_kyc"],                                  regulation: "RPA 1950",         types: [3,3,3,1,1,1,1,1,1,1],   len: 10, example: "ABC1234567" },
    "pii.ssn":       { name: "US SSN",                desc: "Social Security Number",          industry: ["banking","healthcare","insurance"],            regulation: "Privacy Act",      types: [1,1,1,0,1,1,0,1,1,1,1], len: 11, example: "123-45-6789", values: [0,0,0,45,0,0,45,0,0,0,0] },
    "pii.phone_in":  { name: "Indian Phone",          desc: "+91 + 10 digits",                 industry: ["india_kyc","telecom"],                        regulation: "TRAI",             types: [0,0,0,1,1,1,1,1,1,1,1,1,1], len: 13, example: "+919876543210", values: [43,57,49] },
    "pii.dob_iso":   { name: "Date of Birth (ISO)",   desc: "YYYY-MM-DD format",               industry: ["healthcare","banking","insurance"],            regulation: "GDPR / CCPA",      types: [1,1,1,1,0,1,1,0,1,1],   len: 10, example: "1990-01-15", values: [0,0,0,0,45,0,0,45,0,0] },
    "fin.cc16":      { name: "Credit Card (16 digits)", desc: "16-digit card number",          industry: ["banking","fintech","ecommerce"],               regulation: "PCI DSS",          types: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], len: 16, example: "4111111111111111" },
    "fin.routing":   { name: "US Routing Number",     desc: "9-digit ABA routing",             industry: ["banking","fintech"],                           regulation: "Federal Reserve",  types: [1,1,1,1,1,1,1,1,1],     len: 9,  example: "021000021" },
    "health.npi":    { name: "NPI",                   desc: "10-digit provider ID",            industry: ["healthcare"],                                  regulation: "HIPAA",            types: [1,1,1,1,1,1,1,1,1,1],   len: 10, example: "1234567890" },
    "health.dea":    { name: "DEA Number",            desc: "2 letters + 7 digits",            industry: ["healthcare"],                                  regulation: "DEA CSA",          types: [3,3,1,1,1,1,1,1,1],     len: 9,  example: "AB1234567" },
    "tech.aws_key":  { name: "AWS Access Key",        desc: "AKIA + 16 alphanumeric",          industry: ["saas","devops","cloud"],                       regulation: "SOC 2",            types: [0,0,0,0,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5], len: 20, example: "AKIAIOSFODNN7EXAMPLE", values: [65,75,73,65] },
    "tech.github_pat": { name: "GitHub PAT",          desc: "ghp_ + 36 alphanumeric",          industry: ["saas","devops"],                               regulation: "",                 types: [0,0,0,0,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5], len: 32, example: "ghp_ABCDEFGHIJ...", values: [103,104,112,95] },
    "tech.openai_key": { name: "OpenAI API Key",      desc: "sk- + 20 alphanumeric",           industry: ["saas","ai"],                                  regulation: "",                 types: [0,0,0,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5], len: 23, example: "sk-abc123...", values: [115,107,45] },
    "tech.stripe_key": { name: "Stripe Secret Key",   desc: "sk_live_ + 24 alphanumeric",      industry: ["fintech","ecommerce","saas"],                  regulation: "PCI DSS",          types: [0,0,0,0,0,0,0,0,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5], len: 32, example: "sk_live_ABCDE...", values: [115,107,95,108,105,118,101,95] },
  },
  presets: {
    india_kyc:  { name: "India KYC",          emoji: "🇮🇳", patterns: ["in.aadhar","in.pan","in.passport","in.voter","pii.phone_in"] },
    banking:    { name: "Banking",            emoji: "🏦", patterns: ["in.aadhar","pii.ssn","fin.cc16","fin.routing","pii.dob_iso"] },
    healthcare: { name: "Healthcare",         emoji: "🏥", patterns: ["pii.ssn","health.npi","health.dea","pii.dob_iso","in.aadhar"] },
    fintech:    { name: "Fintech",            emoji: "💳", patterns: ["fin.cc16","in.aadhar","in.pan","tech.stripe_key","pii.ssn"] },
    saas:       { name: "SaaS / DevOps",      emoji: "☁️", patterns: ["tech.aws_key","tech.github_pat","tech.openai_key","tech.stripe_key"] },
  }
};

// --- Character class matcher (mirrors circuit) ---
function matchesClass(byte, classType, classValue) {
  switch (classType) {
    case 0: return byte === classValue;
    case 1: return byte >= 48 && byte <= 57;
    case 2: return byte >= 97 && byte <= 122;
    case 3: return byte >= 65 && byte <= 90;
    case 4: return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    case 5: return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    case 6: return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102);
    case 7: return ((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte === 43 || byte === 47 || byte === 61);
    case 8: return true;
    default: return false;
  }
}

function getPatternArrays(pat) {
  const types = new Array(32).fill(0);
  const values = new Array(32).fill(0);
  for (let i = 0; i < pat.types.length; i++) types[i] = pat.types[i];
  if (pat.values) for (let i = 0; i < pat.values.length; i++) values[i] = pat.values[i];
  return { types, values };
}

function scanSingle(promptBytes, pat) {
  const { types, values } = getPatternArrays(pat);
  for (let i = 0; i <= promptBytes.length - pat.len; i++) {
    let allMatch = true;
    for (let j = 0; j < pat.len; j++) {
      if (!matchesClass(promptBytes[i + j], types[j], values[j])) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return { matched: true, offset: i };
  }
  return { matched: false, offset: -1 };
}

// --- State ---
let selectedPreset = "banking";
let scanHistory = JSON.parse(localStorage.getItem("gp_history") || "[]");

// --- DOM ---
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// --- Tab switching ---
$$(".nav-link").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const tab = link.dataset.tab;
    $$(".nav-link").forEach(l => l.classList.remove("active"));
    link.classList.add("active");
    $$(".tab-content").forEach(t => t.classList.remove("active"));
    $(`#tab-${tab}`).classList.add("active");
  });
});

// --- Render presets ---
function renderPresets() {
  const grid = $("#preset-grid");
  grid.innerHTML = "";
  for (const [id, preset] of Object.entries(REGISTRY.presets)) {
    const btn = document.createElement("button");
    btn.className = `preset-btn${id === selectedPreset ? " selected" : ""}`;
    btn.innerHTML = `
      <span class="preset-emoji">${preset.emoji}</span>
      <span class="preset-name">${preset.name}</span>
      <span class="preset-count">${preset.patterns.length} patterns</span>
    `;
    btn.addEventListener("click", () => {
      selectedPreset = id;
      renderPresets();
    });
    grid.appendChild(btn);
  }
}

// --- Prompt input ---
const promptInput = $("#prompt-input");
const byteCount = $("#byte-count");
const scanBtn = $("#scan-btn");

promptInput.addEventListener("input", () => {
  const bytes = new TextEncoder().encode(promptInput.value);
  const len = Math.min(bytes.length, 512);
  byteCount.textContent = `${len} / 512 bytes`;
  byteCount.style.color = len > 480 ? "var(--yellow)" : len > 0 ? "var(--text-dim)" : "var(--text-dim)";
  scanBtn.disabled = len === 0;
});

// --- Scan ---
scanBtn.addEventListener("click", () => {
  const text = promptInput.value;
  if (!text) return;

  const bytes = new TextEncoder().encode(text);
  const promptBytes = bytes.length > 512 ? bytes.slice(0, 512) : bytes;
  const preset = REGISTRY.presets[selectedPreset];
  const results = [];

  for (const patId of preset.patterns) {
    const pat = REGISTRY.patterns[patId];
    const { matched, offset } = scanSingle(promptBytes, pat);
    results.push({ id: patId, name: pat.name, matched, offset });
  }

  renderResults(results, promptBytes.length);

  // Save to history
  const entry = {
    time: new Date().toISOString(),
    preset: selectedPreset,
    presetName: preset.name,
    promptPreview: text.slice(0, 60),
    results,
    byteLen: promptBytes.length,
  };
  scanHistory.unshift(entry);
  if (scanHistory.length > 20) scanHistory.pop();
  localStorage.setItem("gp_history", JSON.stringify(scanHistory));
  renderHistory();
});

// --- Render results ---
function renderResults(results, byteLen) {
  const card = $("#results-card");
  const badge = $("#results-badge");
  const list = $("#results-list");
  const commitDisplay = $("#commitment-display");
  const commitHash = $("#commitment-hash");

  card.style.display = "block";

  const foundCount = results.filter(r => r.matched).length;
  const isClean = foundCount === 0;

  badge.className = `results-badge ${isClean ? "clean" : "alert"}`;
  badge.textContent = isClean ? `✅ All ${results.length} patterns clear` : `⚠️ ${foundCount} pattern${foundCount > 1 ? "s" : ""} detected`;

  // Fake commitment display (would be real Poseidon2 in full SDK)
  commitDisplay.style.display = "flex";
  commitHash.textContent = `0x${Array.from({length: 64}, () => "0123456789abcdef"[Math.random()*16|0]).join("")}`;

  list.innerHTML = "";
  for (const r of results) {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <span class="result-icon">${r.matched ? "🔴" : "🟢"}</span>
      <div class="result-info">
        <div class="result-name">${r.name}</div>
        <div class="result-id">${r.id}</div>
        ${r.matched ? `<div class="result-offset">Found at byte offset ${r.offset}</div>` : ""}
      </div>
      <span class="result-status ${r.matched ? "found" : "clean"}">${r.matched ? "DETECTED" : "CLEAN"}</span>
    `;
    list.appendChild(item);
  }

  // Smooth scroll to results
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// --- Registry tab ---
function renderRegistry(filter = "all") {
  const grid = $("#registry-grid");
  const filterSelect = $("#registry-filter");

  // Populate filter options
  if (filterSelect.options.length <= 1) {
    for (const [id, preset] of Object.entries(REGISTRY.presets)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${preset.emoji} ${preset.name}`;
      filterSelect.appendChild(opt);
    }
    filterSelect.addEventListener("change", () => renderRegistry(filterSelect.value));
  }

  grid.innerHTML = "";
  const entries = Object.entries(REGISTRY.patterns);

  for (const [id, pat] of entries) {
    if (filter !== "all") {
      const preset = REGISTRY.presets[filter];
      if (!preset.patterns.includes(id)) continue;
    }

    const item = document.createElement("div");
    item.className = "registry-item";
    item.innerHTML = `
      <div class="registry-item-header">
        <span class="registry-item-name">${pat.name}</span>
        <span class="registry-item-len">len=${pat.len}</span>
      </div>
      <div class="registry-item-desc">${pat.desc}</div>
      <div class="registry-item-meta">
        <span class="registry-tag">${id}</span>
        ${pat.regulation ? `<span class="registry-tag regulation">${pat.regulation}</span>` : ""}
        ${pat.industry.map(i => `<span class="registry-tag">${i}</span>`).join("")}
      </div>
    `;
    grid.appendChild(item);
  }
}

// --- History tab ---
function renderHistory() {
  const list = $("#history-list");

  if (scanHistory.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p>No scans yet.</p>
        <p class="empty-sub">Scan a prompt to get started.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = "";
  for (const entry of scanHistory) {
    const item = document.createElement("div");
    item.className = "history-item";
    const time = new Date(entry.time);
    const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const foundCount = entry.results.filter(r => r.matched).length;

    item.innerHTML = `
      <div class="history-item-header">
        <span class="history-time">${timeStr}</span>
        <span class="history-preset">${entry.presetName}</span>
      </div>
      <div class="history-commitment">"${entry.promptPreview}${entry.promptPreview.length >= 60 ? "..." : ""}" — ${entry.byteLen} bytes</div>
      <div class="history-patterns">
        ${entry.results.map(r =>
          `<span class="history-pattern-tag ${r.matched ? "found" : "clean"}">${r.id}</span>`
        ).join("")}
      </div>
    `;
    list.appendChild(item);
  }
}

// --- Init ---
renderPresets();
renderRegistry();
renderHistory();
