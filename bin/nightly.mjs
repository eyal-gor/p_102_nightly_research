#!/usr/bin/env node
// nightly-research — a nightly equity-research agent fleet that runs on your
// own compute via cerver. One agent per ticker, ~$0 marginal on your sub.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../lib/cerver.mjs";
import { researchPrompt } from "../lib/prompt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WATCHLIST = join(ROOT, "watchlist.json");
const PROFILES = join(ROOT, "profiles");
const DIGESTS = join(ROOT, "digests");
const WEB = join(ROOT, "web");
const KEYFILE = join(ROOT, ".cerver-key");
// An app-bound cerver key (env NIGHTLY_CERVER_KEY or gitignored .cerver-key) so
// the embedded chat runs on YOUR account under the "nightly-research" app — its
// sessions then show in your cerver dashboard. Absent → widget falls back to anon.
function cerverKey() {
  if (process.env.NIGHTLY_CERVER_KEY) return process.env.NIGHTLY_CERVER_KEY.trim();
  try { return readFileSync(KEYFILE, "utf8").trim(); } catch { return ""; }
}
function pkAttr() { const k = cerverKey(); return k ? `pk="${k}" ` : ""; }

const CLI = process.env.NIGHTLY_CLI || "claude";
const COMPUTE = process.env.NIGHTLY_COMPUTE || "";
const CONCURRENCY = Math.max(1, Number(process.env.NIGHTLY_CONCURRENCY || 4));

