# Cue — Claude Code orientation

If you're a Claude Code session opening this repo for the first time, **read this file first**, then `ROADMAP.md`, then `DOCUMENTATION_PLAN.md`. That should take ≤ 5 minutes and orient you on what Cue is, what's in scope, what's broken, and where to start.

This file is the agent-bootstrap doc. Update it when something materially changes about how a future agent should approach the codebase. Don't fork it.

---

## What Cue is

Cue is a **Manifest V3 Chrome extension** + **iPhone PWA** + **Tauri desktop app** that measures five subtle acoustic behaviors during video calls — response gap, within-turn pause, energy mirroring, interruption count, pace — on-device, with no recording, no transcription, no upload. The product surface the user sees: a calm side panel ("Cue is listening") + a center-screen overlay that fires direct 1–3 word nudges when a signal drifts ("Slow down", "Quieter", "Pause"), escalating intensity if the drift persists.

The privacy claim is **load-bearing**: it's in `README.md`, the Chrome Web Store listing, and the marketing site. Every change to the codebase must preserve it. See `PRIVACY_THREAT_MODEL.md` when it exists, and the verdict in `ROADMAP.md`'s top section in the meantime.

---

## Where things live

This repo (`cue-extension/`) is the **master**. The build that ships to the Chrome Web Store is derived from it.

```
cue-extension/                 ← master repo (you are here)
├── manifest.json              ← MV3 manifest. NOTE: still has `identity` + `oauth2` placeholder. The build strips both.
├── src/
│   ├── audio/                 ← AudioWorklet (cue-processor.js) + audio-manager.js
│   ├── signal/                ← THE IP. Thresholds, decision engine, nudge engine, calibration.
│   ├── storage/               ← IndexedDB (db.js) + intervention-log.js (chrome.storage.local wrapper)
│   ├── background/            ← Service worker. Lifecycle, message routing, offscreen doc management.
│   ├── content/               ← Content script. Call-state detection on zoom.us / teams.microsoft.com / meet.google.com.
│   ├── settings/              ← Settings page. CSV export, threshold tuning.
│   ├── tape/                  ← Per-session score + integration tape rendering.
│   └── transcription/         ← DELETED 2026-05-15 (Web Speech API → Google cloud ASR). Do not reintroduce without consent UI.
│   └── calendar/              ← DELETED 2026-05-15 (googleapis.com fetch). Do not reintroduce without identity + oauth2 in manifest.
├── side-panel/                ← Chrome Side Panel UI (panel.html, panel.css, panel.js)
├── offscreen/                 ← MV3 offscreen doc for sustained getUserMedia
├── tape/                      ← Post-session integration tape page (tape.html, tape.js, tape.css)
├── verify/                    ← Runtime self-check page (NOT a test runner — see below)
├── onboarding/                ← Standalone first-run onboarding tab. CURRENTLY NOT IN SHIPPING BUILD.
├── notify_*.py, send_steve_*.py ← Tester-notification tooling. NOT FOR THE BUILD. Excluded by `scripts/build-store-package.ps1`.
├── ROADMAP.md                 ← Six-phase business strategy. Read this second.
├── DOCUMENTATION_PLAN.md      ← Tactical brief for documentation work. Read this third.
└── README.md                  ← Product overview + privacy claim. Public-facing.
```

Adjacent (NOT in scope for most extension work, but referenced):

