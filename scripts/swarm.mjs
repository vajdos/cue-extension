#!/usr/bin/env node
//
// Cue continuous-improvement swarm — deterministic orchestrator.
//
// Runs one agent per invocation, rotating through a pool of small,
// privacy-respecting checks. Each agent reads the canonical repos and
// writes a dated markdown report to:
//
//   G:\My Drive\Cue\03 - Agent Reports\continuous\YYYY-MM-DD\HH-MM-<slug>.md
//
// Plus appends a one-line summary to a ledger file:
//
//   G:\My Drive\Cue\03 - Agent Reports\continuous\_ledger.md
//
// Designed to be fired by Windows Task Scheduler every 15 minutes so the
// swarm progresses continuously without requiring Claude Code or an
// Anthropic API key. Each agent costs ~0 — they're file-system + grep,
// not LLM calls.
//
// To run once manually:
//   node C:\Cue\scripts\swarm.mjs
// To run a specific agent:
//   node C:\Cue\scripts\swarm.mjs --agent=privacy-grep
//
// Authority: report-only. No git commits, no code edits, no pushes,
// no external network calls. Reports are markdown for Nathan's review.
//
// Brand voice in reports: calm, declarative, technical. Cite file:line.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LOCAL_ROOT = 'C:\\Cue';
const DRIVE_ROOT = 'G:\\My Drive\\Cue';
const REPORTS_ROOT = path.join(DRIVE_ROOT, '03 - Agent Reports', 'continuous');
const LEDGER_PATH = path.join(REPORTS_ROOT, '_ledger.md');
const STATE_DIR = path.join(LOCAL_ROOT, 'scripts', '_swarm-state');

const MVP = path.join(LOCAL_ROOT, 'cue-mvp');
const PWA = path.join(LOCAL_ROOT, 'cue-pwa-current');

// -- Agent rotation order. Each tick picks the next agent in the list
//    (state stored in _swarm-state/last-agent.txt). Add new agents to
//    the end; the rotation will pick them up automatically next cycle.
const AGENTS = [
  'privacy-grep',
  'dead-file-finder',
  'stale-version-comment',
  'todo-collector',
  'manifest-permission-auditor',
  'bundle-size-tracker',
  'threshold-snapshot',
  'changelog-gap-detector',
  'secret-scanner',
  'pre-commit-hook-health',
  'link-validator',
  'api-handler-uniformity',
  'html-accessibility',
];

// ===========================================================================
// Utilities
// ===========================================================================

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function nowParts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    yyyymmdd: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hhmm: `${pad(d.getHours())}-${pad(d.getMinutes())}`,
    iso: d.toISOString(),
  };
}

function pickNextAgent(forced) {
  if (forced && AGENTS.includes(forced)) return forced;
  ensureDir(STATE_DIR);
  const ptr = path.join(STATE_DIR, 'last-agent.txt');
  let last = '';
  try { last = fs.readFileSync(ptr, 'utf8').trim(); } catch (e) { last = ''; }
  const i = AGENTS.indexOf(last);
  const next = AGENTS[(i + 1) % AGENTS.length];
  fs.writeFileSync(ptr, next, 'utf8');
  return next;
}

function walkFiles(root, predicate) {
  const out = [];
  function recur(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['.git', 'node_modules', '.vercel', 'dist', 'dist-prod', '_archive_cue-mvp-v1.1.11', '.claude', '.cursor', '_swarm-state'].includes(e.name)) continue;
        recur(p);
      } else if (e.isFile() && predicate(p)) {
        out.push(p);
      }
    }
  }
  recur(root);
  return out;
}

function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

function fileSize(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }

function writeReport(slug, body) {
  const { yyyymmdd, hhmm, iso } = nowParts();
  const dir = path.join(REPORTS_ROOT, yyyymmdd);
  ensureDir(dir);
  const file = path.join(dir, `${hhmm}-${slug}.md`);
  const header = `# ${slug}\n\n_Generated: ${iso}_\n\n`;
  fs.writeFileSync(file, header + body, 'utf8');
  return file;
}

function appendLedger(slug, summary, reportPath) {
  ensureDir(REPORTS_ROOT);
  const { iso } = nowParts();
  const line = `- ${iso} \`${slug}\` — ${summary} → [${path.basename(reportPath)}](${path.relative(REPORTS_ROOT, reportPath).replace(/\\/g, '/')})\n`;
  if (!fs.existsSync(LEDGER_PATH)) {
    fs.writeFileSync(LEDGER_PATH, `# Cue continuous-improvement ledger\n\nOne line per agent run. Sorted oldest-first.\n\n`, 'utf8');
  }
  fs.appendFileSync(LEDGER_PATH, line, 'utf8');
}

// ===========================================================================
// Deterministic agents (file-system + grep only — no network, no LLM)
// ===========================================================================

