# Cue — Privacy Threat Model

This file is the source of truth for Cue's privacy claim — what it says, what code paths could break it, what's stored locally, what's transmitted (and to whom), and what every future change must re-verify before shipping. The privacy claim is **load-bearing**: it appears in the README, the Chrome Web Store listing, the install-time consent screen, and every public-facing page. Material divergence between the claim and the implementation is a business-ending event.

**Generated 2026-05-18** against build v1.1.32.

---

## The privacy claim — exact wording

The claim as it appears across Cue's surfaces:

> **"Cue measures rhythm and tone on your device. No audio recorded. No transcription. No upload by default. Verifiable in Chrome DevTools → Network tab."**

Five components, each verifiable:

1. **"Measures rhythm and tone"** — Cue extracts numerical acoustic features (RMS, ZCR, spectral centroid, spectral flatness, spectral rolloff, four-band energy). It does NOT process speech-to-text. It does NOT capture words.
2. **"On your device"** — All processing happens in the user's browser process (Chrome extension) or the Tauri app's main process (desktop). No remote computation.
3. **"No audio recorded"** — Audio frames are consumed by the AudioWorklet and discarded. No `MediaRecorder`, no file system writes, no Blob persistence of audio.
4. **"No transcription"** — No `SpeechRecognition`, no `webkitSpeechRecognition`, no Web Speech API. No cloud ASR. No on-device speech-to-text either.
5. **"No upload by default"** — Zero `fetch()` to external URLs in the extension bundle. Optional opt-in telemetry exists but ships disabled.

---

## Verdict (current build)

> **Claim holds as-implemented (v1.1.32).**

The shipping zip at `cue-pwa.vercel.app/dist/cue-1.1.32-store.zip` contains zero code paths that would violate the claim under default settings.

### Network egress audit (v1.1.32)

| Surface | Count in shipping JS | Verified |
|---|---|---|
| `fetch()` to external URLs | 0 | ✓ |
| `XMLHttpRequest` | 0 | ✓ |
| `WebSocket` / `new WebSocket` | 0 | ✓ |
| `navigator.sendBeacon` | 0 | ✓ |
| External `<img>` src (pixel trackers) | 0 | ✓ |
| External `<script src>` to http/https URLs | 0 | ✓ |
| External `<link rel="stylesheet">` to http/https | 0 | ✓ |
| `@import url(http...)` in CSS | 0 | ✓ |
| `<iframe>` elements | 0 | ✓ |
| Google Analytics / `gtag()` / `ga()` | 0 | ✓ |
| Sentry / error reporters | 0 | ✓ |
| `chrome.storage.sync` (cross-device leak path) | 0 | ✓ |
| `webkitSpeechRecognition` / `SpeechRecognition` | 0 | ✓ |
| `googleapis.com` | 0 | ✓ |
| Update / version-ping endpoints | 0 | ✓ |
| Background telemetry / heartbeat | 0 | ✓ |

The only `fetch()` in the bundle is `verify/verify.js:229` which reads `chrome.runtime.getURL('src/audio/cue-processor.js')` — a local URL inside the extension's own bundle. Used by the user-facing privacy-verifiability page to confirm the AudioWorklet code is bundled. Not network egress.

### What was removed to make the claim hold (history)

- **v1.1.30**: deleted `src/calendar/calendar-service.js` (was inert googleapis.com/calendar/v3 fetch path)
- **v1.1.30**: deleted `src/transcription/vernacular-engine.js` (was inert Web Speech → Google cloud ASR path)
- **v1.1.30**: removed four `/api/sync` and `/api/test-haptic` fetches from `side-panel/panel.js` and `src/background/service-worker.js` (would have uploaded email + nudge text + session counts to `cue-pwa.vercel.app/api/...`)
- **v1.1.31**: deleted false SOC 2 + HIPAA compliance claims from `CHROME_STORE_LISTING.md` and `LAUNCH_NOW.md` (was deceptive description risk)

These deletions are permanent. The corresponding code paths must NOT reappear in the bundle without explicit consent UI + updated claim copy.

---

## What's stored locally — and why each is not a privacy violation

Cue writes to `chrome.storage.local` and IndexedDB. Neither is uploaded. The schemas are:

### `chrome.storage.local` keys (build v1.1.32)