- **`C:\Users\NathanVajdos\Downloads\cue-store-prep\`** — the canonical *build* directory. Mirror of `cue-extension/` with `identity` + `oauth2` stripped from the manifest, `src/calendar/` and `src/transcription/` deleted, and the four `/api/sync` / `/api/test-haptic` fetches removed (2026-05-15 privacy cleanup). This is what zips to the Chrome Web Store. **Future builds must regenerate this from `cue-extension/` via a real build script — see `ROADMAP.md` Phase 1.**
- **`C:\Users\NathanVajdos\Downloads\cue-pwa-git\`** — the marketing PWA repo (`cue-pwa.vercel.app`). Separate codebase. Shares no code with the extension.
- **`C:\Users\NathanVajdos\Downloads\cue-desktop\`** — the Tauri desktop app. Mirror of the extension's `src/` with a Tauri shim. Separate ship cadence. See `DOCUMENTATION_PLAN.md` 2.4 for the parity question.

---

## The runtime, in one paragraph

User clicks the Cue toolbar icon → Chrome opens the side panel (`side-panel/panel.html`) → user picks "Coach me" or "Quiet" → `panel.js` sends a message to the service worker (`src/background/service-worker.js`) → service worker spawns an offscreen document (`offscreen/offscreen.html`) → offscreen doc calls `getUserMedia` → audio stream feeds an `AudioContext` → `AudioWorkletNode` running `src/audio/cue-processor.js` extracts per-frame features (RMS, zero-crossing rate, spectral centroid, spectral flatness, voice activity) → features stream to the main thread of the offscreen doc → `src/signal/signal-model.js` calibrates against the user's baseline (warmup → p5/p95 → 0–100 score with EMA smoothing) → `src/signal/decision-engine.js` runs the state machine (PAUSE / ASK_QUESTION / CONTINUE) → `src/signal/nudge-engine.js` decides whether to fire a nudge under cooldown/warmup gates → message back to the side panel + content script → side panel updates calm state, content script renders the center-screen overlay via `chrome.scripting.executeScript` on the active Zoom/Teams/Meet tab → on session end, `src/storage/db.js` writes the session frames to IndexedDB and `src/tape/integration-tape.js` builds the post-session report at `tape/tape.html`. No network calls anywhere in this path. **Verify with `verify/verify.html`** — that's the user-facing privacy-verifiability surface.

For depth, read `ARCHITECTURE.md` when it exists (Phase 1.3 of `DOCUMENTATION_PLAN.md`) and `SIGNAL_MODEL.md` (Phase 1.2).

---

## The 8 files a successor should read first

In order. If you read these 8 files, you understand the system end-to-end.

1. `manifest.json` — what the extension can do
2. `src/background/service-worker.js` — lifecycle, message routing
3. `offscreen/offscreen.js` — audio capture + worklet wiring
4. `src/audio/cue-processor.js` — the AudioWorklet (DSP per frame)
5. `src/signal/thresholds.js` — every constant the product is tuned against
6. `src/signal/signal-model.js` — baseline calibration + scoring
7. `src/signal/decision-engine.js` — PAUSE / ASK_QUESTION / CONTINUE
8. `side-panel/panel.js` — the primary UI surface

After those, branch out per the question you're trying to answer.

---

## What's in scope vs. out of scope for "Cue extension work"

**In scope:**
- Any file under `cue-extension/` master OR `cue-store-prep/` build
- The five-signal acoustic model, calibration, decision engine, nudge engine
- Chrome Web Store submission packet (`CHROME_STORE_LISTING.md`, etc.)
- The PWA pages that DIRECTLY serve the extension's install flow (`cue-pwa-git/install.html`, `cue-pwa-git/dist/*.zip`)

**Out of scope (separate concerns, separate sessions):**
- The Tauri desktop app at `cue-desktop/` — separate repo, separate ship cadence, separate roadmap. May share signal-model code but treat as a downstream consumer.
- The marketing PWA (`cue-pwa.vercel.app`) beyond the install flow — content strategy, pricing-page wording, blog posts.
- The Regis AI Hub project at `C:\Users\DanielSenneff\Regis Energy\...\00_DC AI` — entirely unrelated. Nathan's coworker's project. Different domain (data-center development).
- Apple Watch + cross-device sync v2 — removed 2026-05-15, queued for future work per `ROADMAP.md` Open Question #6.

If a request crosses these boundaries, flag the scope question explicitly. Don't silently expand.

---

## What's currently broken (don't pretend it isn't)

These are real issues. They're in `ROADMAP.md` as Top Risks #1–7 and Phase-1 work. If a user reports one of these and you're an agent picking up the work, this is your shortlist:

1. **Chrome mic permission UX is broken.** Standard "Allow microphone?" prompt doesn't appear for offscreen-doc `getUserMedia`. Users have to find `chrome://extensions` → 3-dot menu → "view web permissions" → flip mic from "ask" to "allow". David and Andy hit this 2026-05-15. See Teams chat search for full feedback.
2. **iPhone PWA tape page is a dead-end.** No "Back to home" button after session ends; user must restart the PWA. `tape/tape.html` / iPhone-specific navigation bug.
3. **Sessions don't always save.** IndexedDB write race condition or progress.html load race — surfaced by David 2026-05-15. `src/storage/db.js`.
4. **Nudges come through as full Chrome OS notifications with vibration.** Intended to be subtle. The OS-notification fallback (when user is in a non-Chrome window) is firing inside Chrome too. `service-worker.js` `chrome.notifications.create` callsites.
5. **`activeTab` permission is declared but unused.** 0 usage sites in shipping JS. Drop or justify per `ROADMAP.md` Phase 1.
6. **`scripting` permission is minimal usage** — 2 sites. Likely redundant with declared `content_scripts`.
7. **Master `manifest.json` still has `identity` permission + `oauth2` placeholder.** Build script (when it exists) must strip both. Until then, manual.
8. **No tests, no CI** — `verify/verify.js` is a user-facing one-shot, not a regression harness.
9. **Theatrical pricing.** The `$69/yr Founding Member` button (`side-panel/panel.html:161`) opens a PWA page with no payment processor. Clicking lands on a mailto. Real bug or intentional waitlist UX? See `ROADMAP.md` Open Question #1.

---

## Conventions

### Code

- Plain JS, no bundler, no transpile. Load Unpacked in Chrome for dev.
- No npm dependencies in the extension itself. The repo has no `package.json`.
- File-header comments are the de-facto module docs. Update them when you change the file.
- Inline comments use `// v1.X.Y — what changed` to provide an audit trail.
- All new files MUST be in the shipping bundle OR explicitly excluded by the build script. No dead code in the zip.

### Privacy claim — non-negotiable

- Before any commit that touches network code: run the audit grep template (see `PRIVACY_THREAT_MODEL.md` when it exists; until then, see Stage 2 of `ROADMAP.md`).
- No new `fetch()` to external URLs without explicit consent UI + updated `README.md` + updated `CHROME_STORE_LISTING.md`.
- No third-party scripts, fonts, analytics, SDKs, error reporters, or update-check endpoints.
- No `chrome.storage.sync`. Only `chrome.storage.local` + IndexedDB.
- No Web Speech API. No SpeechRecognition. (Both routed to Google cloud ASR on Chrome.)
- No `chrome.identity` + no `oauth2` block in the **build** manifest (master can have placeholder, build strips).

### Versioning

- Manifest `version` is `MAJOR.MINOR.PATCH`. Current: see `cue-store-prep/manifest.json`.
- Each ship increments PATCH. MINOR for material UX changes. MAJOR for foundational shifts.
- Every version-bumped build produces TWO zips in `cue-pwa-git/dist/`:
  - `cue-store-submission.zip` — "latest" pointer
  - `cue-<version>-store.zip` — version-pinned, immutable, archived
- `cue-pwa-git/dist/version.json` is the source of truth for what's in production.

### Docs (this section)

- Match the voice of `README.md`. Terse, declarative, no marketing.
- Update `DOCUMENTATION_PLAN.md`'s Progress log when a doc lands.
- Don't write docs speculatively. If you don't know something, say `TODO: verify`.
- Cross-reference instead of duplicating.

---

## Useful entry points for common tasks

| If you want to… | Start at… |
|---|---|
| Understand the signal model | `src/signal/thresholds.js`, then `signal-model.js`, then `decision-engine.js` |
| Change a nudge's text or intensity | `src/signal/nudge-engine.js` + `side-panel/panel.js` `showCenterScreenOverlay` |
| Debug the mic-permission flow | `offscreen/offscreen.js` `getUserMedia` callsite + `side-panel/panel.js` `showMicFixHelp` |
| Add or remove a permission | `manifest.json` + the build script's strip rules + `CHROME_WEB_STORE_REVIEW.md` justifications |
| Test that the privacy claim still holds | Audit grep template in `ROADMAP.md` Phase 0 |
| Ship a new version | Follow the recipe in `BUILD_AND_RELEASE.md` when it exists. Until then: bump `manifest.json` → run `build-zips.py` → copy to `cue-pwa-git/dist/` → `vercel --prod`. |
| Run the user-facing verify page | Load the extension, open `chrome-extension://<id>/verify/verify.html` |
| Find David / Andy / Mark's recent feedback | Microsoft Teams chat search via the connected MCP. Most recent thread: 2026-05-15. |

---

## Open questions you should NOT decide for Nathan

These are in `ROADMAP.md` as Open Questions #1–11 and reproduced in `DOCUMENTATION_PLAN.md`. If you hit one of these while doing work, flag it explicitly and move on. Don't guess.

Top of the list: pricing model, support-email domain, ToS/Privacy template, sync v2 reintroduction, browser distribution priority, bus-factor mitigation, desktop-vs-extension canonical choice.

---

## Session etiquette

- Read this file + `ROADMAP.md` + `DOCUMENTATION_PLAN.md` before doing anything else.
- When you finish a unit of work, append a dated entry to the Progress log in `DOCUMENTATION_PLAN.md` (for doc work) or `ROADMAP.md` (for phase work).
- Don't expand scope mid-session. If you spot something out of scope, write it down as an Open Question in `ROADMAP.md`.
- Don't replace any of these living docs. Refine in place.
- Don't ship code that breaks the privacy claim. If you're not sure, audit; if still not sure, stop.

---

_Updated 2026-05-15: created during the foundation-audit session that also produced `ROADMAP.md` and `DOCUMENTATION_PLAN.md`._