function agentPrivacyGrep() {
  // Spec Part 14 forbidden patterns. The pre-commit hook checks staged
  // files; this agent sweeps the entire tree so dormant offenders are
  // caught even if they were never staged.
  const FORBIDDEN = [
    { name: 'MediaRecorder', re: /\bMediaRecorder\b/g },
    { name: 'Blob(audio)', re: /new\s+Blob\s*\([^)]*audio/g },
    { name: 'FileReader', re: /\bnew\s+FileReader\b/g },
    { name: 'sendBeacon', re: /navigator\s*\.\s*sendBeacon\b/g },
    { name: 'speechRecognition', re: /\bSpeechRecognition\b/g },
    { name: 'webkitSpeechRecognition', re: /\bwebkitSpeechRecognition\b/g },
  ];
  const ALLOW_HOSTS = /(cue-pwa\.vercel\.app|api\.airtable\.com|api\.resend\.com|api\.anthropic\.com|api\.stripe\.com|api\.lemonsqueezy\.com|app\.lemonsqueezy\.com|chromewebstore\.google\.com|fonts\.googleapis\.com|localhost|127\.0\.0\.1)/;
  const FETCH = /fetch\(['"`]https?:\/\/([^'"`/]+)/g;

  const findings = [];
  const JS_HTML = (p) => /\.(js|mjs|html|jsx)$/.test(p);
  const roots = [MVP, PWA];
  let scanned = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, JS_HTML);
    scanned += files.length;
    for (const f of files) {
      const src = readSafe(f);
      if (!src) continue;
      for (const rule of FORBIDDEN) {
        let m;
        while ((m = rule.re.exec(src)) !== null) {
          if (/\/\/[^\n]*allowed-privacy-exception/.test(src.slice(Math.max(0, m.index - 200), m.index + 200))) continue;
          findings.push({ file: path.relative(LOCAL_ROOT, f), rule: rule.name, line: src.slice(0, m.index).split('\n').length });
        }
      }
      let m;
      while ((m = FETCH.exec(src)) !== null) {
        if (ALLOW_HOSTS.test(m[1])) continue;
        findings.push({ file: path.relative(LOCAL_ROOT, f), rule: `fetch → ${m[1]}`, line: src.slice(0, m.index).split('\n').length });
      }
    }
  }

  const summary = findings.length === 0
    ? `PASS — scanned ${scanned} files, no forbidden patterns`
    : `FLAGGED — ${findings.length} finding(s) across ${scanned} files`;
  const body = [
    `**Status:** ${findings.length === 0 ? 'PASS' : 'FLAGGED'}`,
    `**Scanned:** ${scanned} JS/HTML files across cue-mvp + cue-pwa-current`,
    '',
    findings.length === 0
      ? 'No occurrences of forbidden audio-handling APIs or non-allowlisted fetch hosts. Privacy property holds at the source level.'
      : 'Findings:\n\n' + findings.map((f) => `- \`${f.file}:${f.line}\` — ${f.rule}`).join('\n'),
    '',
    'Forbidden patterns checked: `MediaRecorder`, `new Blob(...audio...)`, `new FileReader`, `navigator.sendBeacon`, `SpeechRecognition`, `webkitSpeechRecognition`, and `fetch()` to any host outside the spec Part 14 allowlist.',
  ].join('\n');
  return { summary, body };
}

