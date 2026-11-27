// Builds deploy/ISTA_Presensi_Deployment_Guide.pdf from DEPLOY.md (single source of truth).
//   node deploy/guide/build-pdf.mjs
// Converts the Markdown to styled HTML, then prints it with a headless Chromium browser (Edge or Chrome).
// No packages needed. Set BROWSER=/path/to/chrome to choose the browser.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const md = readFileSync(path.join(root, "DEPLOY.md"), "utf8").replace(/\r\n/g, "\n");
const logo = readFileSync(path.join(root, "frontend", "public", "logo-ista.png")).toString("base64");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- Markdown → HTML (the subset DEPLOY.md uses) -------------------------------------------------
const lines = md.split("\n");
const out = [];
const toc = [];
let title = "";
let i = 0;
let para = [];
const flush = () => {
  if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
  para = [];
};
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith("```")) {
    flush();
    const code = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
    i++;
    const diagram = code.some((l) => /[│┌└├▶▼]/.test(l));
    out.push(`<pre class="${diagram ? "diagram" : ""}"><code>${esc(code.join("\n"))}</code></pre>`);
    continue;
  }
  const h = /^(#{1,3}) (.*)$/.exec(line);
  if (h) {
    flush();
    const level = h[1].length;
    if (level === 1) title = h[2];
    else {
      const id = slug(h[2]);
      if (level === 2) toc.push({ id, text: h[2] });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
    }
    i++;
    continue;
  }
  if (line.startsWith("|")) {
    flush();
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
    const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const [head, , ...body] = rows;
    out.push(
      `<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
    );
    continue;
  }
  const li = /^(\s*)(- |\d+\. )(.*)$/.exec(line);
  if (li) {
    flush();
    const ordered = /\d/.test(li[2]);
    const items = [];
    while (i < lines.length) {
      const m = /^(\s*)(- |\d+\. )(.*)$/.exec(lines[i]);
      if (!m || /\d/.test(m[2]) !== ordered) break;
      items.push(m[3]);
      i++;
    }
    const tag = ordered ? "ol" : "ul";
    out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
    continue;
  }
  if (!line.trim()) {
    flush();
    i++;
    continue;
  }
  para.push(line.trim());
  i++;
}
flush();

// ---- Page -------------------------------------------------------------------------------------------
const today = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date());
const [mainTitle, subTitle] = title.split(" — ");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
:root { color-scheme: light; }
html, body { background: #fff; }
body { font-family: "Segoe UI", "DejaVu Sans", Arial, sans-serif; font-size: 10.3pt; line-height: 1.55; color: #233a2f; margin: 0; }
h2 { font-size: 15pt; color: #143f32; margin: 0 0 8px; padding: 6px 0 6px 12px; border-left: 4px solid #c9a94f; background: #f3f6f1; break-after: avoid; page-break-after: avoid; }
h2:not(:first-of-type) { margin-top: 22px; }
h3 { font-size: 11.5pt; color: #1e603a; margin: 16px 0 6px; break-after: avoid; }
p { margin: 6px 0; }
strong { color: #143f32; }
code { font-family: Consolas, "DejaVu Sans Mono", monospace; font-size: 9pt; background: #eef2ec; border: 1px solid #dde5de; border-radius: 3px; padding: 0 3px; }
pre { background: #0f2a22; color: #e3efe6; border-radius: 6px; padding: 9px 12px; margin: 8px 0; white-space: pre-wrap; word-break: break-all; break-inside: avoid; }
pre code { background: none; border: 0; padding: 0; color: inherit; font-size: 8.6pt; line-height: 1.5; }
pre.diagram { background: #f7f9f4; color: #1e3d30; border: 1px solid #dde5de; white-space: pre; word-break: normal; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 10px; font-size: 9.2pt; break-inside: auto; }
tr { break-inside: avoid; }
th { background: #143f32; color: #fff; text-align: left; font-weight: 600; padding: 5px 7px; }
td { border-bottom: 1px solid #dfe6df; padding: 5px 7px; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f8faf6; }
td code { word-break: break-all; }
ul, ol { margin: 6px 0; padding-left: 20px; }
li { margin: 3px 0; }
.cover { height: 255mm; display: flex; flex-direction: column; page-break-after: always; }
.band { background: linear-gradient(135deg, #194d36, #0e3028); color: #fff; border-radius: 10px; padding: 34px 32px; display: flex; gap: 22px; align-items: center; }
.band img { width: 92px; height: 92px; background: #fff; border-radius: 50%; padding: 5px; }
.band .k { font-size: 9pt; letter-spacing: 2px; color: #d8bd69; }
.band h1 { font-size: 26pt; margin: 6px 0 4px; line-height: 1.15; }
.band .s { font-size: 12pt; color: #cfe0d3; }
.meta { margin: 18px 4px; color: #5f6f66; font-size: 9.5pt; }
.toc { margin-top: 8px; border: 1px solid #dfe6df; border-radius: 8px; padding: 14px 20px; }
.toc b { color: #143f32; font-size: 11pt; }
.toc ol { columns: 2; column-gap: 28px; margin: 10px 0 0; padding-left: 0; list-style: none; }
.toc li { margin: 3px 0; break-inside: avoid; }
.toc a { color: #233a2f; text-decoration: none; }
.foot { margin-top: auto; font-size: 8.5pt; color: #7b877f; border-top: 1px solid #dfe6df; padding-top: 8px; }
</style></head><body>
<section class="cover">
  <div class="band"><img src="data:image/png;base64,${logo}" alt="">
    <div><div class="k">INSTITUT SAINS DAN TEKNOLOGI AL-KAMAL</div><h1>${esc(mainTitle)}</h1><div class="s">${esc(subTitle ?? "")}</div></div></div>
  <div class="meta">Version of ${today} · Generated from DEPLOY.md in the repository</div>
  <div class="toc"><b>Contents</b><ol>${toc.map((t) => `<li><a href="#${t.id}">${inline(t.text)}</a></li>`).join("")}</ol></div>
  <div class="foot">Confidential — for the campus IT and database administrators. Never write real passwords or secrets into copies of this document.</div>
</section>
<main>${out.join("\n")}</main>
</body></html>`;

const htmlFile = path.join(here, "guide.html");
writeFileSync(htmlFile, html);

const candidates = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) throw new Error("No Chrome/Edge found; set BROWSER=/path/to/chrome");
const pdf = path.join(root, "deploy", "ISTA_Presensi_Deployment_Guide.pdf");
execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(htmlFile).href], { stdio: "ignore" });
console.log(`wrote ${path.relative(root, pdf)}`);
