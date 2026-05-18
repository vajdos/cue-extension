# Cue — Chrome Web Store listing

**Status: ready to submit. Paste-and-click for Nathan once logged in to https://chrome.google.com/webstore/devconsole.**

One-time $5 USD developer registration fee. Review SLA: 2-7 business days for first submission.

---

## Title

`Cue — Real-Time Listening Coach`

## Short description (132 char max)

`Five subtle behaviors that produce listening, measured live during your Zoom, Teams, and Meet calls. On-device. No transcription.`

## Category

Productivity

## Single purpose statement (required by Chrome Web Store policy)

Cue's single purpose is to provide real-time, on-device acoustic coaching during live video calls — measuring five subtle listener behaviors (response gap, within-turn pause, energy mirroring, interruption count, pace) and surfacing them as quiet visual nudges in a side panel.

---

## Detailed description (full marketing copy)

```
Listening is five subtle behaviors. Cue measures all five — live, during your real calls.

When you open a Zoom, Teams, or Google Meet call, Cue auto-starts and runs as a quiet side panel showing your live signals: response gap, within-turn pause, energy mirroring, interruption count, and pace. The science is from Templeton 2022 (PNAS), Liu 2025 (Journal of Experimental Social Psychology), Pentland 2008 (Honest Signals), Roediger & Karpicke 2006 (Psychological Science), and Tulving & Thomson 1973.

Cue does not transcribe. It does not record audio. It does not send your conversations to the cloud. All five signals are computed on your device, in real time, by an AudioWorklet running on the audio rendering thread of your browser. The architecture is the proof: open Chrome DevTools → Network tab during a session and you will see zero outbound requests while Cue is listening.

WHAT IT MEASURES

• Response gap — the milliseconds between the other person finishing and you beginning
• Within-turn pause — the strategic pauses inside your own turn that elicit affirmative backchannels
• Energy mirroring — whether your vocal energy matches the room
• Interruption count — confirmed mic-and-tab overlap events
• Pace — your words-per-minute against your 90-day baseline

WHAT IT DOES NOT DO

• No transcription
• No recording
• No sentiment scoring (pseudoscience risk)
• No filler-word detection (false-positive rates erode trust)
• No outcome promises (you decide what to do with the data)

THE WORK

The work is not "becoming a better listener." The work is each subtle signal moving in the right direction, conversation by conversation. Cue is the measurement, not the verdict.

PRIVACY

Audio never leaves your device. Derived metrics (numbers, not audio) sync only if you opt in. Read the full privacy story at cue-pwa.vercel.app/trust.

REQUIREMENTS

• Chrome 116 or later (for sidePanel + offscreen APIs)
• Microphone permission (one-time grant; required for acoustic feature extraction)
• Compatible call surfaces: Zoom Web (zoom.us/wc/*, app.zoom.us), Microsoft Teams (teams.microsoft.com, teams.cloud.microsoft, teams.live.com), Google Meet (meet.google.com)

WHO IT'S FOR

Founders, managers, salespeople, therapists, coaches, parents — anyone who has at least one important conversation a week and wants the data to be different a year from now.

Cue does not promise you will become a better listener. It promises that the five signals that produce listening will be measurable for you, every day, on your device, in real time.
```

## Permissions justification (required for each)