function agentDeadFileFinder() {
  // For cue-mvp only: read manifest.json + content_scripts + side-panel/
  // imports, then list any .js file under src/ never referenced.
  const manifestPath = path.join(MVP, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { summary: 'SKIP — manifest.json not found', body: 'Could not locate cue-mvp/manifest.json.' };
  }
  let manifest;
  try { manifest = JSON.parse(readSafe(manifestPath)); } catch (e) {
    return { summary: 'SKIP — manifest.json failed to parse', body: `Parse error: ${e.message}` };
  }

  const referenced = new Set();
  const collect = (s) => {
    if (typeof s === 'string') referenced.add(s.replace(/^\//, ''));
  };
  collect(manifest.background?.service_worker);
  for (const c of manifest.content_scripts || []) for (const j of c.js || []) collect(j);
  for (const w of manifest.web_accessible_resources || []) for (const r of w.resources || []) collect(r);
  collect(manifest.side_panel?.default_path);
  collect(manifest.action?.default_popup);

  // Also scan all HTML files for <script src="..."> references.
  const HTML = walkFiles(MVP, (p) => p.endsWith('.html'));
  for (const h of HTML) {
    const src = readSafe(h);
    const re = /<script[^>]+src=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const s = m[1].replace(/^\//, '');
      if (!/^https?:/.test(s)) referenced.add(s);
    }
    const linkRe = /<link[^>]+href=["']([^"']+\.css)["']/g;
    while ((m = linkRe.exec(src)) !== null) {
      const s = m[1].replace(/^\//, '');
      if (!/^https?:/.test(s)) referenced.add(s);
    }
  }

  const allFiles = walkFiles(MVP, (p) => /\.(js|css|html)$/.test(p) && !/manifest/.test(p));
  const orphans = [];
  for (const f of allFiles) {
    const rel = path.relative(MVP, f).replace(/\\/g, '/');
    if (rel.startsWith('.githooks/')) continue;
    if (referenced.has(rel)) continue;
    if (rel.endsWith('.html')) continue; // HTML files are entry points, skip
    // Also accept references from any other JS file (intra-source imports).
    let referencedElsewhere = false;
    for (const g of allFiles) {
      if (g === f) continue;
      if (readSafe(g).includes(path.basename(rel))) { referencedElsewhere = true; break; }
    }
    if (!referencedElsewhere) orphans.push(rel);
  }

  const summary = orphans.length === 0
    ? `PASS — every src/* file is referenced`
    : `INFO — ${orphans.length} potentially-orphan file(s)`;
  const body = [
    `**Status:** ${orphans.length === 0 ? 'PASS' : 'INFO'}`,
    `**Referenced files:** ${referenced.size} via manifest + HTML`,
    `**Scanned files:** ${allFiles.length}`,
    '',
    orphans.length === 0
      ? 'No orphan files detected. Every shipped file is referenced from the manifest or another script.'
      : 'Files not referenced by manifest, content_scripts, web_accessible_resources, side_panel, or any other script in the tree:\n\n'
        + orphans.map((o) => `- \`${o}\``).join('\n')
        + '\n\nThis check has false positives — files loaded dynamically (e.g., via `chrome.scripting.executeScript` at runtime) appear unreferenced. Review before deleting.',
  ].join('\n');
  return { summary, body };
}

function agentStaleVersionComment() {
  const manifest = JSON.parse(readSafe(path.join(MVP, 'manifest.json')) || '{}');
  const currentVer = manifest.version || '0.0.0';
  const [curMaj, curMin, curPatch] = currentVer.split('.').map((n) => parseInt(n, 10));

  const stale = [];
  for (const root of [MVP, PWA]) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, (p) => /\.(js|mjs|html)$/.test(p));
    for (const f of files) {
      const src = readSafe(f);
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = /\/\/\s*v?(\d+)\.(\d+)\.(\d+)\b/.exec(lines[i]);
        if (!m) continue;
        const [, maj, min, patch] = m.map((x, idx) => idx === 0 ? x : parseInt(x, 10));
        // "Stale" = a v1.1.X comment where X is more than 5 patches behind current.
        if (maj === curMaj && min === curMin && curPatch - patch > 5) {
          stale.push({ file: path.relative(LOCAL_ROOT, f), line: i + 1, version: `v${maj}.${min}.${patch}`, snippet: lines[i].trim().slice(0, 100) });
        }
      }
    }
  }

  const summary = `INFO — ${stale.length} comment(s) trail current v${currentVer} by 5+ patches`;
  const body = [
    `**Current manifest version:** v${currentVer}`,
    `**Threshold:** flagged if patch ≥ 6 behind`,
    `**Comments flagged:** ${stale.length}`,
    '',
    stale.length === 0
      ? 'No stale inline-version comments. Provenance comments are current.'
      : stale.slice(0, 40).map((s) => `- \`${s.file}:${s.line}\` ${s.version} — ${s.snippet}`).join('\n'),
    stale.length > 40 ? `\n\n…and ${stale.length - 40} more.` : '',
  ].join('\n');
  return { summary, body };
}

function agentTodoCollector() {
  const todos = [];
  for (const root of [MVP, PWA]) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, (p) => /\.(js|mjs|html|md)$/.test(p));
    for (const f of files) {
      const src = readSafe(f);
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const m = /\b(TODO|FIXME|XXX|HACK)\b\s*:?\s*(.+)/.exec(lines[i]);
        if (!m) continue;
        todos.push({ file: path.relative(LOCAL_ROOT, f), line: i + 1, tag: m[1], text: m[2].trim().slice(0, 140) });
      }
    }
  }

  // Group by tag
  const grouped = {};
  for (const t of todos) {
    grouped[t.tag] = grouped[t.tag] || [];
    grouped[t.tag].push(t);
  }

  const summary = `INFO — ${todos.length} TODO/FIXME/XXX/HACK markers`;
  const body = [
    `**Total markers:** ${todos.length}`,
    `**By tag:** ${Object.entries(grouped).map(([k, v]) => `${k}=${v.length}`).join(', ')}`,
    '',
    todos.length === 0
      ? 'No outstanding TODO/FIXME/XXX/HACK markers in the tree.'
      : Object.entries(grouped).map(([tag, items]) => [
          `## ${tag} (${items.length})`,
          '',
          items.slice(0, 30).map((t) => `- \`${t.file}:${t.line}\` — ${t.text}`).join('\n'),
          items.length > 30 ? `\n…and ${items.length - 30} more.` : '',
        ].join('\n')).join('\n\n'),
  ].join('\n');
  return { summary, body };
}