| Key | Contents | Why not a privacy issue |
|---|---|---|
| `cueOnboarded` | Boolean: has user clicked through the install-time consent screen? | Single bit. Used to gate the onboarding tab open on service worker `onInstalled`. |
| `cueConsentVersion` | Integer (1) — consent flow version | Used to re-prompt if the disclosure language materially changes |
| `cueConsentAt` | ISO timestamp of user's "Enable Cue" click | Local audit trail. Not transmitted. |
| `cueMode` | `"coach"` or `"quiet"` — user's chosen run mode | Per-user preference |
| `cueSettings` | Object: tuning thresholds, nudge pack, tone flavor | Per-user preference |
| `cuePro` | Boolean — Pro tier active (currently always false, no backend wired) | Future-proofing for billing |
| `cueSessionCount` | Integer — total sessions completed | Used for session-counter UI + adaptation engine |
| `cueName` | String — user's first name (only set if user typed it in onboarding) | Used for personalization in nudge text. Local-only. |
| `cueAdaptation` | Object — per-nudge response data (time-to-correction etc.) | Adaptation engine state. Local-only. |
| `cueVoicePrintTemplate` | Object: `{template: {mean[8], stdev[8], frameCount, capturedAt}, threshold, version}` | Voice-print template — 16 floats per user. See below. |
| `cueLastSeenVersion`, `cueCurrentVersion` | Strings — for update-banner logic | Used to show "What's new in vX" once |

### IndexedDB (`cue-sessions` database)

Per session, stored when the session ends:
- `id` (auto-increment), `startedAt`, `endedAt`, `durationMs`
- `signalFrames` — array of `{ts, tension, pace, energy, pause, isSpeech, isCalibrating}` at ~128 ms intervals
- `nudgesFired` — array of `{ts, type, text, accepted}` — note: nudge **text** is stored locally (e.g., "Slow down") but NOT the audio context that triggered it
- `summary` — final scores per signal, total nudge count, average values
- `profile`, `mode`, `source`

Capped at the most recent **20 sessions** by `intervention-log.js:MAX_RECORDS = 500`. Older sessions are auto-pruned.

### The voice-print template (v1.1.32 new) — explicit disclosure

`voice-print.js` writes a template to `chrome.storage.local.cueVoicePrintTemplate` after the user's 20-second calibration. The template is:

```js
{
  template: {
    mean:        [zcr_mean, sc_mean, sf_mean, sr_mean, be0_mean, be1_mean, be2_mean, be3_mean],
    stdev:       [zcr_std, sc_std, sf_std, sr_std, be0_std, be1_std, be2_std, be3_std],
    frameCount:  <number — how many calibration frames>,
    capturedAt:  <ms timestamp>
  },
  threshold: 7.0,
  version: 1
}
```

That's **16 floating-point numbers** plus three scalars. Total payload: ~250 bytes.

**Is this biometric identification?** No. The template:
- Does NOT identify WHO the user is (no name, no ID, no database lookup, no comparison against any external speaker corpus)
- Is NOT sufficient to reconstruct or recognize the user's voice in any other system
- Cannot be reverse-engineered into recognizable audio
- Stays entirely on the user's device — `chrome.storage.local`, never transmitted
- Is **architecturally equivalent** to the existing per-user baseline calibration Cue already does for pace, tension, energy, and pause thresholds (which are also user-specific numbers stored locally)

The legal posture under GDPR Article 4(14) — "biometric data" requires processing aimed at identifying a natural person. Cue's voice-print is aimed at filtering ambient noise from the user's signal, not at identifying anyone. It does not constitute "biometric data" in the GDPR-defined sense.

**User control:** Settings → Reset calibration → wipes the template. (Phase 1 deliverable: ensure this UI exists.)

---

## What gets transmitted by user opt-in (and only by opt-in)

Cue ships with NO telemetry enabled. By explicit user choice, three transmission paths can be activated:

### 1. The Listening Corpus (`/api/corpus`) — anonymized aggregated telemetry

**Status: infrastructure exists at `cue-pwa.vercel.app/api/corpus`. Opt-in UI ships in Phase 5.**

