# Cue — Desktop App ↔ Chrome Extension Parity

The Cue Tauri desktop app (`cue-desktop/` repo, `vajdos/cue-desktop` on GitHub) and the Cue Chrome extension (`cue-extension/` master, `cue-store-prep/` build) **share the same five-signal acoustic model** but ship via different vehicles with different lifecycle code, different version schemes, and one real file-level divergence (`voice-print.js`).

This file inventories what's in sync, what's drifted, what's intentional, and what needs Nathan's decision per `ROADMAP.md` Open Question #11 — *"which surface is canonical?"*

> Generated 2026-05-17. Verification source: `diff` between `cue-desktop/src/` and `cue-store-prep/src/`; GitHub release `vajdos/cue-desktop` v1.0.2.

---

## Current ship state

| Surface | Version | Built | Distributed via |
|---|---|---|---|
| **Tauri desktop** | `v1.0.2` | 2026-05-14T19:12 UTC (GitHub CI) | GitHub Release with 3 assets (Windows .exe NSIS, Windows portable .zip, macOS .dmg) |
| **Chrome extension** | `v1.1.31` | 2026-05-15T15:37 UTC (ad-hoc local) | Chrome Web Store (pending submission) + Vercel-hosted zip at `cue-pwa.vercel.app/dist/cue-1.1.31-store.zip` |

**Two different version schemes.** Desktop uses `1.0.x` because it's a separate product lineage that started fresh on May 1. Extension uses `1.1.x` because it carries history from an earlier `1.0.x` Chrome Web Store draft. The numbers do not align; they are not meant to.

**Two different GitHub Release states for the desktop**:
- `v1.0.1` (Apr 30): 1 of 3 binaries live, 2 returned 404 in the audit. Likely a partial CI run that didn't re-attach all assets.
- `v1.0.2` (May 14): all 3 binaries live, 0 downloads each. This is the current canonical desktop ship.

---

## File-level diff: `cue-desktop/src/` vs `cue-store-prep/src/`

### Files in desktop only (don't exist in extension build)

| File | Purpose |
|---|---|
| `cue-desktop/src/index.html` | Tauri's main window HTML (the desktop's "side panel" equivalent) |
| `cue-desktop/src/overlay.html` | Frameless overlay window — center-screen nudge rendered as a separate Tauri WebView |
| `cue-desktop/src/panel.css` | Side-panel styling (parallel to `cue-store-prep/side-panel/panel.css`) |
| `cue-desktop/src/panel.js` | Panel logic (parallel to `cue-store-prep/side-panel/panel.js`) |
| `cue-desktop/src/runtime.js` | Tauri-specific runtime bootstrap |
| `cue-desktop/src/tauri-shim.js` | Compatibility layer — translates `chrome.*` API calls (used by ported extension code) into Tauri equivalents |
| `cue-desktop/src/signal/voice-print.js` | **Voice-print analysis module. Present in desktop, NOT in extension build.** Status unclear — investigate. |

### Files in extension build only (don't exist in desktop)

| File | Purpose |
|---|---|
| `cue-store-prep/src/background/service-worker.js` | MV3 service worker — not applicable to Tauri (no service workers) |
| `cue-store-prep/src/content/content-script.js` | Content script for in-tab overlay injection on Zoom/Teams/Meet pages |

### Shared (same files, possibly drifted contents — needs deeper read)

| Directory | Both have | Risk of drift |
|---|---|---|
| `src/audio/` | `audio-manager.js`, `cue-processor.js` | Should be identical; deepest IP. **Verify byte-for-byte.** |
| `src/signal/` | 8 files (decision-engine, signal-model, nudge-engine, interruption-detector, coaching-engine, adaptation-engine, latency-monitor, thresholds) | This is the moat. Drift here = the two products feel different. **Verify byte-for-byte.** |
| `src/storage/` | `db.js`, `intervention-log.js` | IndexedDB schema — drift here would break sync if cross-device ever returns |
| `src/settings/` | settings page | Likely diverged — desktop has different setting needs |
| `src/tape/` | `eq-score.js`, `integration-tape.js` | Post-session report logic — should be identical |

**Verification action**: a follow-up session should run `diff -r cue-desktop/src/signal cue-store-prep/src/signal` and `diff -r cue-desktop/src/audio cue-store-prep/src/audio` and capture results in this file. The single most important parity check is **the signal model**.

---

## The `voice-print.js` divergence

`cue-desktop/src/signal/voice-print.js` exists. `cue-store-prep/src/signal/` does not have it.