function agentManifestPermissionAuditor() {
  const manifest = JSON.parse(readSafe(path.join(MVP, 'manifest.json')) || '{}');
  const perms = manifest.permissions || [];
  const PERMISSION_API_SHAPES = {
    activeTab: ['activeTab'],
    tabs: ['chrome.tabs.', 'browser.tabs.'],
    storage: ['chrome.storage.', 'browser.storage.'],
    alarms: ['chrome.alarms.', 'browser.alarms.'],
    notifications: ['chrome.notifications.', 'browser.notifications.'],
    contextMenus: ['chrome.contextMenus.', 'browser.contextMenus.'],
    sidePanel: ['chrome.sidePanel.', 'browser.sidePanel.'],
    offscreen: ['chrome.offscreen.', 'browser.offscreen.'],
    tabCapture: ['chrome.tabCapture.', 'browser.tabCapture.'],
    scripting: ['chrome.scripting.', 'browser.scripting.'],
    identity: ['chrome.identity.', 'browser.identity.'],
  };

  const files = walkFiles(MVP, (p) => /\.js$/.test(p));
  const allSrc = files.map((f) => readSafe(f)).join('\n');

  const rows = perms.map((perm) => {
    const needles = PERMISSION_API_SHAPES[perm] || [`chrome.${perm}.`];
    let count = 0;
    for (const n of needles) {
      const m = allSrc.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
      if (m) count += m.length;
    }
    return { perm, count };
  });

  const unused = rows.filter((r) => r.count === 0);
  const summary = `INFO — ${unused.length}/${rows.length} declared permission(s) appear unused`;
  const body = [
    `**Declared permissions in manifest.json:** ${rows.length}`,
    `**No occurrences found in src/*.js:** ${unused.length}`,
    '',
    '| Permission | API call count |',
    '|---|---|',
    rows.map((r) => `| \`${r.perm}\` | ${r.count}${r.count === 0 ? ' ← unused?' : ''} |`).join('\n'),
    '',
    unused.length === 0
      ? 'Every declared permission has at least one matching API call.'
      : `\n**Action:** consider removing unused permissions — Chrome Web Store review notes the minimum-permission principle. False positives possible if a permission is used dynamically (e.g., via \`globalThis['chrome'][perm]\`).`,
  ].join('\n');
  return { summary, body };
}

function agentBundleSizeTracker() {
  const dist = path.join(PWA, 'dist');
  if (!fs.existsSync(dist)) return { summary: 'SKIP — dist/ not present', body: 'No dist/ folder in cue-pwa-current.' };
  const zips = fs.readdirSync(dist)
    .filter((f) => /^cue-(\d+\.\d+\.\d+|latest|store-submission)/.test(f) && f.endsWith('.zip'))
    .map((f) => ({ name: f, size: fileSize(path.join(dist, f)) }))
    .sort((a, b) => b.size - a.size);

  // Snapshot for trend analysis
  ensureDir(STATE_DIR);
  const trendFile = path.join(STATE_DIR, 'bundle-trend.csv');
  if (!fs.existsSync(trendFile)) fs.writeFileSync(trendFile, 'timestamp,file,bytes\n', 'utf8');
  const { iso } = nowParts();
  for (const z of zips) fs.appendFileSync(trendFile, `${iso},${z.name},${z.size}\n`, 'utf8');

  const summary = `INFO — ${zips.length} zip(s); latest = ${zips[0]?.size || 0} bytes`;
  const body = [
    `**dist/ zip inventory** (oldest snapshots stored to \`scripts/_swarm-state/bundle-trend.csv\`):`,
    '',
    '| File | Size (bytes) | Size (KB) |',
    '|---|---|---|',
    zips.map((z) => `| \`${z.name}\` | ${z.size.toLocaleString()} | ${(z.size / 1024).toFixed(1)} |`).join('\n'),
    '',
    'Significant size regressions (>10% growth) deserve investigation. Bundle bloat usually comes from accidentally committed test fixtures, source maps, or dependency vendoring.',
  ].join('\n');
  return { summary, body };
}