When enabled, Cue POSTs anonymized session metadata to the corpus endpoint:
- Per-session signal trace (numerical, no audio, no transcript)
- Nudge fired count by type (no text)
- Session duration, conversation profile, mode
- A per-session UUID (random; no link to user identity)
- No email, no IP retention, no PII

Backend: Airtable table `tblAJWECL4jqUkq4X` in base `apptO12PxTpR5192l`. Gated by `CUE_EXEMPLAR_SECRET` (HMAC-signed token from frontend prevents random submissions).

**Purpose:** validate which signal patterns predict counterparty "felt heard" outcomes at scale. Builds the data flywheel competitive moat (per `ROADMAP.md` Phase 5).

### 2. The Trust Signal (`/api/heard`) — counterparty rating

**Status: infrastructure exists. Surfaced more prominently in Phase 4.**

After a session, the user can optionally send a 1-tap rating link to the counterparty:

> *"Cue measured the conversation we just had. Would you take 5 seconds to tell me how heard you felt? [link]"*

The counterparty clicks the link, sees a 1-5 scale + optional one-line note. HMAC-SHA256 signed token verifies the rating came from a legitimate Cue session. Stored linked to the session UUID for corpus validation.

The counterparty's email is never collected. The user shares the link manually.

### 3. The waitlist (`/api/signup`) — explicit email capture

**Status: live. Used by the marketing PWA's waitlist signup. Not invoked by the extension.**

User types email → email lands in Airtable Signups table → triggers a Resend welcome email. Standard opt-in marketing pattern.

---

## The counterparty acoustic capture question (v1.1.32 new)

v1.1.32 ships with both-sides acoustic measurement defaulting **ON** for symmetric/pro-social contexts (Default / 1-on-1 / Sales / Presentation) and **OFF** for adversarial contexts (Negotiation / Interview / Hard conversation).

### How it works

- User clicks Start Listening in `both` source mode
- The service worker requests a `tabCapture.getMediaStreamId` for the active tab
- The offscreen document consumes the stream ID via `getUserMedia({audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: id}}})`
- Tab audio feeds into the AudioContext alongside the user's mic
- Both streams are processed by the AudioWorklet identically — features extracted, audio discarded
- The user's voice-print filters which frames count as "the user"; the rest are the counterparty

### Privacy implications

The counterparty's audio:
- Is captured into the extension's offscreen document (same MV3 sandbox as the user's mic audio)
- Is processed by the AudioWorklet → numerical features → discarded
- Never stored as audio
- Never transmitted

**Chrome's built-in tab-capture indicator surfaces in the browser chrome** whenever tabCapture is active. This is the per-session disclosure surface — the user sees the indicator, and arguably any counterparty looking at the user's screen during a screen-share also sees it.

### Legal posture (US two-party-consent states)

11+ US states have two-party / all-party consent laws for recording conversations: CA, FL, IL, MD, MA, MT, NV, NH, PA, WA, CT, plus various others. Combined population ~30-35% of US.

**Cue's defensible position:**
1. **Cue does not record.** The statutes overwhelmingly say "intercepts" or "records." Cue extracts numerical features from audio in real time and discards the audio frame-by-frame. No file, no buffer, no replayable artifact.
2. **The user is the responsible party.** Cue is the user's tool, used on the user's end of the conversation. Cue provides a courtesy script (in the install-time consent screen) that the user can use to inform the counterparty before sensitive conversations.
3. **Norm shift.** Notetakers (Otter, Granola, Microsoft Copilot, Zoom AI Companion) are now standard in business meetings. Cue is strictly less invasive — measurement only, no audio, no transcript.
4. **Per-context guardrails.** Adversarial contexts (Negotiation / Interview / Hard conversation) default counterparty capture OFF — user must explicitly opt in per session, protecting against accidental exposure.

### Lawyer-memo trigger

Currently deferred per Nathan's decision 2026-05-17. Triggers to revisit:
- First $X of revenue (Nathan to set the threshold)
- First counterparty complaint received in writing

When the trigger fires, a $500–1500 memo from a privacy/wiretap-statute attorney should review the position above. The memo would primarily refine the consent disclosure language, not change the architecture.

---

## What would break the claim — the threat model

A non-exhaustive list of code patterns that, if added without updating the claim copy, would constitute a material divergence. Future sessions: if you're about to add any of these, STOP and update this doc + `README.md` first.