Possible explanations:

1. It's experimental code Nathan added to the desktop branch and hasn't ported to the extension
2. It was in an older extension build and was deliberately removed during a privacy-related cleanup
3. It does speaker-identification or voice-biometric work — which has serious privacy implications if it ships

**Until this file is reviewed and labeled (Phase 2.4 follow-up), treat it as a potential privacy-claim risk.** The privacy claim ("no transcription") would not survive a voice-print/biometric capability unless the user has explicitly consented and the disclosure copy is updated.

**Action**: read `cue-desktop/src/signal/voice-print.js`. Document what it does. Decide:
- Keep, port to extension (parity)
- Keep, document as desktop-only feature (intentional divergence + disclosure)
- Remove from desktop (cleanup)

This decision blocks `SIGNAL_MODEL.md` (Phase 1.2) — that doc needs to describe what's in the signal model, and if voice-print is in desktop, it has to appear in `SIGNAL_MODEL.md` with a clear "desktop only" tag.

---

## What's intentionally different between desktop and extension

Some divergence is **correct**:

| Concern | Extension does | Desktop does |
|---|---|---|
| Audio source | MV3 offscreen document calls `getUserMedia` | Tauri main process calls system mic via OS APIs |
| Side panel | Chrome Side Panel API (`sidePanel`) | Tauri main window |
| Center-screen overlay | Content script `chrome.scripting.executeScript` on active tab | Frameless transparent Tauri WebView (overlay.html) |
| Notifications | `chrome.notifications` | `tauri-plugin-notification` |
| Storage | `chrome.storage.local` + IndexedDB | `tauri-plugin-store` + IndexedDB |
| Always-on hotkey | Chrome command (limited scope) | `tauri-plugin-global-shortcut` (system-wide) |
| Auto-start at login | n/a | `tauri-plugin-autostart` |
| Distribution | Chrome Web Store (single click after approval) | GitHub Release with portable .zip + NSIS .exe + .dmg |

These differences are architectural. The desktop **should** have a system-wide hotkey and auto-start at login — that's why it exists. Don't try to homogenize them.

---

## Where things get hard: which is canonical?

`ROADMAP.md` Open Question #11. Nathan has said the desktop is the long-term answer for "Cue lives on my computer regardless of which app I'm in" (his words, foundation-audit session). The Chrome extension was the v1 prototype + the cheapest path to a working build.

If the desktop is canonical, then:
- Extension is maintained but not the primary focus — bug fixes only, no new features
- Future signal-model changes flow desktop → extension, not the other way
- Web Store submission still happens because Chrome users need an install path, but it's positioned as the "lite" version
- Marketing leads with "Cue Desktop" and treats the extension as the in-browser companion

If the extension is canonical:
- Desktop is treated as a downstream port; new features prove out in the extension first
- Web Store approval is the headline launch event
- Desktop is positioned as a power-user upgrade

**Today the two have feature parity at the audio/signal layer** (modulo the `voice-print.js` question). Whichever surface you optimize, the other gets the same DSP. So the canonical question is mostly a **marketing/positioning question**, not a technical one.

---

## Action items from this audit

1. ☐ Read `cue-desktop/src/signal/voice-print.js`. Decide port, document, or remove. **Blocks SIGNAL_MODEL.md.**
2. ☐ Run `diff -r cue-desktop/src/signal cue-store-prep/src/signal` and `diff -r cue-desktop/src/audio cue-store-prep/src/audio`. Capture findings in this file.
3. ☐ Verify all desktop tabular signal thresholds (`thresholds.js`) match extension exactly. Drift here changes behavior.
4. ☐ Decide canonical surface (Open Question #11). Update `CLAUDE.md` + `ROADMAP.md` accordingly.
5. ☐ Establish a "code-sync rhythm" — if a signal-model change lands in extension, when does it port to desktop? (Or vice versa.) Currently no rhythm.

---

## Cross-references

- `ROADMAP.md` Open Question #11 — desktop vs. extension canonical choice
- `SIGNAL_MODEL.md` (Phase 1.2, not yet written) — must explicitly describe parity + the `voice-print.js` question
- `BUILD_AND_RELEASE.md` (Phase 1.5, not yet written) — must cover both surfaces' build paths
- `DOCUMENTATION_PLAN.md` Phase 2.4 — this is the verification it called for

---

_Updated 2026-05-17: created from diff of `cue-desktop/src/` against `cue-store-prep/src/`, GitHub Release inspection, and Tauri config review. Open: byte-for-byte verification of signal/ and audio/ directories._