function agentThresholdSnapshot() {
  const thresholdsPath = path.join(MVP, 'src', 'signal', 'thresholds.js');
  if (!fs.existsSync(thresholdsPath)) return { summary: 'SKIP — thresholds.js not found', body: 'No thresholds.js.' };
  const src = readSafe(thresholdsPath);

  // Extract every `WORD: <number>,` line — captures all numeric thresholds.
  const out = {};
  const re = /^\s*([A-Z_][A-Z0-9_]+)\s*:\s*(-?\d+(?:\.\d+)?)/gm;
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = parseFloat(m[2]);

  // Hash for change detection
  const hash = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 12);
  ensureDir(STATE_DIR);
  const snapPath = path.join(STATE_DIR, 'threshold-snapshots.jsonl');
  fs.appendFileSync(snapPath, JSON.stringify({ ts: nowParts().iso, hash, count: Object.keys(out).length, thresholds: out }) + '\n', 'utf8');

  const summary = `INFO — ${Object.keys(out).length} thresholds, hash=${hash}`;
  const body = [
    `**Snapshot hash:** \`${hash}\``,
    `**Thresholds extracted:** ${Object.keys(out).length}`,
    `**Source:** \`cue-mvp/src/signal/thresholds.js\``,
    '',
    'Values (current snapshot):',
    '',
    '```json',
    JSON.stringify(out, null, 2),
    '```',
    '',
    'Successive snapshots are appended to `scripts/_swarm-state/threshold-snapshots.jsonl`. The threshold-tuner agent (LLM, weekly) can read this to recommend evidence-based adjustments.',
  ].join('\n');
  return { summary, body };
}

