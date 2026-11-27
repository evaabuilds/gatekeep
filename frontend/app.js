// GateKeep frontend: editor, scanning, results, filters, score, history, reports.
// Organised in small sections. Each section = one feature.

const $ = (id) => document.getElementById(id);   // tiny helper: find element by id

const MAX_CHARS = 50000;
const HISTORY_KEY = "gk-history";
const THEME_KEY = "gk-theme";

const els = {
  code: $("code"), highlight: $("highlight"), gutter: $("gutter"), editor: document.querySelector(".editor"),
  language: $("language"), sampleBtn: $("sample-btn"), fileInput: $("file-input"), clearBtn: $("clear-btn"),
  charCount: $("char-count"), useAi: $("use-ai"), scanBtn: $("scan-btn"),
  reportBtn: $("report-btn"), reportMenu: $("report-menu"),
  progress: $("progress"), scoreBox: $("score-box"), scoreRing: $("score-ring"),
  scoreGrade: $("score-grade"), scoreNum: $("score-num"), scoreText: $("score-text"),
  filters: $("filters"), search: $("search"), expandAll: $("expand-all"),
  status: $("status"), findings: $("findings"),
  historyBtn: $("history-btn"), drawer: $("history-drawer"), historyList: $("history-list"),
  historyClose: $("history-close"), historyClear: $("history-clear"), toast: $("toast"),
};

// App state: what we remember while the page is open.
const state = {
  lastResult: null,      // the last /scan answer
  filter: "all",         // which filter chip is active
  query: "",             // search text
  allOpen: false,        // "Expand all" toggle
};

/* =========================================================
   1. THEMES (light / dark / gradient)
   ========================================================= */
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;   // CSS reads [data-theme="..."]
  localStorage.setItem(THEME_KEY, theme);           // remember for next visit
  document.querySelectorAll("[data-theme-choice]").forEach((b) =>
    b.classList.toggle("active", b.dataset.themeChoice === theme));
}
document.querySelectorAll("[data-theme-choice]").forEach((btn) =>
  btn.addEventListener("click", () => setTheme(btn.dataset.themeChoice)));
setTheme(localStorage.getItem(THEME_KEY) || "dark");

/* =========================================================
   2. CODE EDITOR: line numbers + syntax colours
   The user types in a transparent <textarea>. Behind it, a <pre>
   shows the same text with colours. We keep both in sync.
   ========================================================= */
