// GateKeep frontend: sends code to the /scan API and shows the findings.

// 1. Grab the page elements we need to work with.
const codeBox = document.getElementById("code");
const languageSelect = document.getElementById("language");
const scanBtn = document.getElementById("scan-btn");
const sampleBtn = document.getElementById("sample-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const findingsEl = document.getElementById("findings");
const charCount = document.getElementById("char-count");
const useAiBox = document.getElementById("use-ai");
const reportBtn = document.getElementById("report-btn");

// Remembers the result of the last scan, so the report button can use it.
let lastResult = null;

const MAX_CHARS = 50000;

// 2. Live character counter under the text box.
codeBox.addEventListener("input", () => {
  charCount.textContent = `${codeBox.value.length.toLocaleString()} / 50,000 characters`;
});

// 3. "Load sample" fills the box with intentionally insecure code.
sampleBtn.addEventListener("click", async () => {
  const lang = languageSelect.value;
  const res = await fetch(`/samples/${lang}`);
  codeBox.value = await res.text();
  codeBox.dispatchEvent(new Event("input"));
});

// 4. Scan button: send code to the backend and show results.
scanBtn.addEventListener("click", async () => {
  const code = codeBox.value;
  if (!code.trim()) return setStatus("Paste some code first.", true);
  if (code.length > MAX_CHARS) return setStatus("Code is too long (max 50,000 characters).", true);

  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning...";
  reportBtn.disabled = true;  // no report until the new scan finishes
  lastResult = null;
  summaryEl.replaceChildren();
  findingsEl.replaceChildren();
  setStatus(useAiBox.checked
    ? "Scanning with Semgrep, then asking the AI reviewer... (can take 20-40 seconds)"
    : "Scanning with Semgrep... (takes a few seconds)");

  try {
    const res = await fetch("/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, language: languageSelect.value, use_ai: useAiBox.checked }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Invalid request");
    showResults(data);
    lastResult = data;
    reportBtn.disabled = false;
  } catch (err) {
    setStatus(`Scan failed: ${err.message}`, true);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "Scan code";
  }
});

// 5. "Download report": send the last result to /report and save the file it returns.
reportBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  reportBtn.disabled = true;
  try {
    const res = await fetch("/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastResult),
    });
    if (!res.ok) throw new Error(`server said ${res.status}`);

    // A Blob is a chunk of file data held in the browser's memory.
    const blob = await res.blob();
    // Read the file name the server suggested in the Content-Disposition header.
    const header = res.headers.get("Content-Disposition") || "";
    const filename = (header.match(/filename="(.+?)"/) || [])[1] || "gatekeep-report.html";

    // Make a temporary link to the Blob, "click" it to start the download, then clean up.
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus(`Report download failed: ${err.message}`, true);
  } finally {
    reportBtn.disabled = false;
  }
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function showResults(data) {
  const aiNote = data.ai.status === "ok" ? ` ${data.ai.message}`
    : data.ai.status === "error" ? ` (AI skipped: ${data.ai.message})` : "";
  if (data.total === 0) {
    setStatus(`No issues found. 🎉${aiNote}`, data.ai.status === "error");
    return;
  }
  setStatus(`${data.total} issue${data.total === 1 ? "" : "s"} found.${aiNote}`, data.ai.status === "error");

  for (const level of ["high", "medium", "low"]) {
    if (data.summary[level]) summaryEl.append(makeEl("span", `badge ${level}`, `${data.summary[level]} ${level}`));
  }
  for (const finding of data.findings) findingsEl.append(makeCard(finding));
}

// Build one finding card. We only use textContent (never innerHTML) so that
// code from the user can never run as HTML in the page (that would be XSS!).
function makeCard(f) {
  const card = makeEl("article", `card ${f.severity}`);

  const head = makeEl("div", "card-head");
  head.append(
    makeEl("span", `badge ${f.severity}`, f.severity),
    makeEl("span", "card-title", f.title),
    makeEl("span", "card-line", f.line_start === f.line_end ? `line ${f.line_start}` : `lines ${f.line_start}-${f.line_end}`),
  );
  // Prefer the AI's simple explanation; fall back to Semgrep's technical message.
  card.append(head, makeEl("p", "", f.explanation || f.message), makeEl("pre", "", f.code));

  if (f.fix) {
    card.append(makeEl("div", "fix-label", "Suggested fix"), makeEl("pre", "fix", f.fix));
  }

  const tags = makeEl("div", "tags");
  for (const cwe of f.cwe) tags.append(makeEl("span", "tag", cwe.split(":")[0]));
  tags.append(makeEl("span", `tag source-${f.source}`, f.source === "ai" ? "found by AI" : "semgrep"));
  card.append(tags);
  return card;
}

function makeEl(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