// ── state ──────────────────────────────────────────────────────────────────
function loadWatch() {
  if (!existsSync(WATCHLIST)) return [];
  try { return JSON.parse(readFileSync(WATCHLIST, "utf8")).tickers || []; } catch { return []; }
}
function saveWatch(t) { writeFileSync(WATCHLIST, JSON.stringify({ tickers: t }, null, 2) + "\n"); }
function ensureDirs() { for (const d of [PROFILES, DIGESTS]) if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function profilePath(t) { return join(PROFILES, t.toUpperCase() + ".md"); }
function prevProfile(t) { const p = profilePath(t); return existsSync(p) ? readFileSync(p, "utf8") : ""; }
function parseScore(md) { const m = md && md.match(/\*\*Score:\*\*\s*(\d+)\s*\/\s*10/); return m ? Number(m[1]) : null; }
// Models sometimes prepend a conversational line or wrap in code fences despite
// "return ONLY markdown." Strip anything before the first "# TICKER" heading.
function clean(md) {
  md = (md || "").replace(/```(?:markdown|md)?/gi, "").replace(/```/g, "");
  const h = md.search(/^#\s+[A-Za-z0-9.]/m);
  return (h > 0 ? md.slice(h) : md).trim();
}
function isoDate() { return new Date().toISOString().slice(0, 10); }
function deltaTag(d) { return d == null ? "" : d > 0 ? ` ▲+${d}` : d < 0 ? ` ▼${d}` : " ▬"; }

// ── concurrency pool ─────────────────────────────────────────────────────────
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// ── research ─────────────────────────────────────────────────────────────────
async function researchOne(ticker) {
  process.stdout.write(`· ${ticker} … `);
  const prev = prevProfile(ticker);
  const prevScore = parseScore(prev);
  try {
    const md = clean(await runAgent(researchPrompt(ticker, prev, isoDate()), { cli: CLI, compute: COMPUTE }));
    writeFileSync(profilePath(ticker), md + "\n");
    const score = parseScore(md);
    const delta = prevScore != null && score != null ? score - prevScore : null;
    console.log(`${score != null ? score + "/10" : "?"}${deltaTag(delta)}`);
    return { ticker, score, prevScore, delta, ok: true };
  } catch (e) {
    console.log(`✗ failed (${e.message.split("\n")[0]})`);
    return { ticker, score: null, delta: null, ok: false };
  }
}

function writeDigest(results) {
  ensureDirs();
  const date = isoDate();
  const ok = results.filter((r) => r.ok && r.score != null);
  const byScore = ok.slice().sort((a, b) => b.score - a.score);
  const risers = ok.filter((r) => r.delta != null && r.delta > 0).sort((a, b) => b.delta - a.delta);

  let md = `# Nightly research digest — ${date}\n\n`;
  md += `Researched ${results.length} ticker(s) · ${risers.length} with a rising score · run on your own compute via cerver.\n\n`;
  if (risers.length) {
    md += `## ▲ Score rising (the signal that matters)\n` +
      risers.map((r) => `- **${r.ticker}** ${r.prevScore}/10 → ${r.score}/10 — [profile](../profiles/${r.ticker}.md)`).join("\n") + "\n\n";
  }
  md += `## Top by score\n` +
    byScore.map((r) => `- **${r.ticker}** — ${r.score}/10${deltaTag(r.delta)}`).join("\n") + "\n";
  const failed = results.filter((r) => !r.ok);
  if (failed.length) md += `\n## Did not complete\n` + failed.map((r) => `- ${r.ticker}`).join("\n") + "\n";

  writeFileSync(join(DIGESTS, date + ".md"), md);
  writeIndex(byScore, date);
  console.log(`\nDigest → ${join(DIGESTS, date + ".md")}`);
}

// Master log mirroring invest-watch's index.md — one row per ticker, by score.
function writeIndex(byScore, date) {
  let md = `# Watchlist index — updated ${date}\n\n`;
  md += `| Ticker | Score | Last move | Reviewed |\n|---|---|---|---|\n`;
  md += byScore.map((r) =>
    `| ${r.ticker} | ${r.score}/10 | ${r.delta == null ? "—" : r.delta > 0 ? "▲+" + r.delta : r.delta < 0 ? "▼" + r.delta : "▬"} | ${date} |`
  ).join("\n") + "\n";
  writeFileSync(join(ROOT, "index.md"), md);
}

// ── commands ─────────────────────────────────────────────────────────────────
async function cmdRun(args) {
  ensureDirs();
  const tickers = (args.length ? args : loadWatch()).map((s) => s.toUpperCase());
  if (!tickers.length) { console.error("No tickers. Try: nightly add AAPL NVDA"); process.exit(1); }
  console.log(`Researching ${tickers.length} ticker(s) via cerver (${CLI}${COMPUTE ? " on " + COMPUTE : ""}), ${CONCURRENCY} at a time:\n`);
  const results = await pool(tickers, CONCURRENCY, researchOne);
  writeDigest(results);
}
function cmdAdd(args) {
  const t = loadWatch();
  saveWatch(t.concat(args.map((s) => s.toUpperCase()).filter((s) => !t.includes(s))));
  console.log(`Watchlist: ${loadWatch().join(", ") || "(empty)"}`);
}
function cmdRm(args) {
  const rm = new Set(args.map((s) => s.toUpperCase()));
  saveWatch(loadWatch().filter((t) => !rm.has(t)));
  console.log(`Watchlist: ${loadWatch().join(", ") || "(empty)"}`);
}
function cmdList() { const t = loadWatch(); console.log(t.length ? t.join("\n") : "(empty — try: nightly add AAPL)"); }
function cmdDigest() {
  if (!existsSync(DIGESTS)) return console.log("No digests yet. Run: nightly run");
  const files = readdirSync(DIGESTS).filter((f) => f.endsWith(".md")).sort();
  if (!files.length) return console.log("No digests yet. Run: nightly run");
  console.log(readFileSync(join(DIGESTS, files[files.length - 1]), "utf8"));
}
// Build a compact research context (latest digest + per-ticker score) to prime
// the embedded cerver-chat so you can ask questions about your own watchlist.
function researchContext() {
  let ctx = "";
  try {
    const ds = readdirSync(DIGESTS).filter((f) => f.endsWith(".md")).sort();
    if (ds.length) ctx += "LATEST DIGEST:\n" + readFileSync(join(DIGESTS, ds[ds.length - 1]), "utf8") + "\n\n";
  } catch { /* none yet */ }
  try {
    ctx += "PROFILES:\n";
    for (const f of readdirSync(PROFILES).filter((f) => f.endsWith(".md"))) {
      const md = readFileSync(join(PROFILES, f), "utf8");
      const score = (md.match(/\*\*Score:\*\*[^\n]*/) || [""])[0];
      ctx += `- ${f.replace(".md", "")} — ${score.replace(/\*\*/g, "")}\n`;
    }
  } catch { /* none yet */ }
  return ctx.slice(0, 6000);
}

// `chat` — open a browser chat about your watchlist, powered by the embedded
// cerver-chat widget (anonymous session against the cerver gateway).
function cmdChat() {
  if (!existsSync(WEB)) mkdirSync(WEB, { recursive: true });
  const sys =
    "You are a sharp, skeptical investing-research assistant inside the user's nightly-research watchlist tool. " +
    "Answer questions about the user's tracked companies using the research context below. Be concise, honest about " +
    "uncertainty, and never give financial advice.\n\nRESEARCH CONTEXT:\n" + researchContext();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Set NIGHTLY_CERVER_KEY to the nightly-research app key to run the chat under
  // your own account (sessions show in your dashboard). Unset → anonymous trial.
  const pk = process.env.NIGHTLY_CERVER_KEY ? ' pk="' + process.env.NIGHTLY_CERVER_KEY + '"' : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>nightly-research — chat</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>body{margin:0;background:#eae5d7;font-family:'IBM Plex Mono',monospace;color:#1b1a16}
.page{max-width:680px;margin:0 auto;padding:40px 20px}h1{font-size:22px;margin:0 0 6px}
p{color:#6c685c;font-size:13px;line-height:1.6}.embed{margin:22px 0;box-shadow:0 14px 40px rgba(27,26,22,.14)}</style>
</head><body><div class="page">
<h1>Chat with your watchlist</h1>
<p>Ask about any company you're tracking. Powered by <a href="https://cerver.ai">cerver</a> — run local or remote agents.</p>
<div class="embed"><cerver-chat${pk} model="claude-haiku-4-5-20251001" system-prompt="${esc(sys)}"></cerver-chat></div>
</div><script src="./cerver-chat.js"></script></body></html>`;
  const out = join(WEB, "report.html");
  writeFileSync(out, html);
  console.log(`Chat page → ${out}`);
  if (process.platform === "darwin") execFile("open", [out], () => {});
  else console.log("Open it in your browser.");
}

// `dashboard` — a static web view of the whole watchlist: scored table, the
// latest digest, a profile reader, and the cerver chat docked. Built from the
// markdown files; no server.
function parseProfile(md) {
  const ticker = (md.match(/^#\s*([A-Z0-9.]+)/m) || [])[1] || "?";
  const name = (md.match(/^#\s*[A-Z0-9.]+\s*—\s*(.+)$/m) || [])[1] || "";
  const sector = (md.match(/\*\*Sector:\*\*\s*(.+)/) || [])[1] || "";
  const sm = md.match(/\*\*Score:\*\*\s*(\d+)\/10\s*—?\s*(.*)/);
  return { ticker, name, sector, score: sm ? Number(sm[1]) : null, reason: sm ? sm[2] : "", md };
}
function cmdDashboard() {
  if (!existsSync(WEB)) mkdirSync(WEB, { recursive: true });
  const profs = [];
  try { for (const f of readdirSync(PROFILES).filter((f) => f.endsWith(".md"))) profs.push(parseProfile(readFileSync(join(PROFILES, f), "utf8"))); } catch { /* none */ }
  profs.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  let digest = "";
  try { const ds = readdirSync(DIGESTS).filter((f) => f.endsWith(".md")).sort(); if (ds.length) digest = readFileSync(join(DIGESTS, ds[ds.length - 1]), "utf8"); } catch { /* none */ }
  const sys = "You are a sharp, skeptical investing-research assistant inside the user's nightly-research watchlist. " +
    "Answer using the research context below. Concise, honest about uncertainty, never financial advice.\n\nCONTEXT:\n" + researchContext();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pk = process.env.NIGHTLY_CERVER_KEY ? ' pk="' + process.env.NIGHTLY_CERVER_KEY + '"' : "";
  const DATA = JSON.stringify({ profs, digest }).replace(/</g, "\\u003c");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>nightly-research</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--paper:#f4f1e8;--paper2:#eae5d7;--ink:#1b1a16;--line:#d9d3c2;--muted:#6c685c;--mag:#d2588f;--grn:#4f9d74;--mono:'IBM Plex Mono',monospace}
*{box-sizing:border-box}body{margin:0;background:var(--paper2);color:var(--ink);font-family:Inter,sans-serif}
.top{padding:14px 22px;border-bottom:1px solid var(--line);background:var(--paper);font-family:var(--mono);font-weight:600;display:flex;justify-content:space-between;align-items:center}
.top .sub{color:var(--muted);font-weight:400;font-size:12px}
.grid{display:grid;grid-template-columns:340px 1fr;min-height:calc(100vh - 51px)}
.side{border-right:1px solid var(--line);background:var(--paper);overflow-y:auto}
.row{display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line);cursor:pointer}
.row:hover{background:var(--paper2)}.row.on{background:var(--ink);color:var(--paper)}
.row .tk{font-family:var(--mono);font-weight:600;width:62px}
.row .sc{font-family:var(--mono);font-weight:600;margin-left:auto}
.row .se{font-size:11px;color:var(--muted);width:100%;flex-basis:100%;margin-left:72px;margin-top:-4px}
.row.on .se{color:var(--paper2)}
.main{padding:26px 30px;overflow-y:auto;max-height:calc(100vh - 51px)}
.prof h1{font-size:24px;margin:0 0 4px}.prof h3{font-size:13px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:20px 0 6px}
.prof p{line-height:1.6;margin:6px 0}.prof strong{color:var(--ink)}
.score{font-family:var(--mono);font-size:13px;color:var(--muted);margin:8px 0 0}
.chatwrap{position:fixed;bottom:0;right:0;width:360px;height:440px;box-shadow:0 -10px 40px rgba(27,26,22,.18)}
@media(max-width:820px){.grid{grid-template-columns:1fr}.chatwrap{display:none}}
</style></head><body>
<div class="top"><span>nightly-research <span class="sub">· your watchlist, scored nightly</span></span><span class="sub">powered by cerver</span></div>
<div class="grid"><aside class="side" id="side"></aside><main class="main" id="main"></main></div>
<div class="chatwrap"><cerver-chat${pk} model="claude-haiku-4-5-20251001" system-prompt="${esc(sys)}"></cerver-chat></div>
<script>
const D=${DATA};
function md2html(md){return md
 .replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/^#\\s+(.*)$/gm,'<h1>$1</h1>').replace(/^###\\s+(.*)$/gm,'<h3>$1</h3>').replace(/^##\\s+(.*)$/gm,'<h3>$1</h3>')
 .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>')
 .replace(/^- (.*)$/gm,'• $1')
 .split(/\\n{2,}/).map(b=>/<h[13]>/.test(b)?b:'<p>'+b.replace(/\\n/g,'<br>')+'</p>').join('');}
function pick(i){document.querySelectorAll('.row').forEach((r,j)=>r.classList.toggle('on',j===i));
 const p=D.profs[i];document.getElementById('main').innerHTML='<div class="prof">'+md2html(p.md)+'</div>';}
const side=document.getElementById('side');
D.profs.forEach((p,i)=>{const d=document.createElement('div');d.className='row';
 d.innerHTML='<span class="tk">'+p.ticker+'</span><span class="sc">'+(p.score!=null?p.score+'/10':'—')+'</span><span class="se">'+(p.sector||'')+'</span>';
 d.onclick=()=>pick(i);side.appendChild(d);});
if(D.profs.length)pick(0);else document.getElementById('main').innerHTML='<p style="color:#6c685c">No profiles yet. Run <code>nightly run</code> first.</p>';
// first-run guided tour
(function(){
 if(localStorage.getItem('nr_tour_done'))return;
 const steps=[
  {sel:'#side',title:'Your watchlist',body:'Every company you track, scored 1 to 10 every night. Highest score on top — where opportunities surface over time.'},
  {sel:'.row',title:'Read the research',body:'Click any company to read its full profile, risks, and dated history.'},
  {sel:'.chatwrap',title:'Ask your watchlist',body:'Chat with your own research — answered on your own compute, via cerver. Ask: which looks best and why?'}
 ];
 const ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;background:rgba(27,26,22,.55);z-index:10000';
 const card=document.createElement('div');card.style.cssText='position:fixed;z-index:10002;max-width:300px;background:#f4f1e8;border:1px solid #1b1a16;padding:16px 18px;box-shadow:0 16px 50px rgba(0,0,0,.3);font-family:Inter,sans-serif';
 document.body.appendChild(ov);document.body.appendChild(card);
 let i=0,prev=null;
 function show(){const s=steps[i];const el=document.querySelector(s.sel);
  if(prev){prev.style.zIndex='';prev.style.position=prev.dataset._p||'';}
  if(el){el.dataset._p=el.style.position;if(getComputedStyle(el).position==='static')el.style.position='relative';el.style.zIndex='10001';prev=el;}
  card.innerHTML='<div style="font-family:'+'\\'IBM Plex Mono\\',monospace;font-weight:600;margin-bottom:6px">'+s.title+'</div><div style="font-size:13px;line-height:1.5;color:#3a382f">'+s.body+'</div><div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:#6c685c">'+(i+1)+'/'+steps.length+'</span><span><button id="tsk" style="background:none;border:0;color:#6c685c;cursor:pointer;font:inherit;font-size:12px;margin-right:10px">Skip</button><button id="tnx" style="background:#1b1a16;color:#f4f1e8;border:0;padding:7px 14px;cursor:pointer;font:inherit;font-size:12px">'+(i===steps.length-1?'Done':'Next')+'</button></span></div>';
  const r=el?el.getBoundingClientRect():{left:innerWidth/2-150,bottom:120,top:100,right:0};
  let top=Math.min(r.bottom+10,innerHeight-190),left=Math.min(Math.max(10,r.left),innerWidth-320);
  if(s.sel==='.chatwrap'){top=Math.max(10,r.top-160);left=r.left-12;}
  card.style.top=top+'px';card.style.left=left+'px';
  card.querySelector('#tnx').onclick=function(){i++;if(i>=steps.length)end();else show();};
  card.querySelector('#tsk').onclick=end;
 }
 function end(){localStorage.setItem('nr_tour_done','1');if(prev){prev.style.zIndex='';prev.style.position=prev.dataset._p||'';}ov.remove();card.remove();}
 setTimeout(show,450);
})();
</script>
<script src="./cerver-chat.js"></script>
</body></html>`;
  const out = join(WEB, "index.html");
  writeFileSync(out, html);
  console.log(`Dashboard → ${out}`);
  if (process.platform === "darwin") execFile("open", [out], () => {});
  else console.log("Open it in your browser.");
}

function help() {
  console.log(`nightly-research — a nightly equity-research agent fleet on your own compute (via cerver)

usage:
  nightly run [TICKER...]   research the watchlist (or given tickers); write profiles + digest
  nightly add TICKER...     add to the watchlist
  nightly rm  TICKER...     remove from the watchlist
  nightly list              show the watchlist
  nightly digest            print the latest digest
  nightly chat              chat with your watchlist in the browser (powered by cerver)
  nightly dashboard         open the scored watchlist dashboard (with a guided tour)

env:
  NIGHTLY_CLI=claude|codex|grok   harness that runs the research (default: claude)
  NIGHTLY_COMPUTE=<name>          cerver compute to run on (default: cerver picks)
  NIGHTLY_CONCURRENCY=4           parallel agents

Requires cerver:  curl -fsSL https://cerver.ai/install.sh | bash`);
}

const [cmd, ...args] = process.argv.slice(2);
const table = { run: cmdRun, add: cmdAdd, rm: cmdRm, list: cmdList, digest: cmdDigest, chat: cmdChat, dashboard: cmdDashboard, help };
Promise.resolve((table[cmd] || help)(args)).catch((e) => { console.error("Error:", e.message); process.exit(1); });