| Permission | Justification (paste into the form) |
|---|---|
| `activeTab` | Detect when the active tab is a supported video call surface (Zoom, Teams, Meet) so Cue auto-starts only on call pages and never on unrelated tabs. |
| `tabs` | Track call-tab lifecycle so Cue auto-stops when the call ends. |
| `storage` | Persist user calibration baseline (per-user p5/p95 signal bounds) locally so coaching is calibrated to the individual. No raw audio stored. |
| `alarms` | Schedule periodic cleanup of session frame data (older than 30 days) to keep the local IndexedDB bounded. |
| `notifications` | Post-call summary notification with the user's Listener Score for that session. Optional, user-toggleable. |
| `contextMenus` | Right-click "Start Cue here" / "Stop Cue" quick actions on supported call pages. |
| `sidePanel` | The primary live coaching UI. Cue runs as a Chrome side panel showing live signal bars during the call. |
| `offscreen` | MV3 requirement for continuous `getUserMedia` audio capture. The service worker cannot directly hold a long-lived audio stream; offscreen documents are Google's mandated pattern. |
| `tabCapture` | Optional dual-stream mode: capture the tab's outbound audio (the other speakers) so interruption-detection can verify mic-and-tab overlap. Strictly off-by-default; user opts in via settings. |
| `scripting` | Inject the on-page floating overlay (Shadow DOM) on supported call pages so the user sees a small, always-visible status indicator. |
| `identity` | Reserved for future Sign in with Google flow. Currently unused; will be removed in a future version if not used by v1.2. |

## Host permissions justification

```
The content script runs ONLY on these specific call surfaces:
- https://teams.microsoft.com/*
- https://teams.cloud.microsoft/*
- https://teams.live.com/*
- https://meet.google.com/*
- https://zoom.us/wc/*
- https://app.zoom.us/*

These are the only sites where Cue offers value. The extension does not request <all_urls> or any broader scope.
```

## Privacy practices disclosure

The Chrome Web Store form asks specific questions. Answers:

- **Personally identifiable information**: NO (Cue does not collect names, emails, addresses)
- **Health information**: NO
- **Financial information**: NO
- **Authentication information**: NO
- **Personal communications**: NO (Cue does not transcribe or store audio content)
- **Location**: NO
- **Web history**: NO
- **User activity**: YES — local-only signal-frame data (numbers describing user's own voice acoustics) for the user's own per-session review. Never transmitted.
- **Website content**: NO

**Single purpose**: described above.

**Privacy policy URL**: `https://cue-pwa.vercel.app/privacy`

**Limited use disclosure** (paste into the form):
```
Cue does not transfer user data to third parties. Cue does not use user data to train AI/ML models. Cue does not allow human reading of user data except where the user explicitly opts in to share an aggregated metric (Listener Score number) for cross-device sync. Audio is never transmitted off the user's device under any circumstances.
```

## Screenshots required (1280x800 or 640x400)

The Chrome Web Store requires at least 1 screenshot, recommends 3-5. Capture these from a real Cue session:

1. **Hero**: Side panel open during a Zoom/Teams call showing live signals (Tension / Energy / Pace bars). Caption: "Live during your call."
2. **Privacy**: The trust page (`/trust`) showing "What stays / what leaves". Caption: "Audio never leaves your device."
3. **Listener Score**: Post-call score view from the tape page. Caption: "Five subtle behaviors, measured."
4. **Settings**: The settings page (`/settings`) with the three sliders (Sensitivity / Style / Privacy). Caption: "Three controls. Sensible defaults."
5. **Trust Signal request**: The send-check page. Caption: "External validation, not self-reported."

Resize to 1280x800 PNG before uploading.

## Promotional tile (optional but recommended) — 440x280 PNG

Wordmark "Cue" in Georgia/serif on `#FAFAFA` with the tagline "The five signals that produce listening" in SF Pro 17pt below.

## Post-submission

Twilio review SLA: 2-7 business days. Approval email goes to the developer Google account. Once approved:

1. Update `cue-pwa-git/install.html` to point to the live `chromewebstore.google.com/detail/<extension-id>` URL.
2. Send Wave-1 candidates the install link via the proven Gmail-SMTP path.
3. Begin tracking install count, daily-active sessions, and median-session-length in `/today` dashboard via the Chrome Web Store API (developer-account-only access).

---

*Listing prepared 2026-05-09. Source of truth: `cue-extension/manifest.json` v1.1.17 + `dist/cue-1.1.17.zip`. The submission window opens whenever Nathan logs in to the Chrome Web Store dev console.*