function agentChangelogGapDetector() {
  const changelogPath = path.join(MVP, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    return { summary: 'INFO — CHANGELOG.md missing', body: 'No CHANGELOG.md in cue-mvp.' };
  }
  const changelog = readSafe(changelogPath);
  // Find the last documented version
  const versionMatches = [...changelog.matchAll(/^##?\s+v?(\d+\.\d+\.\d+)/gm)];
  const lastDocumented = versionMatches.length ? versionMatches[0][1] : '0.0.0';
  const manifest = JSON.parse(readSafe(path.join(MVP, 'manifest.json')) || '{}');
  const current = manifest.version || '0.0.0';

  const gap = lastDocumented !== current ? 'GAP' : 'SYNCED';
  const summary = `${gap} — CHANGELOG top = v${lastDocumented}, manifest = v${current}`;
  const body = [
    `**Status:** ${gap}`,
    `**Latest CHANGELOG entry:** v${lastDocumented}`,
    `**manifest.json version:** v${current}`,
    '',
    gap === 'SYNCED'
      ? 'CHANGELOG is current with the shipped manifest version.'
      : `CHANGELOG.md does not yet document v${current}. Add an entry describing what changed since v${lastDocumented}.`,
  ].join('\n');
  return { summary, body };
}

function agentSecretScanner() {
  // High-confidence patterns (vendor-prefixed). These are almost certainly
  // real secrets if matched — URGENT status, no allowlist.
  const HIGH_CONF = [
    { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'GitHub PAT (classic)', re: /\bghp_[A-Za-z0-9]{36}\b/g },
    { name: 'GitHub PAT (fine-grained)', re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
    { name: 'Anthropic API Key', re: /\bsk-ant-api03-[A-Za-z0-9_-]{60,}\b/g },
    { name: 'OpenAI API Key', re: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/g },
    { name: 'Stripe Live Secret', re: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
    { name: 'Stripe Webhook', re: /\bwhsec_[A-Za-z0-9]{20,}\b/g },
    { name: 'LemonSqueezy Secret', re: /\bls_[A-Za-z0-9]{40,}\b/g },
    { name: 'Resend API Key', re: /\bre_[A-Za-z0-9]{20,}\b/g },
  ];
  // Low-confidence: long Base64-ish strings inside quotes. Used as a
  // safety net but downgraded to INFO since public keys, VAPID keys, og-
  // image bytes, etc. trigger it. Skipped when the surrounding context
  // suggests a public key.
  const LOW_CONF = { name: 'Generic high-entropy', re: /(?<=['"])[A-Za-z0-9+/=]{60,}(?=['"])/g };

  const high = [];
  const low = [];
  for (const root of [MVP, PWA]) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, (p) => /\.(js|mjs|json|html|md|env|toml|yml|yaml)$/i.test(p) || /\.env$/.test(p));
    for (const f of files) {
      // .env files are expected to contain secrets — skip
      if (/\.env(\.|$)/i.test(path.basename(f))) continue;
      const src = readSafe(f);
      for (const pat of HIGH_CONF) {
        const matches = src.match(pat.re);
        if (matches) {
          for (const match of matches.slice(0, 3)) {
            high.push({ file: path.relative(LOCAL_ROOT, f), pattern: pat.name, sample: match.slice(0, 12) + '…' });
          }
        }
      }
      let m;
      while ((m = LOW_CONF.re.exec(src)) !== null) {
        // Skip if surrounded by PEM public-key / VAPID-public-key context.
        const ctx = src.slice(Math.max(0, m.index - 400), Math.min(src.length, m.index + 200));
        if (/BEGIN PUBLIC KEY|END PUBLIC KEY|PUBLIC_KEY_PEM|VAPID_PUBLIC_KEY|VAPID public/i.test(ctx)) continue;
        // Skip if this looks like a content-hash for a static asset (data URLs etc.).
        if (/data:image|data:application|base64,/.test(ctx)) continue;
        low.push({ file: path.relative(LOCAL_ROOT, f), pattern: LOW_CONF.name, sample: m[0].slice(0, 12) + '…' });
      }
    }
  }

  const status = high.length > 0 ? 'URGENT' : (low.length > 0 ? 'INFO' : 'PASS');
  const summary = status === 'PASS'
    ? 'PASS — no leaked secrets'
    : status === 'URGENT'
      ? `URGENT — ${high.length} high-confidence secret match(es)`
      : `INFO — ${low.length} high-entropy string(s) (review for false positives)`;
  const body = [
    `**Status:** ${status}`,
    `**High-confidence findings:** ${high.length}`,
    `**Low-confidence (Generic high-entropy):** ${low.length}`,
    '',
    high.length === 0 && low.length === 0
      ? 'No vendor-prefixed API keys, tokens, or generic high-entropy strings detected. (Public keys, VAPID keys, and PEM blocks excluded by design.)'
      : '',
    high.length > 0 ? '## URGENT\n\n' + high.map((f) => `- \`${f.file}\` — ${f.pattern}: \`${f.sample}\``).join('\n') + '\n\n**ACTION:** rotate the real secret immediately.' : '',
    low.length > 0 ? '## INFO — review for false positives\n\n' + low.slice(0, 20).map((f) => `- \`${f.file}\` — ${f.pattern}: \`${f.sample}\``).join('\n') + (low.length > 20 ? `\n\n…and ${low.length - 20} more.` : '') : '',
  ].filter(Boolean).join('\n');
  return { summary, body };
}

function agentPreCommitHookHealth() {
  const hook = path.join(MVP, '.githooks', 'pre-commit');
  const ok = fs.existsSync(hook);
  if (!ok) return { summary: 'FLAG — pre-commit hook missing', body: 'cue-mvp/.githooks/pre-commit does not exist. Privacy enforcement at commit time is OFF.' };
  const src = readSafe(hook);
  const checks = [
    { name: 'smart-quote scan', re: /smart.?quote|U\+2018|U\+2019|\\xe2\\x80\\x98/i },
    { name: 'node --check', re: /node\s+--check/i },
    { name: 'forbidden API grep', re: /MediaRecorder|FileReader|sendBeacon/ },
    { name: 'fetch allowlist', re: /cue-pwa\.vercel\.app/ },
    { name: 'manifest hygiene', re: /\bidentity\b|\boauth2\b/ },
    { name: 'secret guard', re: /\.env|\.pem|\.key/ },
  ];
  const present = checks.filter((c) => c.re.test(src));
  const missing = checks.filter((c) => !c.re.test(src));
  const summary = `INFO — pre-commit hook has ${present.length}/${checks.length} expected guards`;
  const body = [
    `**Status:** ${missing.length === 0 ? 'PASS' : 'PARTIAL'}`,
    `**File:** \`cue-mvp/.githooks/pre-commit\` (${fileSize(hook)} bytes)`,
    `**Guards present:** ${present.map((c) => c.name).join(', ') || 'none'}`,
    `**Guards missing:** ${missing.map((c) => c.name).join(', ') || 'none'}`,
    '',
    missing.length === 0
      ? 'All expected guards are in place.'
      : 'Add a check for each missing guard to keep the privacy + parse property load-bearing.',
  ].join('\n');
  return { summary, body };
}

async function agentLinkValidator() {
  // Extract external URLs from .md and .html in both repos. HEAD each one
  // with a 5s timeout and classify the result. Network calls are FROM the
  // swarm (local tooling), NOT from shipped extension code — the privacy
  // property is unaffected.
  const urls = new Map(); // url → array of file:line
  for (const root of [MVP, PWA]) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, (p) => /\.(md|html)$/.test(p));
    for (const f of files) {
      const src = readSafe(f);
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const re = /https?:\/\/[^\s)>"'`<]+/g;
        let m;
        while ((m = re.exec(lines[i])) !== null) {
          let u = m[0].replace(/[.,;:)\]>}*]+$/, ''); // strip trailing punctuation incl. markdown bold stars
          // Skip placeholders, manifest match-patterns, template literals.
          if (/example\.com|YOUR_|placeholder|x{4,}|test_dummy|abc123|\bfoo\b|\bbar\b/i.test(u)) continue;
          if (/\/checkout\/buy\/[a-z]{1,6}\d{0,3}\b/i.test(u)) continue; // docs example shape
          if (/\/\*$|\/\*\?$/.test(u)) continue;                    // Chrome MV3 match patterns
          if (/[{}]/.test(u)) continue;                              // template literals like /orders/{id}
          if (/\(.*example|fixture|test\)/i.test(u)) continue;
          if (!urls.has(u)) urls.set(u, []);
          urls.get(u).push(`${path.relative(LOCAL_ROOT, f)}:${i + 1}`);
        }
      }
    }
  }

  const TIMEOUT_MS = 5000;
  const MAX_CHECKS = 60;
  // Bucketize by file extension/host so the same URLs don't fight over the
  // bounded budget every tick — shuffle the order using a tick-stable hash.
  const tickSeed = Math.floor(Date.now() / (15 * 60 * 1000));
  const ordered = Array.from(urls.entries())
    .map(([u, r]) => [u, r, crypto.createHash('md5').update(u + ':' + tickSeed).digest('hex').slice(0, 4)])
    .sort((a, b) => a[2].localeCompare(b[2]));
  const checkList = ordered.slice(0, MAX_CHECKS).map(([u, r]) => [u, r]);

  const failed = [];        // real breakage (404, network error)
  const suspicious = [];    // 403/405 — often anti-bot or method-not-allowed on POST endpoints
  const okCount = { val: 0 };

  function classify(status) {
    if (status >= 200 && status < 400) return 'ok';
    if (status === 403 || status === 405 || status === 429) return 'suspicious';
    return 'failed';
  }

  await Promise.all(checkList.map(async ([url, refs]) => {
    let status = 0; let error = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'CueSwarmLinkValidator/1.0' } });
      clearTimeout(timer);
      status = res.status;
    } catch (e) {
      // HEAD blocked — try a tiny GET
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0', 'User-Agent': 'CueSwarmLinkValidator/1.0' }, signal: ctrl.signal, redirect: 'follow' });
        clearTimeout(timer);
        status = res.status;
      } catch (e2) {
        error = e2.message.slice(0, 80);
      }
    }
    const kind = error ? 'failed' : classify(status);
    if (kind === 'ok') okCount.val++;
    else if (kind === 'suspicious') suspicious.push({ url, status, refs });
    else failed.push({ url, status, error, refs });
  }));

  const status = failed.length > 0 ? 'FLAGGED' : (suspicious.length > 0 ? 'INFO' : 'PASS');
  const summary = status === 'PASS'
    ? `PASS — checked ${checkList.length}, all resolve`
    : status === 'FLAGGED'
      ? `FLAGGED — ${failed.length} real breakage, ${suspicious.length} suspicious`
      : `INFO — ${suspicious.length} suspicious (likely anti-bot or POST-only)`;
  const body = [
    `**Status:** ${status}`,
    `**URLs known across docs/HTML:** ${urls.size}`,
    `**Checked this tick** (bounded to ${MAX_CHECKS}): ${checkList.length}`,
    `**OK (2xx/3xx):** ${okCount.val}`,
    `**Failed (404 / net error):** ${failed.length}`,
    `**Suspicious (403/405/429):** ${suspicious.length}`,
    '',
    failed.length > 0
      ? '## Real breakage — fix these\n\n' + failed.slice(0, 25).map((b) => `- \`${b.url}\` — ${b.status || 'network'}${b.error ? ` (${b.error})` : ''}\n  refs: ${b.refs.slice(0, 3).join(', ')}${b.refs.length > 3 ? `, +${b.refs.length - 3}` : ''}`).join('\n')
        + (failed.length > 25 ? `\n\n…and ${failed.length - 25} more.` : '')
      : '',
    suspicious.length > 0
      ? '\n## Suspicious (likely false positive)\n\n' + suspicious.slice(0, 15).map((b) => `- \`${b.url}\` — ${b.status} (anti-bot / method-not-allowed)\n  refs: ${b.refs.slice(0, 2).join(', ')}${b.refs.length > 2 ? `, +${b.refs.length - 2}` : ''}`).join('\n')
        + (suspicious.length > 15 ? `\n\n…and ${suspicious.length - 15} more.` : '')
      : '',
  ].filter(Boolean).join('\n');
  return { summary, body };
}

