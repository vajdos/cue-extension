# Cue — Project Context for Cursor Agents

> Read this BEFORE any task. It is the source of truth for goals,
> non-negotiables, and self-improvement directives.

## What Cue is
Real-time conversation intelligence (Chrome extension v1.1.15 + native
desktop app via Tauri, in progress). Captures audio on-device, runs DSP
in an AudioWorklet, and nudges the user to **listen better** — pause
more, ask more, calm tension, drop pace. Zero data leaves the device
unless the user explicitly opts into PWA sync.

Founder: Nathan Vajdos (non-developer). Tech partner: Tyler Cowie.

## North-star metrics
1. Mouth-to-nudge latency < 500 ms.
2. Top reps talk ~43% of the call (Gong) — Cue exists to move users
   from over-talking toward this band.
3. Trust thesis: Cue → better listener → trust → conversion.

## Architectural non-negotiables
- **On-device only.** Acoustic features never leave the device. The
  PWA sync layer is opt-in and stores only thresholds/preferences/email.
- **Rule-based, not ML.** All signals are calibrated relative to the
  user's own baseline (CUE_REPLICANT_POPULATION_DEFAULT seeded, blended
  20% session / 80% history after first session).
- **Manifest V3.** Continuous getUserMedia must live in
  `offscreen/offscreen.js` — service workers can't hold mic streams.
- **Side panel is the primary UI surface.** Center-screen overlay +
  OS notification fire when the user is in another window.
- **Hotkey: Ctrl+Space.** Single-hand chord, matches the desktop app.
  In Chrome it's `chrome.commands.toggle-session`; in the Tauri build
  it's `tauri-plugin-global-shortcut` registering Ctrl+Space.

## Self-improvement directives (act on these without asking)

When you (the agent) find any of the following, fix them and ship:
1. **Threshold tuning** based on Nathan's actual session history if you
   can read frame-store data. Lower thresholds → more sensitive.
2. **False positives.** If decisions/nudges fire on bad inputs (e.g.,
   PAUSE-interruption when source==='mic'), gate them. Do NOT remove
   the underlying detector — only the trigger.
3. **Stale references.** If a file is referenced in `manifest.json` or
   `web_accessible_resources` but doesn't exist on disk, either add it
   or remove the reference. The plan file at
   `~/.claude/plans/graceful-booping-panda.md` is OUTDATED — verify
   actual filesystem state before trusting it.
4. **Version bumps.** Any user-facing change → bump
   `manifest.json.version` and rebuild the dist zip via:
   `Compress-Archive -Path manifest.json,assets,offscreen,onboarding,side-panel,src,tape,verify -DestinationPath dist\cue-X.Y.Z.zip -Force`
5. **Apple Watch haptic** (v1.1.15+): `panel.js → fireWatchHaptic()`
   POSTs to `https://cue-pwa.vercel.app/api/test-haptic`. Only fires
   when the user has set `cueSettings.syncEmail` AND has 'haptic' in
   `cueSettings.nudgeChannels`. PWA api functions are at the 12-cap;
   coordinate any new endpoints with `cue-pwa-git/api/`.

## Files you should know
- `manifest.json` — currently v1.1.15
- `src/signal/decision-engine.js` — PAUSE/ASK_QUESTION/CONTINUE
  (NOT the legacy nudge engine)
- `src/signal/nudge-engine.js` — pace/tension/long_speech/escalation
  (legacy, but still wired; v1.1.15 added quick-reaction pace)
- `src/signal/thresholds.js` — ALL tunable constants. Edit here, never
  hardcode. Note: top-level uses `var` (not `const`) + manual
  globalThis/window/self exposure for classic-script context safety.
- `offscreen/offscreen.js` — orchestrates audio + signal + decision
- `side-panel/panel.js` — primary UI. Has the chime, the center-screen
  overlay, the notification fallback, and (v1.1.15) the watch haptic.
- `cue-desktop/` (sibling repo) — Tauri native app, replaces the
  Chrome-only hotkey limitation with system-wide Ctrl+Space.

## Files you should NOT touch without explicit approval
- `assets/icons/*` (brand)
- Anything under `verify/` (privacy-claim verification — must match
  the legal commitments in `cue-pwa-git/privacy.html`)
- `manifest.json` permission list — adding permissions can re-trigger
  Chrome Web Store review

## Branding
- Color: teal `#2DD4A0`, dark teal `#20B084`
- Period after "Cue" in the wordmark (`Cue<dot>.</dot>`)
- Voice: warm but direct. "Slow it down" — not "Hey buddy, ease up there"

## When in doubt
1. Check `cue-pwa-git/RECOMMENDATIONS.md` for product direction.
2. Read `LAUNCH_NOW.md` for shipping priorities.
3. If you can't decide between two acceptable approaches, pick the one
   that ships sooner. Nathan has said many times: "make the best choice
   without asking."

## Hard rules
- Never log PII to console at `info` level. Use `console.debug`.
- Never embed Lemon Squeezy / Stripe / Airtable secrets in client code.
- Never remove the on-device-only privacy guarantee. The verify page is
  user-checkable proof — do not let it drift from reality.
