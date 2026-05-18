# Cue iPhone PWA — Gap Audit (Step 7 of moat-defense sequence)

**Audited:** 2026-05-18 against extension v1.1.33
**Repo:** `C:\Users\NathanVajdos\Downloads\cue-pwa-git\`
**Live URL:** https://cue-pwa.vercel.app
**Audit owner:** generated alongside v1.1.33 ship; full multi-surface parity is a follow-up workstream.

---

## Executive summary

The PWA is approximately **two versions behind** the Chrome extension. It is missing:
- All of the v1.1.32 work (voice-print speaker filtering, new context profiles, install-time consent UI, counterparty capture)
- All of the v1.1.33 work (five new acoustic signals, corpus opt-in, F0 estimator, sub-frame envelope)

The PWA also has **iPhone-specific limitations** that no amount of porting will fully eliminate without a native iOS app. These are flagged below so the decision to invest in native iOS (versus continuing to upgrade the PWA) can be made with eyes open.

---

## Inventory: what exists vs. extension v1.1.33

| Component | PWA file | PWA state | Extension v1.1.33 state | Gap |
|---|---|---|---|---|
| AudioWorklet processor | `app/audio/cue-processor.js` | 107 lines, RMS/ZCR/VAD only | 218 lines (+ F0 autocorrelation + 8-sub-frame envelope) | **2 versions behind.** Same baseline as extension's pre-v1.1.33. Port is mechanical. |
| Audio manager | `app/audio/audio-manager.js` | Present | Present | Likely small diff — both compute spectral centroid/flatness via AnalyserNode. Needs side-by-side diff. |
| Signal model | `app/signal/signal-model.js` | 464 lines | 842 lines | **Missing all 5 new detectors** (F0-SD, rate-CV, laughter, backchannel, turn-dominance) plus state + return-payload extension. ~378 lines to add. Port is mechanical. |
| Thresholds | `app/signal/thresholds.js` | 189 lines | 244 lines | Missing 19 new constants for the v1.1.33 signal block. Port is mechanical. |
| Voice-print | (not present) | **Missing entirely** | `src/signal/voice-print.js` | Voice-print module from v1.1.32 was never ported to PWA. Result: PWA cannot filter ambient voices from the user's signal measurements. |
| Decision / nudge / interruption / coaching / adaptation engines | `app/signal/*.js` | All present | All present | Likely small drift; needs side-by-side diff per file. Lower priority — these are downstream consumers of signal-model output. |
| Onboarding consent screen | (not present in `app/`) | **Missing entirely** | `onboarding/onboarding.html` | PWA install path is at `/install` and `/install.html`, which is a marketing install flow, not the consent screen the extension uses. **No corpus disclosure on the PWA today.** |
| Corpus opt-in wiring | (not present) | **Missing entirely** | `src/background/service-worker.js` + `onboarding/onboarding.js` + `src/settings/settings.js` | PWA does not currently transmit corpus data at all — neither to opt-in users nor anyone. |
| Settings page | `app/settings/` | Present | Present | Drift unknown; needs side-by-side. PWA settings does NOT currently have the corpus opt-out toggle. |
| Profile picker (Interview / Hard-convo) | unknown | Probably missing the two new v1.1.32 profiles | Has all 7 profiles | Needs UI audit of `app/panel.js`. |
| Browser shim | `app/browser-shim.js` | Present — translates chrome.* to web equivalents | N/A | This is the PWA's analogue to `tauri-shim.js`. Functionally important — it's the layer that lets the same JS code run in the browser. |
| Tape (post-session) | `app/tape/` | Present | Present | **Known bug per CLAUDE.md:** "iPhone PWA tape page is a dead-end. No 'Back to home' button after session ends; user must restart the PWA." Not fixed yet. |

---

## iPhone-specific limitations the port cannot fix

Even if every byte of the extension's v1.1.33 code is mirrored to the PWA's `app/` folder, Safari's PWA execution model imposes constraints that only a native iOS app can lift. These are structural to the platform, not gaps in the codebase.

| Limitation | Impact on Cue | Workaround |
|---|---|---|
| **Background audio is severely throttled** when the PWA is not the foreground tab. Safari will pause `AudioContext` after the user switches apps or locks the screen. | A Cue session cannot run while the user is in Zoom on the same iPhone. The user would have to keep Cue in foreground on a second device (laptop). | Native iOS app gets full background-audio entitlement. |
| **No tab capture or system audio loopback.** Safari does not expose either API on iOS. | Counterparty acoustic capture (the v1.1.32 feature) is **permanently unavailable** in the PWA. Source: "both" cannot work on iPhone PWA. | Native iOS app could use `AVAudioEngine` system tap (with user permission) or a virtual audio source. |
| **No persistent service-worker background tasks.** PWA service workers on iOS run only briefly during page events. | The "always listening" model the extension uses doesn't work on iPhone PWA. User must explicitly start a session each time. | Native iOS app gets background processing entitlement. |
| **Apple Watch integration is impossible from a PWA.** WatchKit / SwiftUI is iOS-native only. | Haptic notifications to Watch (the v2 sync feature) requires native iOS app. | Native iOS app — out of scope until v2.0. |
| **No `chrome.notifications` API.** PWA on iOS 16.4+ supports Web Push notifications, but only if installed to home screen first and only after manual permission flow. | Cue nudge fallback to OS notification is unreliable on iPhone PWA. | Native iOS app — proper push notification entitlement. |
| **No file system access.** PWA cannot persist large blobs (e.g., voice-print samples beyond IndexedDB quota). | Voice-print storage works within IndexedDB; otherwise no impact on Cue today. | N/A — IndexedDB is sufficient. |

---

## Recommended porting order (when v1.1.34 is shipped to extension first)

The right sequence is: extension → desktop (already done) → PWA. The PWA is the trailing surface because most of the audit's gaps are downstream of decisions already made for the extension.

### Phase 1 — Bring PWA to v1.1.32 parity (1 week)

1. Port `voice-print.js` from extension to `cue-pwa-git/app/signal/voice-print.js`.
2. Add the two new context profiles (Interview, Hard conversation) to the PWA's profile picker.
3. Add the install-time consent screen — adapt `onboarding/onboarding.html` for the PWA install flow at `/install`.
4. Fix the tape-page dead-end navigation bug.

### Phase 2 — Bring PWA to v1.1.33 parity (1 week)

5. Mirror `cue-processor.js` v1.1.33 (F0 + sub-frame envelope).
6. Mirror `thresholds.js` v1.1.33 (19 new constants).
7. Mirror `signal-model.js` v1.1.33 (5 new detectors).
8. Add corpus opt-in disclosure to PWA install flow with Option B (pre-checked + disclosure).
9. Add settings.html corpus opt-out toggle to PWA settings.

### Phase 3 — Build the iOS-specific delta (3–6 months, deferred)

10. Native iOS app via Swift + AVAudioEngine, sharing signal-model JS through JavaScriptCore OR a pure Swift port.
11. Apple Watch companion app.
12. Background-audio entitlement + proper push notifications.
13. App Store submission.

Phases 1 and 2 unblock the PWA's role as the marketing site's install path. Phase 3 unblocks "Cue on iPhone is a real product" — that's a bigger decision that should be made after the extension + desktop are at v1.2 stability and revenue is starting to come in.

---

## Critical PWA-specific issues to fix before next ship

Independent of the parity question, two PWA-specific bugs are in the user-feedback record and should be fixed in the next PWA deploy:

1. **Tape-page dead-end** (CLAUDE.md, MEMORY.md) — after a session ends, no "Back to home" button. User has to manually navigate back. ~30 minutes of work in `app/tape/tape.html` + `app/tape/tape.js`.
2. **Sessions don't always save** (CLAUDE.md "What's currently broken" item #3) — David's 2026-05-15 feedback. Likely IndexedDB write race condition in `app/storage/db.js` or page-load race in `app/tape/progress.html`. ~2 hours to diagnose + fix.

These are not v1.1.33 work; they are pre-existing bugs that block PWA quality regardless.

---

## What the audit produces for the moat-defense roadmap

- **Porting v1.1.32 + v1.1.33 to PWA is ~2 weeks of focused work** once the extension's v1.1.34 stabilizes. The code is portable JS; the diffs are mechanical.
- **iOS-native app is a 3–6 month investment** if Nathan decides Cue on iPhone is a v2 priority. Recommend deferring this decision until extension revenue clarifies the iPhone-market hypothesis.
- **The PWA is currently a marketing surface plus a backup install path for users who want to try Cue without installing the extension.** Don't market it as a first-class iPhone product until Phase 3 ships.
- **The two pre-existing PWA bugs are the highest-leverage fixes for current PWA users.** Tape-page navigation + session-save race. Fix these before doing any other PWA work.

---

_Updated 2026-05-18 as Step 7 of the seven-step moat-defense execution sequence. Produced alongside the v1.1.33 desktop + Edge/Firefox + provisional patent work in the same session._
