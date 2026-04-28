# Cue — Real-Time Conversation Intelligence

Chrome extension that listens to your voice during video calls and delivers sub-500ms acoustic coaching nudges. Everything runs on-device.

**Live:** [Chrome Web Store](https://chromewebstore.google.com/) (pending approval) · [cue-pwa.vercel.app](https://cue-pwa.vercel.app)

---

## What it does

Cue analyzes your microphone audio in real time during Zoom, Teams, and Google Meet calls. It tracks pace, vocal tension, energy, and pause patterns relative to your own baseline, and delivers in-moment nudges (PAUSE, ASK_QUESTION, CONTINUE) when you drift. After each call, an Integration Tape summary opens with your EQ score, emotional arc, and one micro-skill to practice next.

**Privacy by architecture:** no audio recorded, no transcription, no upload. Verifiable in Chrome DevTools → Network tab.

---

## Tech stack

- **Chrome Extension Manifest V3**, Chrome 116+
- **WebAudio + AudioWorklet** for on-device DSP
- **Offscreen document** for continuous mic capture (MV3 requirement)
- **Chrome Side Panel API** for the primary UI
- Rule-based signal model — no ML, ~80 years of acoustic research applied as DSP
- IndexedDB for session frames, chrome.storage.local for preferences and intervention log
- `tabCapture` for dual-stream interruption detection

## Development

Plain JS, no bundler. Load Unpacked in Chrome:

```
chrome://extensions → Developer mode ON → Load unpacked → select repo root
```

### Build a Chrome Web Store package

```powershell
.\scripts\build-store-package.ps1
# → dist/cue-<version>.zip
```

### Capture screenshots (1280×800)

```powershell
# Save screenshots to assets/store/screenshots/, then:
.\scripts\resize-screenshots.ps1
```

### Render store tiles

`assets/store/promo-tile.html` and `marquee-tile.html` are HTML sources rendered to PNG via headless Chrome.

---

## Repo layout

```
cue-extension-v1.1.0/
├── manifest.json                 v1.2.0
├── assets/icons/                 16/48/128 PNGs
├── assets/store/                 Store tiles + screenshots
├── src/
│   ├── audio/                    AudioWorklet processor + manager
│   ├── background/               Service worker
│   ├── content/                  Call-tab content script
│   ├── signal/                   Decision engine, signal model, etc.
│   ├── settings/                 Settings page UI
│   ├── storage/                  IndexedDB + intervention log
│   └── tape/                     EQ score + integration tape data
├── side-panel/                   Primary side-panel UI
├── offscreen/                    Offscreen document for mic capture
├── tape/                         Tape page + Progress dashboard
├── verify/                       User-facing privacy verifier
├── onboarding/                   First-run welcome flow (v1.2.0)
├── scripts/                      Build + helper scripts
└── dist/                         Store ZIP output (gitignored except final)
```

---

## Status

- v1.2.0 ready for Chrome Web Store submission
- ZIP: `dist/cue-1.2.0.zip` (~113 KB)
- Listing copy: `CHROME_STORE_LISTING.md`
- Submission playbook: `CHROME_STORE_SUBMISSION_PLAYBOOK.md`
- Privacy policy live at [cue-pwa.vercel.app/privacy.html](https://cue-pwa.vercel.app/privacy.html)
- White paper at [cue-pwa.vercel.app/docs/whitepaper.html](https://cue-pwa.vercel.app/docs/whitepaper.html)

## Contact

Nathan Vajdos · [nathan.vajdos@regis-energy.com](mailto:nathan.vajdos@regis-energy.com)

## License

Proprietary — all rights reserved. Source available for inspection by request.