const KEYWORDS = {
  python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print self",
  javascript: "async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null return super switch this throw true try typeof undefined var void while with yield require",
};
const TOKEN_RE = {
  python: /(#.*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/g,
  javascript: /(\/\/.*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)/g,
};

// Make text safe to put inside HTML (so code like <script> shows as text, never runs).
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Colour one line of code. Every piece of user text goes through escapeHtml().
function colourLine(line, lang) {
  const keywords = new Set(KEYWORDS[lang].split(" "));
  const re = new RegExp(TOKEN_RE[lang].source, "g");
  let out = "", last = 0, m;
  while ((m = re.exec(line))) {
    out += escapeHtml(line.slice(last, m.index));
    const [tok, com, str, num, word] = m;
    let cls = "";
    if (com) cls = "tok-com";
    else if (str) cls = "tok-str";
    else if (num) cls = "tok-num";
    else if (word && keywords.has(word)) cls = "tok-kw";
    else if (word && line[m.index + tok.length] === "(") cls = "tok-fn";
    out += cls ? `<span class="${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok);
    last = m.index + tok.length;
  }
  return out + escapeHtml(line.slice(last));
}

let renderQueued = false;
function renderEditor() {
  // Wait for the next screen refresh, so fast typing stays smooth.
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const lines = els.code.value.split("\n");
    const lang = els.language.value;
    els.highlight.innerHTML = lines
      .map((line, i) => `<span class="ln" data-line="${i + 1}">${colourLine(line, lang) || " "}</span>`)
      .join("");
    els.gutter.textContent = lines.map((_, i) => i + 1).join("\n");
    els.charCount.textContent = `${els.code.value.length.toLocaleString()} / 50,000 characters`;
    els.charCount.style.color = els.code.value.length > MAX_CHARS ? "var(--high)" : "";
    syncScroll();
  });
}

function syncScroll() {
  els.highlight.scrollTop = els.code.scrollTop;
  els.highlight.scrollLeft = els.code.scrollLeft;
  els.gutter.scrollTop = els.code.scrollTop;
}

function setCode(text) {
  els.code.value = text;
  els.code.scrollTop = 0;
  renderEditor();
}

els.code.addEventListener("input", renderEditor);
els.code.addEventListener("scroll", syncScroll);
els.language.addEventListener("change", renderEditor);

// Tab key inserts 4 spaces instead of jumping to the next button.
els.code.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    els.code.setRangeText("    ", els.code.selectionStart, els.code.selectionEnd, "end");
    renderEditor();
  }
  // Ctrl+Enter = scan
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runScan();
});

// Highlight one line in the editor and scroll to it.
function highlightLine(start, end = start) {
  els.highlight.querySelectorAll(".ln.hl").forEach((el) => el.classList.remove("hl"));
  for (let n = start; n <= end; n++) {
    els.highlight.querySelector(`.ln[data-line="${n}"]`)?.classList.add("hl");
  }
  const lineHeight = parseFloat(getComputedStyle(els.code).lineHeight) || 20.8;
  els.code.scrollTop = Math.max(0, (start - 4) * lineHeight);
  syncScroll();
}

/* =========================================================
   3. INPUT OPTIONS: sample, upload, drag & drop, clear
   ========================================================= */
els.sampleBtn.addEventListener("click", async () => {
  const res = await fetch(`/samples/${els.language.value}`);
  setCode(await res.text());
  toast("Sample loaded: intentionally insecure demo code");
});

els.clearBtn.addEventListener("click", () => { setCode(""); els.code.focus(); });

// Pick the language from the file name: .py -> python, .js -> javascript
function languageFromName(name) {
  if (/\.py$/i.test(name)) return "python";
  if (/\.(js|mjs|cjs)$/i.test(name)) return "javascript";
  return null;
}

async function loadFile(file) {
  const lang = languageFromName(file.name);
  if (!lang) return toast("Only .py and .js files are supported", true);
  const text = await file.text();
  if (text.length > MAX_CHARS) return toast("File is too big (max 50,000 characters)", true);
  els.language.value = lang;
  setCode(text);
  toast(`Loaded ${file.name}`);
}

els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files[0]) loadFile(els.fileInput.files[0]);
  els.fileInput.value = "";   // allow picking the same file again
});

["dragenter", "dragover"].forEach((type) => els.editor.addEventListener(type, (e) => {
  e.preventDefault();
  els.editor.classList.add("dragging");
}));
["dragleave", "drop"].forEach((type) => els.editor.addEventListener(type, (e) => {
  e.preventDefault();
  els.editor.classList.remove("dragging");
}));
els.editor.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

/* =========================================================
   4. SCANNING with step-by-step progress
   ========================================================= */
els.scanBtn.addEventListener("click", runScan);

function setStep(name, status) {
  els.progress.querySelector(`[data-step="${name}"]`).className = `step ${status}`;
}

async function runScan() {
  const code = els.code.value;
  if (!code.trim()) return setStatus("Paste some code first.", true);
  if (code.length > MAX_CHARS) return setStatus("Code is too long (max 50,000 characters).", true);
  if (els.scanBtn.disabled) return;

  const useAi = els.useAi.checked;
  els.scanBtn.disabled = true;
  els.scanBtn.textContent = "Scanning...";
  els.reportBtn.disabled = true;
  state.lastResult = null;
  els.findings.replaceChildren();
  els.scoreBox.hidden = true;
  els.filters.hidden = true;
  setStatus("");

  // Progress: Semgrep first. The server does both steps in one request,
  // so after ~6 seconds (Semgrep's usual time) we move the spinner to "AI".
  els.progress.hidden = false;
  setStep("semgrep", "active");
  setStep("ai", useAi ? "" : "skipped");
  setStep("done", "");
  const aiTimer = useAi ? setTimeout(() => { setStep("semgrep", "done"); setStep("ai", "active"); }, 6000) : null;

  try {
    const res = await fetch("/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language: els.language.value, use_ai: useAi }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Invalid request");

    clearTimeout(aiTimer);
    setStep("semgrep", "done");
    setStep("ai", data.ai.status === "ok" ? "done" : "skipped");
    setStep("done", "done");

    state.lastResult = data;
    showResults(data);
    saveHistory(code, els.language.value, data);
    els.reportBtn.disabled = false;
  } catch (err) {
    clearTimeout(aiTimer);
    els.progress.hidden = true;
    setStatus(`Scan failed: ${err.message}`, true);
  } finally {
    els.scanBtn.disabled = false;
    els.scanBtn.textContent = "Scan code";
  }
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

/* =========================================================
   5. RESULTS: score, filters, cards
   ========================================================= */
function showResults(data) {
  const ai = data.ai;
  const aiNote = ai.status === "ok" ? ` ${ai.message}` : ai.status === "error" ? ` AI skipped: ${ai.message}` : "";
  setStatus(`${data.total} issue${data.total === 1 ? "" : "s"} found.${aiNote}`, ai.status === "error");

  showScore(data);
  updateCounts(data.findings);
  els.filters.hidden = data.total === 0;
  renderCards();
}

// Score: start at 100 and subtract points per issue. Then turn it into a grade.
function computeScore(summary) {
  const score = Math.max(0, 100 - 15 * (summary.high || 0) - 7 * (summary.medium || 0) - 2 * (summary.low || 0));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade };
}

function showScore(data) {
  const { score, grade } = computeScore(data.summary);
  const color = score >= 75 ? "var(--fix)" : score >= 40 ? "var(--medium)" : "var(--high)";
  els.scoreRing.style.setProperty("--pct", score);
  els.scoreRing.style.setProperty("--ring-color", color);
  els.scoreGrade.textContent = grade;
  els.scoreNum.textContent = score;
  const s = data.summary;
  els.scoreText.textContent = `${s.high} high · ${s.medium} medium · ${s.low} low`;
  els.scoreBox.hidden = false;
}

function updateCounts(findings) {
  const count = (fn) => findings.filter(fn).length;
  $("count-all").textContent = findings.length;
  $("count-high").textContent = count((f) => f.severity === "high");
  $("count-medium").textContent = count((f) => f.severity === "medium");
  $("count-low").textContent = count((f) => f.severity === "low");
  $("count-ai").textContent = count((f) => f.source === "ai");
  $("count-semgrep").textContent = count((f) => f.source === "semgrep");
}

// Filter chips
document.querySelectorAll(".chip-btn").forEach((chip) => chip.addEventListener("click", () => {
  state.filter = chip.dataset.filter;
  document.querySelectorAll(".chip-btn").forEach((c) => c.classList.toggle("active", c === chip));
  renderCards();
}));

// Search box
els.search.addEventListener("input", () => { state.query = els.search.value.trim().toLowerCase(); renderCards(); });

// Expand / collapse all cards
els.expandAll.addEventListener("click", () => {
  state.allOpen = !state.allOpen;
  els.expandAll.textContent = state.allOpen ? "Collapse all" : "Expand all";
  els.findings.querySelectorAll(".card").forEach((c) => c.classList.toggle("open", state.allOpen));
});

function matchesFilters(f) {
  const filterOk = state.filter === "all" || f.severity === state.filter || f.source === state.filter;
  const text = `${f.title} ${f.explanation || ""} ${f.message} ${f.code} ${(f.cwe || []).join(" ")}`.toLowerCase();
  return filterOk && (!state.query || text.includes(state.query));
}

function renderCards() {
  const data = state.lastResult;
  if (!data) return;
  els.findings.replaceChildren();

  if (data.total === 0) {
    els.findings.append(emptyMessage("🎉", "No issues found. Nice and clean!"));
    return;
  }
  const visible = data.findings.filter(matchesFilters);
  if (!visible.length) {
    els.findings.append(emptyMessage("🔍", "No findings match this filter."));
    return;
  }
  visible.forEach((f, i) => {
    const card = makeCard(f);
    card.style.animationDelay = `${Math.min(i, 10) * 40}ms`;   // cards appear one after another
    els.findings.append(card);
  });
}

function emptyMessage(icon, text) {
  const box = makeEl("div", "empty");
  box.append(makeEl("span", "big", icon), document.createTextNode(text));
  return box;
}

// One finding card. Built with textContent only (never innerHTML), so user code can't run as HTML.
function makeCard(f) {
  const card = makeEl("article", `card ${f.severity}`);
  if (state.allOpen) card.classList.add("open");

  const head = makeEl("button", "card-head");
  head.type = "button";
  head.append(
    makeEl("span", "chev", "▸"),
    makeEl("span", `badge ${f.severity}`, f.severity),
    ...(f.source === "ai" ? [makeEl("span", "badge ai", "🤖 AI")] : []),
    makeEl("span", "card-title", f.title),
    makeEl("span", "card-line", f.line_start === f.line_end ? `line ${f.line_start}` : `lines ${f.line_start}-${f.line_end}`),
  );
  // Click: open/close the card AND highlight the line in the editor.
  head.addEventListener("click", () => {
    card.classList.toggle("open");
    els.findings.querySelectorAll(".card.selected").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    highlightLine(f.line_start, f.line_end);
  });

  const body = makeEl("div", "card-body");
  body.append(makeEl("p", "", f.explanation || f.message));
  body.append(labelRow("Problem code"), makeEl("pre", "", f.code));
  if (f.fix) {
    body.append(labelRow("Suggested fix", f.fix), makeEl("pre", "fix", f.fix));
  }
  const tags = makeEl("div", "tags");
  (f.cwe || []).forEach((cwe) => tags.append(makeEl("span", "tag", cwe.split(":")[0])));
  tags.append(makeEl("span", f.source === "ai" ? "tag ai" : "tag", f.source === "ai" ? "found by AI" : "semgrep"));
  body.append(tags);

  card.append(head, body);
  return card;
}

// A small label, plus a "Copy" button when there is text to copy.
function labelRow(text, copyText) {
  const row = makeEl("div", "label-row");
  row.append(makeEl("span", copyText ? "label fix" : "label", text));
  if (copyText) {
    const btn = makeEl("button", "btn ghost small", "📋 Copy fix");
    btn.type = "button";
    btn.addEventListener("click", async () => {
      await copyToClipboard(copyText);
      btn.textContent = "✅ Copied!";
      setTimeout(() => (btn.textContent = "📋 Copy fix"), 1500);
    });
    row.append(btn);
  }
  return row;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the clipboard API
    const temp = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
}

function makeEl(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/* =========================================================
   6. REPORTS: HTML, PDF (print) and JSON
   ========================================================= */
els.reportBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.reportMenu.hidden = !els.reportMenu.hidden;
});
document.addEventListener("click", () => (els.reportMenu.hidden = true));   // click outside closes menu

els.reportMenu.querySelectorAll("[data-format]").forEach((btn) => btn.addEventListener("click", async () => {
  els.reportMenu.hidden = true;
  if (!state.lastResult) return;
  try {
    const format = btn.dataset.format;
    if (format === "json") {
      const blob = new Blob([JSON.stringify(state.lastResult, null, 2)], { type: "application/json" });
      return downloadBlob(blob, `gatekeep-results-${stamp()}.json`);
    }
    const res = await fetch("/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.lastResult),
    });
    if (!res.ok) throw new Error(`server said ${res.status}`);
    const blob = await res.blob();
    if (format === "html") return downloadBlob(blob, `gatekeep-report-${stamp()}.html`);

    // PDF: open the report in a new tab and open the print dialog -> "Save as PDF"
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) return toast("Pop-up blocked: allow pop-ups to make a PDF", true);
    win.addEventListener("load", () => win.print());
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    toast(`Report failed: ${err.message}`, true);
  }
}));

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${filename}`);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/* =========================================================
   7. SCAN HISTORY (saved in this browser with localStorage)
   ========================================================= */
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory(code, language, result) {
  const item = { time: new Date().toISOString(), language, code, result };
  const list = [item, ...readHistory()].slice(0, 10);   // newest first, keep 10
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 3)));  // storage full: keep fewer
  }
}