function agentApiHandlerUniformity() {
  const apiDir = path.join(PWA, 'api');
  if (!fs.existsSync(apiDir)) return { summary: 'SKIP — api/ not present', body: 'No api/ folder.' };
  const files = walkFiles(apiDir, (p) => /\.js$/.test(p) && !path.basename(p).startsWith('_'));
  const issues = [];
  const checks = {
    hasDefaultExport: /export\s+default|module\.exports\s*=/,
    checksMethod: /req\.method/,
    returnsJson: /res\.(status\([^)]*\)\.)?json\(/,
    hasErrorPath: /(try\s*{|catch\s*\(|res\.status\(\s*[45]\d\d)/,
  };
  for (const f of files) {
    const src = readSafe(f);
    const fileIssues = [];
    for (const [name, re] of Object.entries(checks)) {
      if (!re.test(src)) fileIssues.push(name);
    }
    if (fileIssues.length) issues.push({ file: path.relative(LOCAL_ROOT, f), missing: fileIssues });
  }
  const summary = issues.length === 0
    ? `PASS — ${files.length} handler(s) match the canonical pattern`
    : `INFO — ${issues.length} handler(s) drift from the canonical pattern`;
  const body = [
    `**Status:** ${issues.length === 0 ? 'PASS' : 'INFO'}`,
    `**Handlers scanned:** ${files.length}`,
    `**Pattern checks:** default export, req.method gate, res.json() response, error path (try/catch or 4xx/5xx).`,
    '',
    issues.length === 0
      ? 'Every public API handler matches the canonical shape.'
      : issues.map((i) => `- \`${i.file}\` — missing: ${i.missing.join(', ')}`).join('\n')
        + '\n\nDrift here usually means a handler was added quickly without the full pattern. Refactor before the next consumer integrates against it.',
  ].join('\n');
  return { summary, body };
}

function agentHtmlAccessibility() {
  const findings = [];
  for (const root of [MVP, PWA]) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, (p) => p.endsWith('.html'));
    for (const f of files) {
      const src = readSafe(f);
      const imgRe = /<img\b([^>]*)>/gi;
      let m;
      while ((m = imgRe.exec(src)) !== null) {
        if (!/\balt\s*=/.test(m[1])) {
          findings.push({
            file: path.relative(LOCAL_ROOT, f),
            line: src.slice(0, m.index).split('\n').length,
            issue: '<img> without alt attribute',
            snippet: m[0].slice(0, 100),
          });
        }
      }
      const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
      while ((m = btnRe.exec(src)) !== null) {
        const attrs = m[1];
        const inner = m[2].replace(/<[^>]+>/g, '').trim();
        if (!inner && !/\baria-label\s*=/.test(attrs) && !/\btitle\s*=/.test(attrs)) {
          findings.push({
            file: path.relative(LOCAL_ROOT, f),
            line: src.slice(0, m.index).split('\n').length,
            issue: '<button> with no text/aria-label/title',
            snippet: m[0].slice(0, 100),
          });
        }
      }
      const anchorRe = /<a\b([^>]*)>/gi;
      while ((m = anchorRe.exec(src)) !== null) {
        if (!/\bhref\s*=\s*["'][^"']/.test(m[1])) {
          findings.push({
            file: path.relative(LOCAL_ROOT, f),
            line: src.slice(0, m.index).split('\n').length,
            issue: '<a> without a real href',
            snippet: m[0].slice(0, 100),
          });
        } else if (/\bhref\s*=\s*["']#["']/.test(m[1])) {
          findings.push({
            file: path.relative(LOCAL_ROOT, f),
            line: src.slice(0, m.index).split('\n').length,
            issue: '<a href="#"> placeholder anchor',
            snippet: m[0].slice(0, 100),
          });
        }
      }
    }
  }
  const summary = findings.length === 0
    ? 'PASS — basic a11y checks clean'
    : `INFO — ${findings.length} a11y suggestion(s)`;
  const body = [
    `**Status:** ${findings.length === 0 ? 'PASS' : 'INFO'}`,
    `**Heuristics:** \`<img>\` without alt, \`<button>\` with no text/aria-label, \`<a>\` without real href.`,
    `**Findings:** ${findings.length}`,
    '',
    findings.length === 0
      ? 'Every \`<img>\` has an alt attribute; every \`<button>\` has text or aria-label; every \`<a>\` has a real href.'
      : findings.slice(0, 30).map((f) => `- \`${f.file}:${f.line}\` — ${f.issue}\n  \`${f.snippet}\``).join('\n')
        + (findings.length > 30 ? `\n\n…and ${findings.length - 30} more.` : ''),
    '',
    'These are heuristics, not a full WCAG audit. False positives include `<button>` with only an SVG child (which can still be accessible via `aria-label`) and `<a href="#">` anchors that have a click handler (which should still use a `<button>` for screen-reader semantics).',
  ].join('\n');
  return { summary, body };
}

// ===========================================================================
// Main
// ===========================================================================

const argForced = process.argv.find((a) => a.startsWith('--agent='))?.split('=')[1];
const slug = pickNextAgent(argForced);

const fns = {
  'privacy-grep': agentPrivacyGrep,
  'dead-file-finder': agentDeadFileFinder,
  'stale-version-comment': agentStaleVersionComment,
  'todo-collector': agentTodoCollector,
  'manifest-permission-auditor': agentManifestPermissionAuditor,
  'bundle-size-tracker': agentBundleSizeTracker,
  'threshold-snapshot': agentThresholdSnapshot,
  'changelog-gap-detector': agentChangelogGapDetector,
  'secret-scanner': agentSecretScanner,
  'pre-commit-hook-health': agentPreCommitHookHealth,
  'link-validator': agentLinkValidator,
  'api-handler-uniformity': agentApiHandlerUniformity,
  'html-accessibility': agentHtmlAccessibility,
};
const fn = fns[slug];
if (!fn) {
  console.error(`No agent named '${slug}'.`);
  process.exit(1);
}

console.log(`[swarm] running agent: ${slug}`);
const result = await fn();
const { summary, body } = result;
const reportPath = writeReport(slug, body);
appendLedger(slug, summary, reportPath);
console.log(`[swarm] ${slug}: ${summary}`);
console.log(`[swarm] report: ${reportPath}`);
