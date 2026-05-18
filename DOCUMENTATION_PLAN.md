# Cue — Documentation Plan

This file is the operational brief for closing the documentation gap on Cue. It's the tactical companion to `ROADMAP.md` — where `ROADMAP.md` sets the six-phase business strategy, this file scopes the specific docs that need to exist, where the source material lives, what's verifiable from code, what requires external verification, and what needs Nathan's human judgment.

**How to use it.** Each future Claude Code session picks one Phase-1 doc, writes it, and appends a progress note at the bottom. Phase 2 docs cannot start until their gate question is answered. Phase 3 questions block whichever docs depend on them — flag explicitly. Do not replace this file — refine, append, and re-check.

**Who it's for.** Nathan (founder, sole human). Any future Claude Code session briefed against `ROADMAP.md` + this file. Any contractor we hand off to.

**Why this plan exists.** Stage 3 of the 2026-05-15 foundation audit (`ROADMAP.md` Phase 3) found: "The signal model is undocumented — single biggest contractor-blocking item." Bus factor is 1. Marketing/philosophy docs are deep (`README.md`, `LAUNCH_NOW.md`, `CHROME_STORE_LISTING.md`); operational and architectural docs are missing entirely. This plan closes the gap without rewriting the philosophy.

---

## Existing docs — preserved, not duplicated

Future sessions should NOT rewrite these. Reference them and update only when they go stale.

| File | What it is | Status |
|---|---|---|
| `README.md` | Product overview + privacy claim + tech stack + setup hints | Mostly current. One stale claim removed below in Phase 1.6. |
| `ROADMAP.md` | Six-phase business strategy (Verify → Stabilize → Ship → Document → Productize → Grow) + 11 open questions + progress log | **Authoritative.** This plan lives under its Phase 3 (Document). |
| `CHROME_STORE_LISTING.md` | Paste-ready Web Store submission text (SOC 2 false claim removed 2026-05-15) | Current. Will fold into `CHROME_WEB_STORE_REVIEW.md` in Phase 1. |
| `LAUNCH_NOW.md` | Launch checklist + customer-segment messaging (HIPAA false claim softened 2026-05-15) | Mostly current. Audit during Phase 1.6 for other compliance overreach. |
| `CALENDAR_SETUP.md` | OAuth setup for the now-deleted `src/calendar/` module | **Obsolete.** Calendar code was removed in the 2026-05-15 privacy cleanup. Either delete or move to `_archive/`. |
| `CURSOR_SETUP.md` | Cursor IDE rules pointer | Niche, but keep. |
| `.cursor/rules/cue-context.md` | Cursor-IDE-specific brief | Keep. Reference from `CLAUDE.md`. |

---

## Phase 1 — Derive from code

Eight docs that can be written from the repo alone, no external verification needed. Total estimated effort: **18–26 hours** of focused work.

Future sessions should pick one item, write it, mark it done in the Progress log, then stop.

### 1.1 `CLAUDE.md` — agent orientation file
- **Source material:** This plan + `ROADMAP.md` + `README.md` + 8 must-read files identified in the foundation audit's Stage 1 (`manifest.json`, `src/background/service-worker.js`, `offscreen/offscreen.js`, `src/audio/audio-manager.js`, `src/audio/cue-processor.js`, `src/signal/signal-model.js`, `src/signal/decision-engine.js`, `side-panel/panel.js`).
- **Scope:** What is Cue. What's in scope vs. out of scope (e.g., `cue-desktop/` Tauri app is separate). Where the canonical build lives (`cue-store-prep/`). What's currently broken (point at `ROADMAP.md` open items). Conventions for adding code. Conventions for adding docs. How to run the verify page. Where the audit grep template lives.
- **Bootstrapping principle:** A new agent should be able to read `CLAUDE.md` + `ROADMAP.md` in ≤ 5 minutes and pick up productive work without re-deriving anything.
- **Estimate:** 1–2 hours.
- **Priority:** **FIRST.** Every other doc benefits from this existing.