function renderHistory() {
  const list = readHistory();
  els.historyList.replaceChildren();
  if (!list.length) {
    els.historyList.append(emptyMessage("🕘", "No scans yet."));
    return;
  }
  list.forEach((item) => {
    const { score, grade } = computeScore(item.result.summary);
    const firstLine = item.code.split("\n").find((l) => l.trim()) || "(empty)";
    const btn = makeEl("button", "history-item");
    btn.type = "button";
    btn.append(
      makeEl("div", "", `${grade} · ${score}/100 · ${item.result.total} issues`),
      makeEl("div", "meta", `${new Date(item.time).toLocaleString()} · ${item.language}`),
      makeEl("div", "meta", firstLine.slice(0, 60)),
    );
    btn.addEventListener("click", () => {
      els.language.value = item.language;
      setCode(item.code);
      state.lastResult = item.result;
      els.progress.hidden = true;
      showResults(item.result);
      els.reportBtn.disabled = false;
      els.drawer.hidden = true;
      toast("Old scan opened from history");
    });
    els.historyList.append(btn);
  });
}

els.historyBtn.addEventListener("click", () => { renderHistory(); els.drawer.hidden = false; });
els.historyClose.addEventListener("click", () => (els.drawer.hidden = true));
els.historyClear.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  toast("History cleared");
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") els.drawer.hidden = true; });

/* =========================================================
   8. TOAST: small pop-up message at the bottom
   ========================================================= */
let toastTimer;
function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.color = isError ? "var(--high)" : "";
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2500);
}

renderEditor();