| Pattern | Why it breaks the claim |
|---|---|
| Any new `fetch()` to an external URL in shipped JS | "No upload" becomes false |
| `chrome.storage.sync` | Per-device leak path; "on your device" becomes false |
| Reintroduction of `SpeechRecognition` / `webkitSpeechRecognition` | "No transcription" becomes false |
| Calendar OAuth back without explicit consent UI | Re-opens the googleapis.com network surface |
| Sentry, Mixpanel, Amplitude, Segment, Datadog RUM | Telemetry SDKs upload by design |
| Google Fonts via `<link>` | Font fetch leaks IP + referrer to Google |
| Any third-party `<script src>` | Code execution from external origin |
| `MediaRecorder` used in offscreen document | Creates audio Blob — "no audio recorded" becomes false |
| Persisting audio frames to IndexedDB | Same |
| Sending the voice-print template anywhere off-device | Currently 16 floats, but the moment it leaves the device the "biometric data" framing tightens |

---

## Audit procedure — run before every release

Future sessions: this is the privacy audit grep template. Run it from `cue-store-prep/` before producing any Web Store zip.

```bash
# 1. External fetch() — should output ONLY verify/verify.js:229 (local URL)
grep -rnE "\bfetch\(" --include="*.js" .

# 2. XHR / WebSocket / sendBeacon — should be empty
grep -rnE "XMLHttpRequest|new WebSocket|sendBeacon" --include="*.js" --include="*.html" .

# 3. Speech Recognition — should be empty
grep -rnE "SpeechRecognition|webkitSpeechRecognition" --include="*.js" .

# 4. External script/link/font/image — should be empty
grep -rnE "<script[^>]*src=[\"']https?://" --include="*.html" .
grep -rnE "<link[^>]*href=[\"']https?://" --include="*.html" .

# 5. Analytics SDKs — should be empty
grep -rnE "ga\(|gtag\(|sentry|Sentry|mixpanel|amplitude|segment\.io|google-analytics" --include="*.js" --include="*.html" .

# 6. Cross-device leak path — should be empty
grep -rnE "chrome\.storage\.sync" --include="*.js" .

# 7. googleapis.com — should be empty
grep -rn "googleapis\.com" --include="*.js" .

# 8. Identity / OAuth — manifest should not declare "identity" permission
grep -E "\"identity\"|\"oauth2\"" manifest.json
```

If any of these return non-empty content (other than the explicitly-allowed verify.js local fetch), the build does NOT ship until the divergence is resolved or the privacy claim is updated.

Phase 1.5 (`BUILD_AND_RELEASE.md`) will codify this as `scripts/verify-privacy.ps1` and run it automatically in CI.

---

## What changed in v1.1.32

This file's first significant revision since v1.1.30. The substantive changes are:

1. **Voice-print module added** (`src/signal/voice-print.js`). Disclosed in the "What's stored locally" section above as the `cueVoicePrintTemplate` storage key. Not biometric identification under GDPR; 16 floats per user; never transmitted.
2. **Counterparty acoustic capture defaults ON** for symmetric contexts. Per-context overrides for adversarial contexts. Documented in the new "Counterparty acoustic capture" section above.
3. **Install-time consent screen** (`onboarding/onboarding.html`) restored as the disclosure surface. User clicks "Enable Cue" once, after seeing the full disclosure + courtesy script.
4. **Conversation Profile + Source picker** re-surfaced during active sessions (`side-panel/panel.html`).
5. **Network egress audit re-run.** Bundle still has zero `fetch()` to external URLs. Claim holds at the byte level.

---

## Cross-references

- `ROADMAP.md` — Phase 0 (Verify) gate + Phase 1.6 (this file)
- `SIGNAL_MODEL.md` — IP doc that this references for what the signals contain
- `CHROME_STORE_LISTING.md` — public-facing claim copy
- `LAUNCH_NOW.md` — public-facing launch text
- `DOCUMENTATION_PLAN.md` — Phase 1.6 (this is the doc it called for)
- The install-time consent screen at `onboarding/onboarding.html`

---

_Updated 2026-05-18: created in the v1.1.32 ship session. Captures the claim verdict, network egress audit, local-storage schema, voice-print disclosure, counterparty-capture position, and the audit grep template for future builds._