### 1.2 `SIGNAL_MODEL.md` — the IP
- **Source material:** `src/signal/thresholds.js`, `src/signal/signal-model.js`, `src/signal/decision-engine.js`, `src/signal/nudge-engine.js`, `src/signal/interruption-detector.js`, `src/signal/coaching-engine.js`, `src/signal/adaptation-engine.js`, `src/signal/latency-monitor.js`, `src/audio/cue-processor.js` (the AudioWorklet).
- **Scope:** (a) The five signals' acoustic definitions + the papers they cite. (b) Per-user baseline calibration formula (warmup window, p5/p95 mapping to 0–100 scores, EMA smoothing). (c) Threshold table — pace.pMin / pMax, tension.tWarn / tSpike, energy.eLow / eHi, pause.pause, talkPct.talk, plus hysteresis windows. (d) Decision-engine state machine (PAUSE / ASK_QUESTION / CONTINUE) — what conditions transition between states. (e) Nudge cooldown matrix (per-key cooldown, global gap, warmup gate, first-corrective gate). (f) Per-conversation-profile overrides (default, negotiation, sales, presentation, 1on1).
- **Why it matters most:** This file IS the moat. Without it, a contractor cannot reproduce or evolve the product safely. It also defends the science claim if a reporter or buyer asks "how does Cue actually decide when to nudge?"
- **Estimate:** 4–6 hours. Extract from inline comments, walk the call graph, write the threshold table by hand.

### 1.3 `ARCHITECTURE.md` — runtime data flow
- **Source material:** `manifest.json` + every file mentioned in Stage 1 of the foundation audit (already mapped).
- **Scope:** ASCII diagram of mic → offscreen `getUserMedia` → AudioContext → AudioWorklet (`cue-processor.js`) → numeric signals → signal model → decision engine → side panel + content-script center-screen overlay → IndexedDB on session end. Process boundaries — what runs in the service worker vs. the offscreen document vs. the side panel vs. the content script vs. the AudioWorklet thread. Message-passing topology (the 5 senders and their message types).
- **Estimate:** 2–3 hours.

### 1.4 `MODULE_GUIDE.md` — per-file purpose
- **Source material:** Every `.js` file in `src/`, `side-panel/`, `offscreen/`, `tape/`, `verify/`, `src/settings/`.
- **Scope:** One paragraph per file: what it does, what it depends on, what depends on it, what to be careful about when editing. Group by directory.
- **Estimate:** 3–4 hours. Mechanical but tedious. Could be partially auto-extracted from file headers (most files have a comment block at the top).

### 1.5 `BUILD_AND_RELEASE.md` — how to ship a new version
- **Source material:** Will exist after `ROADMAP.md` Phase 1's `scripts/build-store-package.ps1` is written. Until then, document the ad-hoc `build-zips.py` flow this session relied on.
- **Scope:** How to bump version (manifest.json + tauri.conf.json + Cargo.toml if applicable). How to strip `cue-extension/manifest.json` to `cue-store-prep/manifest.json` (the identity + oauth2 strip). How to validate the manifest. How to run the privacy audit grep template. How to produce the versioned + "latest" zips. How to deploy `cue-pwa-git/dist/` via Vercel. How to update `dist/version.json`. How to submit a new version to the Chrome Web Store dev console.
- **Estimate:** 2–3 hours after the build script exists. ~1 hour as ad-hoc documentation of the current manual flow.
- **Gate:** `ROADMAP.md` Phase 1's build script is a hard prerequisite for the full version. A shorter "ad-hoc current state" version can be written today.

### 1.6 `PRIVACY_THREAT_MODEL.md` — what we claim, what could break it
- **Source material:** Stage 2 verdict in `ROADMAP.md`. The audit grep template (lives in this session's transcript — port into `scripts/verify-privacy.ps1` per Phase 0 of `ROADMAP.md`). The list of files deleted in the 2026-05-15 cleanup (`src/calendar/`, `src/transcription/`, four `/api/sync` and `/api/test-haptic` fetches).
- **Scope:** Explicit privacy claim wording. Threats enumerated — what code paths could violate it, what permissions could expand the attack surface, what future features (sync v2, calendar v2, transcription v2) would require updated disclosure. The audit grep template as a copy-paste-runnable artifact. The list of file/code patterns that should NEVER reappear in a shipping build without explicit consent UI + updated `README.md` copy. Reviewer-facing language a journalist or enterprise procurement officer could fact-check against.
- **Estimate:** 2–3 hours.
- **Cross-link:** `ROADMAP.md` Phase 0.

### 1.7 `CHROME_WEB_STORE_REVIEW.md` — submission packet, consolidated
- **Source material:** `CHROME_STORE_LISTING.md` (paste-ready text), the foundation audit's permission usage map (10 permissions × usage sites), the privacy-practices declarations from this session's `Cue-Chrome-Store-Submission.md` packet.
- **Scope:** Title + summary + long description + permission justifications (one sentence per permission, reviewer-defensible) + privacy-practices disclosures (10 categories with yes/no/explanation) + single-purpose declaration + reviewer notes (the "how to test" section). Designed to be paste-ready into the Chrome Web Store dev console.
- **Cross-link:** Replaces `CHROME_STORE_LISTING.md` once written; old file can move to `_archive/` after migration.
- **Estimate:** 1–2 hours. Most content already exists; this is consolidation + de-duplication.

### 1.8 `SUPPORT.md` — refund / abuse / DMCA / first-bug-report
- **Source material:** None in repo yet — this is the first time the support story is written down.
- **Scope:** Where a refund request lands. Who answers (Nathan today; needs to be a real address per `ROADMAP.md` Open Question #2). SLA. Refund policy text. DMCA designated-agent designation (or a "we have no DMCA agent because we host no user content" statement). Abuse / complaint workflow. Where bug reports land. Whether Sentry-style error reporting is wired (it isn't, per Stage 2 audit).
- **Estimate:** 1–2 hours. Gated by `ROADMAP.md` Open Question #2 (support email).
- **Cross-link:** `ROADMAP.md` Phase 4 (Productize) — depends on this existing.

**Phase 1 total: 18–26 hours across 8 docs.**

---

## Phase 2 — Verify, then document

Five docs that need facts I cannot read from this repo alone. Each is gated by a specific verification step. Future sessions: do the verification first, then write the doc — don't write speculatively.

### 2.1 `PWA_BACKEND_STATE.md` — what's actually wired in the PWA
- **Gate question:** What's currently hosted at `cue-pwa.vercel.app/api/*`? Specifically: `/api/sync`, `/api/test-haptic`, `/api/haptic-test`, `/api/signup`, `/api/corpus`. Each endpoint — does it accept POST? What does it store? Is it backed by Airtable / Supabase / serverless functions / nothing?
- **How to verify:** Read `cue-pwa-git/api/` directory. Check `cue-pwa-git/vercel.json`. Check Vercel dashboard for environment variables. Check Airtable for the corpus table referenced in `STATUS_FOR_NATHAN.md` (in `cue-desktop/`).
- **Why it matters:** The 2026-05-15 privacy cleanup removed the extension's fetches TO these endpoints — but the endpoints themselves may still be live. If they are, they're a passive surface (no extension talks to them, but a third party could). If they hold past-uploaded user data, that's a retention/deletion question.
- **Scope when written:** Endpoint inventory, data schema per endpoint, who/what writes to them today, retention/deletion posture.
- **Estimate:** 2 hours to verify + 1 hour to document.

### 2.2 `GITHUB_CI_STATE.md` — what auto-runs and how
- **Gate question:** What GitHub Actions workflows are currently active? Where are the secrets (ANTHROPIC_API_KEY, AIRTABLE_PAT, etc.) stored? Do the workflows currently pass?
- **How to verify:** `cue-desktop/.github/workflows/` (build-desktop.yml, verify-and-fix.yml). `cue-pwa-git/` does it have any? Check the GitHub repo's Actions tab for recent runs. Enumerate secrets via GitHub settings (can't read values, but can read names).
- **Why it matters:** Build automation lives in CI. If CI is broken or secrets have expired, the "ship a new version" path is broken. Also: any CI job that hits an API is a potential privacy/cost surface.
- **Scope when written:** Workflow inventory, trigger conditions, what each job does, where secrets are stored, current pass/fail state.
- **Estimate:** 1–2 hours.

### 2.3 `CHROME_WEB_STORE_DRAFT_STATE.md` — what's actually in the dev console
- **Gate question:** Has the v1.0.1 draft (created April 30) been resubmitted with v1.1.x? If so, what was the outcome (approved / rejected / pending / draft)? What's the listing URL?
- **How to verify:** Nathan needs to log into `chrome.google.com/webstore/devconsole` and report back. Cannot be done from code alone.
- **Why it matters:** The roadmap assumes the Web Store submission is pending. If it's already approved (and live!), the install story changes immediately and several roadmap items move. If it's rejected, we need the reviewer's notes.
- **Scope when written:** Current state, listing URL if approved, rejection notes if rejected, last upload date, version uploaded.
- **Estimate:** 15 minutes to verify (Nathan's hands) + 30 minutes to document.

### 2.4 `DESKTOP_APP_PARITY.md` — Tauri desktop vs Chrome extension
- **Gate question:** Does `cue-desktop/` ship the same signal model as the Chrome extension? Did the v1.0.2 commit (this session) actually build and ship? What's the current GitHub release state — are the missing `.exe` and `.dmg` installers re-attached?
- **How to verify:** Inspect `cue-desktop/src/` against `cue-store-prep/src/`. Check `https://api.github.com/repos/vajdos/cue-desktop/releases/latest`. Check the CI run we kicked off late in the foundation-audit session.
- **Why it matters:** The Tauri desktop is the answer to Nathan's "Cue should live on my computer regardless of which app I'm in" requirement. If signal-model parity is broken, the desktop and extension behave differently — confusing for testers and a documentation hazard.
- **Scope when written:** Side-by-side feature matrix. Code drift inventory. Build state. Whether the two products should be merged or kept separate.
- **Estimate:** 2 hours.
- **Open Question dependency:** This may surface a NEW open question — see `ROADMAP.md` OQ #11 ("desktop vs. extension — which is canonical?").

### 2.5 `TWILIO_SMS_STATE.md` — what the `notify_*.py` and `send_steve_*.py` scripts actually do
- **Gate question:** Are these scripts being used today? Is the Twilio account active? Is the Gmail app password still valid? Are any of these scripts called by scheduled tasks / cron / GitHub Actions?
- **How to verify:** Read each script. Check `.env` (gitignored, so Nathan's eyes only). Check scheduled-tasks MCP, GitHub Actions, any Vercel cron. Check whether the Twilio toll-free verification (referenced in the conversation summary as IN_REVIEW) has changed.
- **Why it matters:** These scripts are the existing "Nathan-to-Nathan brain dump" and "tester notification" tooling. They MUST be excluded from the Chrome Web Store zip (the build script must strip them). They're also potentially valuable — should they live in a separate `cue-tooling/` repo per `ROADMAP.md` Open Question #8?
- **Scope when written:** Per-script: what it does, who uses it, what credentials it needs, whether it's still wired. Decision recommendation: keep in repo (excluded from build) vs. move to separate repo vs. archive.
- **Estimate:** 2 hours.

**Phase 2 total: 9–12 hours. Cannot start until verifications are done.**

---

## Phase 3 — Human-only decisions

Questions Nathan must answer before certain docs can be written truthfully. This is the same list as `ROADMAP.md`'s "Open questions for Nathan" — reproduced here for ease of working through them in order, and cross-referenced to the docs that depend on each answer.

Future sessions: when you encounter an unanswered question, write the doc to its maximum possible truthful scope, flag the unanswered piece clearly, and move on. Don't guess.

| # | Question | Doc it blocks |
|---|---|---|
| 1 | **Pricing model** — free, freemium, paid one-time, subscription? What does Pro unlock? | `SUPPORT.md` (refund policy), `BUILD_AND_RELEASE.md` (does the build flag a Pro tier?), `CHROME_WEB_STORE_REVIEW.md` (single-purpose declaration mentions paid features) |
| 2 | **Support email / domain** — personal Gmail forwarder, or buy a real domain? | `SUPPORT.md`, `CHROME_WEB_STORE_REVIEW.md` (Support contact field), `README.md` (footer link) |
| 3 | **ToS / Privacy Policy** — write fresh with a lawyer, templated, or hand-rolled? | `SUPPORT.md`, `CHROME_WEB_STORE_REVIEW.md`, `README.md`, the PWA's `/terms` page (currently 404), `PRIVACY_THREAT_MODEL.md` (what we promise vs. what we measure) |
| 4 | **Privacy-preserving analytics** — aggregated opt-in telemetry, or local-only absolute rule? | `PRIVACY_THREAT_MODEL.md`, future analytics doc |
| 5 | **Retention strategy** — OS notification, email digest, neither? | Future `RETENTION_DESIGN.md`, `PRIVACY_THREAT_MODEL.md` (email capture changes the claim) |
| 6 | **Sync v2 reintroduction** — when, how, what consent UI? | Future `SYNC_V2_DESIGN.md`, `PRIVACY_THREAT_MODEL.md` |
| 7 | **Onboarding UX** — rebuild standalone or rely on the in-panel self-select? | Future `ONBOARDING_DESIGN.md`, `CHROME_WEB_STORE_REVIEW.md` (first-run UX described) |
| 8 | **`notify_*.py` / `send_steve_*.py` scripts** — keep in repo (excluded from build) or move? | `TWILIO_SMS_STATE.md`, `BUILD_AND_RELEASE.md` (strip rules) |
| 9 | **Browser distribution** — Edge / Firefox / Safari? Order? | Future per-browser port docs |
| 10 | **Bus-factor mitigation** — contractor on retainer, co-founder read access, escrow, open-sourcing? | `CLAUDE.md` (handoff section), `SUPPORT.md`, `BUILD_AND_RELEASE.md` (credentials handoff) |
| 11 | **`cue-desktop/` vs. Chrome extension — which is canonical?** | `DESKTOP_APP_PARITY.md`, `CLAUDE.md` (scope), `ROADMAP.md` (which phases apply to which surface), `ARCHITECTURE.md` (which one is in scope?) |

When Nathan answers a question, append the answer + date to this table, then mark the dependent docs as unblocked.

---

## Recommended sequencing

The next four sessions should follow this order. Each session takes one item, completes it, appends to the Progress log, stops.

| Session | Doc | Phase | Why this order |
|---|---|---|---|
| #1 | `CLAUDE.md` | 1.1 | Unlocks every future session. Highest leverage. ~1–2 hours. |
| #2 | `SIGNAL_MODEL.md` | 1.2 | Closes the deepest tribal-knowledge gap. The IP. The single biggest contractor blocker. ~4–6 hours. |
| #3 | `ARCHITECTURE.md` | 1.3 | Frames the whole repo. Once `CLAUDE.md` + `SIGNAL_MODEL.md` + `ARCHITECTURE.md` exist, every other doc has a foundation to lean on. ~2–3 hours. |
| #4 | `PRIVACY_THREAT_MODEL.md` | 1.6 | Locks in the audit discipline from 2026-05-15. Must exist before any new feature is contemplated. ~2–3 hours. |

After these four, the natural next moves are `MODULE_GUIDE.md` (1.4) for contractor onboarding depth, then start Phase 2 verifications.

`BUILD_AND_RELEASE.md` (1.5) is gated on `ROADMAP.md` Phase 1's build-script work. `SUPPORT.md` (1.8) and the deeper Web Store packet (1.7) are gated on Phase 3 Q1, Q2, Q3.

---

## Conventions

All docs in this plan follow the same style. Don't drift from these without an explicit reason.

- **Voice:** terse, declarative, no marketing language. Match `README.md` tone.
- **File references:** clickable paths with line numbers when relevant — `src/signal/thresholds.js:42`. Backticks always.
- **No duplication:** if `ROADMAP.md` says it, reference don't restate. Same for `README.md`, `CHROME_STORE_LISTING.md`, `LAUNCH_NOW.md`.
- **Living documents:** future sessions update them in place. Don't fork. If a doc gets dated, fix it in place + note the change in the doc's own footer.
- **Cross-reference:** every doc that depends on another should explicitly link. Use relative paths.
- **No claims you can't defend:** if you're not sure, mark it `TODO: verify` and move on. Don't invent facts.
- **Date-stamp meaningful changes** in a doc's footer when you touch it. Format: `_Updated YYYY-MM-DD: <what changed>_`.

---

## Progress log

Append dated entries here as docs land. Format: `### YYYY-MM-DD — <doc name> — <what happened>`.

### 2026-05-15 — DOCUMENTATION_PLAN.md — created
- Modeled on the parallel session's `_admin/DOCUMENTATION_PLAN.md` for Regis AI Hub (separate project)
- Scoped specifically to Cue's stack: MV3 Chrome extension + Tauri desktop + iPhone PWA + Vercel + (no backend)
- Cross-linked to `ROADMAP.md` Phase 3 (Document) — this file is the tactical brief for that phase
- Next: write `CLAUDE.md` (Phase 1.1) in this same session

### 2026-05-15 — CLAUDE.md (Phase 1.1) — created in same session
- 8 must-read files mapped, scope boundaries drawn (extension vs. desktop vs. PWA vs. Regis AI Hub)
- "What's currently broken" section captures the 5 user-feedback items from David + Andy (Teams chat 2026-05-15)
- Conventions section locks in: no remote code, no chrome.storage.sync, no Web Speech, no chrome.identity in build
- Privacy claim re-asserted as load-bearing + non-negotiable
- Next: SIGNAL_MODEL.md (Phase 1.2) — the deepest IP doc, ~4-6 hours

### 2026-05-17 — Phase 2 complete — all 5 docs landed
- **PWA_BACKEND_STATE.md (2.1)** — verified `cue-pwa.vercel.app/api/health` returns all-green; 13 active endpoints catalogued; identified 5 action items including past-data audit of two Airtable bases (`apptO12PxTpR5192l`, `appG6yqvYz0cRJMKJ`)
- **GITHUB_CI_STATE.md (2.2)** — only `vajdos/cue-desktop` has CI; both workflows (build-desktop, verify-and-fix) are green; cue-extension and cue-pwa-git have no GitHub Actions yet
- **DESKTOP_APP_PARITY.md (2.4)** — v1.0.2 release has all 3 binaries live (Apr 30 v1.0.1's missing-assets issue is FIXED); surfaced `voice-print.js` divergence as a blocker for SIGNAL_MODEL.md; byte-for-byte signal/audio diff still TODO
- **TWILIO_SMS_STATE.md (2.5)** — 8 founder-tooling Python scripts catalogued; all manual-fire (no CI, no cron); must be excluded by Phase 1.3 build script
- **CHROME_WEB_STORE_DRAFT_STATE.md (2.3)** — stub created; verification requires Nathan to log into dev console; captured state template ready to fill in
- Two cross-doc dependencies surfaced for Phase 1:
  - `SIGNAL_MODEL.md` (1.2) must address the `voice-print.js` question before writing
  - `BUILD_AND_RELEASE.md` (1.5) must explicitly enforce `_tooling/` exclusion
- Next session: Phase 1.2 `SIGNAL_MODEL.md` (the IP doc, 4-6 hours estimated)

### 2026-05-17 — Open Questions table — 5 resolutions captured (in ROADMAP.md)
The Phase 3 table above has not been edited inline (file was concurrently modified). The resolutions are authoritative in `ROADMAP.md` "Open questions for Nathan" section:
- **#1 Pricing** ✅ Waitlist now + free + Pro later
- **#4 Privacy-preserving analytics** ✅ Opt-in aggregated telemetry IS the moat (uses `/api/corpus`)
- **#5 Retention strategy** ⏸️ Deferred until #1-4 are real
- **#10 Bus-factor** ✅ Push to public GitHub at `vajdos/cue-extension`
- **#11 Canonical surface** ✅ Desktop is canonical, extension is browser-only companion

Downstream implications for Phase 1 docs:
- `SIGNAL_MODEL.md` (1.2): still gated on the `voice-print.js` read in cue-desktop. Now scoped against the desktop as canonical.
- `BUILD_AND_RELEASE.md` (1.5): must document BOTH paths (desktop build via GitHub Actions, extension build via the new `scripts/build-store-package.ps1`). Public-repo push instructions land here.
- `PRIVACY_THREAT_MODEL.md` (1.6): MUST rewrite the privacy-claim copy section to address opt-in telemetry — "no upload BY DEFAULT, optional opt-in telemetry for users who consent." This is now the authoritative claim wording.
- `ARCHITECTURE.md` (1.3): position desktop as canonical, extension as companion. Diagram both data flows.
- `CHROME_WEB_STORE_REVIEW.md` (1.7): listing description re-pitches as "Cue lives on your computer" with the extension as the "browser-only companion."

5 Open Questions still pending: #2 support email, #3 ToS template, #6 sync v2, #7 onboarding UX, #8 notify-scripts location, #9 browser distribution (the last one was deferred; counted as 5 actively-open).

### 2026-05-18 — Phase 1.2 + 1.6 + GitHub-prep complete (single session)
- `SIGNAL_MODEL.md` (1.2) ✅ — the IP doc. Captures the model as-of v1.1.32 ship. Question-detection deferred to v1.1.33.
- `PRIVACY_THREAT_MODEL.md` (1.6) ✅ — privacy claim defense. Voice-print disclosed. Counterparty capture legal posture documented. Audit grep template captured.
- v1.1.32 build shipped to production (cue-pwa.vercel.app/dist/cue-1.1.32-store.zip).
- LICENSE (MIT) added.
- Cue-extension repo cleaned + committed (`e7a3f84`), remote configured, ready for push as soon as Nathan creates the empty public repo on GitHub.

Phase 1 progress: 1.1 ✅, 1.2 ✅, 1.6 ✅. Remaining: 1.3 (ARCHITECTURE.md), 1.4 (MODULE_GUIDE.md), 1.5 (BUILD_AND_RELEASE.md — gated on build script existing), 1.7 (CHROME_WEB_STORE_REVIEW.md), 1.8 (SUPPORT.md — gated on Open Q #2 + #3).
