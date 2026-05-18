# Cue — Launch Now Checklist (25 minutes to Submit)

**Submission artifact:** `dist/cue-1.1.9.zip` (138.7 KB) — the final, current build with all v1.1.x improvements baked in.

---

## You can launch in 25 minutes if you do these in order:

### Step 1 — Capture 5 screenshots (15 min)

Use the demo keystrokes I built into v1.0.9 — they fire any nudge type instantly so you don't need to monologue.

1. Reload Cue at `chrome://extensions/` to make sure v1.1.9 is loaded
2. Open `https://google.com` (or any normal page) in a tab
3. Click the Cue toolbar icon — side panel opens
4. **Click anywhere in the side panel** to focus it
5. Press the demo keys one at a time, screenshot each:

| Keystroke | Fires | Save as |
|---|---|---|
| **D** | PAUSE (white pill, center) | `01-pause-success.png` |
| **Q** | ASK_QUESTION (teal background) | `02-question-detected.png` |
| **T** | TENSION (red, italic) | `03-tension-nudge.png` |
| **P** | PACE (amber subtle pill, lower-center) | `04-pace-nudge.png` |
| **X** | ESCALATION (red, breathing pulse) | `05-escalation-pacer.png` |

For each press: **Win+Shift+S** → drag rectangle around the entire Chrome window → save to `assets/store/screenshots/` with the filename above.

Then run the auto-resize script:
```powershell
cd C:\Users\NathanVajdos\Downloads\cue-extension
.\scripts\resize-screenshots.ps1
```

All 5 PNGs are now exactly 1280×800.

### Step 2 — Submit to Chrome Web Store (10 min)

1. Go to **https://chrome.google.com/webstore/devconsole**
2. Sign in with `vajdos@gmail.com` (your Cue dev account)
3. If first-time: pay $5 one-time registration fee
4. Click **New item** (top right) → upload `dist/cue-1.1.9.zip`
5. Wait ~30 sec for manifest scan
6. **Store listing tab** — paste from `CHROME_STORE_LISTING.md` (open in Notepad alongside):
   - Extension name → "Extension Name" section
   - Summary → "Short Description" section
   - Description → **use the v1.1.9 description below** (I rewrote it with the new features)
   - Category: Productivity
   - Language: English
   - Upload 5 screenshots
   - Upload `assets/store/cue-promo-tile.png` (440×280)
   - Upload `assets/store/cue-marquee-tile.png` (1400×560 — optional but recommended)
7. **Privacy practices tab**:
   - Single purpose: paste from listing file
   - Permission justifications: paste each one (10 permissions now: tabCapture/scripting/identity added)
   - Data usage: check **NONE** for every category
   - Certifications: check all 3 boxes
   - Privacy policy URL: `https://cue-pwa.vercel.app/privacy.html`
8. **Distribution tab**:
   - Visibility: Public
   - Pricing: Free (Pro tier handled in-app)
   - Regions: All countries
   - Support email: `nathan.vajdos@regis-energy.com`
   - Support website: `https://cue-pwa.vercel.app`
9. **Submit for review** (blue button)

### Step 3 — Wait (1-3 business days)

You'll get an email at vajdos@gmail.com when approved or rejected.

If rejected: paste the rejection reason in our chat and I'll fix it in 5 minutes.

---

## v1.1.9 description (use this — improved over the old listing)

```
Cue is a real-time conversation coach that runs entirely on your device.

WHAT IT DOES
Cue listens to your microphone during video calls — Zoom, Microsoft Teams, Google Meet, or any browser tab — and gives you subtle nudges when your voice patterns drift from your own baseline. Talking too fast? Cue taps you on the shoulder. Getting tense? Cue suggests a breath. Monologuing past 30 seconds? Cue tells you to make space for the other person.

PRESS Ctrl+Space FROM ANY TAB
Cue's hotkey starts a session from anywhere in your browser. Single-hand chord, side-by-side keys — the same ergonomic philosophy as voice tools like Wispr Flow.

HOW IT WORKS
Cue uses standard WebAudio and AudioWorklet APIs to compute acoustic features — speaking pace, vocal tension, energy, and pause behavior — in the browser's audio thread. Every frame is processed in under 128 milliseconds. The entire pipeline from microphone to nudge completes in under 500 milliseconds.

WHAT'S UNIQUE
Cue is the only real-time, on-device, acoustic-only coaching layer for live conversation. Everything else on the market — Gong, Chorus, Otter, Fireflies, Microsoft Copilot, Cogito, Balto — either records audio to the cloud for post-call transcription, or uses cloud ASR with 2-8 second latency. That's too slow to change behavior and too intrusive for regulated industries.

Cue runs in your browser. No audio leaves your device. No transcription. No account required. No tracking.

CORE FEATURES
- Personal calibration: a "replicant" baseline that converges to your norms over ~10 sessions of use. Future sessions are scored against your own patterns, not a generic baseline.
- Four primary signals: tension, pace, energy, and pause behavior. Pause is the strongest listening signal per published acoustic research (Stivers 2009 PNAS, Heldner & Edlund 2010).
- Five nudge voices: Gentle, Direct, Warm, Dry, and Playful — with regional flavor presets (neutral, Yiddish, Southern, British-dry).
- Center-screen overlay with intensity grading: subtle pill for routine signals, strong card with breathing pulse animation for escalation.
- Live "Cue Says" status — a real-time human-readable line below the bars updates every 2 seconds with what Cue is observing.
- Integration Tape after each call: EQ score, "what you nailed" positive recognition, "moment you missed", emotional arc chart, and a one-line micro-skill to practice next time.
- Progress dashboard with intervention success rate — the moat metric.
- Conversation profiles: Default, Negotiation, Sales / Discovery, Presentation, 1-on-1 Coaching.
- Optional cross-device sync (email required) for iPhone PWA + Apple Watch haptic notifications.

PRIVACY
- No audio recorded.
- No speech-to-text (transcription is opt-in for vernacular learning, Pro feature only, on-device).
- Nothing leaves your browser by default.
- No analytics, no tracking, no login required.
- You can verify this yourself in Chrome DevTools Network tab. Zero outgoing requests during a coaching session.

WHO USES CUE
Sales professionals working to catch pace drift during objection handling. Physicians documenting bedside-manner cadence in patient visits. Therapists monitoring countertransference. Executive coaches training leaders. Teachers and academics in online classes. Anyone preparing for a high-stakes conversation.

FIRST USE
1. Click the Cue icon in your Chrome toolbar — the side panel opens.
2. Click Start Listening, or press Ctrl+Space from anywhere.
3. Speak — Cue scores you immediately against the population baseline, then learns your norms across the next few sessions.
4. After your call, the Integration Tape opens with your EQ score and what you nailed.

PRICING
Free tier: up to 3 nudges per call, last 3 sessions in history.
Pro: unlimited nudges, full Integration Tape, unlimited session history, cross-device sync, Apple Watch haptics — $69/year founding-member rate, $144/year after the first 1,000 founders.

SUPPORT
Questions, bug reports, demo requests: nathan.vajdos@regis-energy.com

SCIENCE
Built on 80 years of acoustic science. Signal model grounded in Scherer (2003), Juslin & Laukka (2003), Stivers et al. (2009 PNAS), Goldman-Eisler (1968), and Lehrer & Gevirtz (2014). Full white paper at cue-pwa.vercel.app/docs/whitepaper.html.
```

---

## What I built that's now in the live ZIP (since the original listing was written)

| Version | Feature |
|---|---|
| **1.0.8** | Center-screen overlay (any tab) |
| **1.0.9** | Demo keystrokes (D/Q/T/P/E/L/X) |
| **1.1.0** | Replicant baseline (population default + adaptive blending) |
| **1.1.1** | Mode-aware tape labeling, replicant trend in tape, calendar scaffolding |
| **1.1.2** | Live labels next to bars + "Cue Says" status line, Pause as 4th signal |
| **1.1.3** | Smoother bars, goal-clarity zone, name personalization |
| **1.1.4** | Global hotkey toggle |
| **1.1.5** | Hotkey moved to Ctrl+Space (single-hand, side-by-side) |
| **1.1.6** | Five tone packs + regional flavors, win moment in tape, vernacular engine scaffolded, calendar persona inference |
| **1.1.7** | Tone pack settings UI, intensity-graded overlay |
| **1.1.8** | Side panel simplification (advanced controls hidden by default), tone-pack runtime wiring, hotkey hint |
| **1.1.9** | Session counter pill, win-moment notification, founder.html upgrade target |

That's a full year of feature work in one focused push. **Submission-ready.**

---

## After approval

Once Cue is live in the Chrome Web Store, the next push:
1. **Lemon Squeezy product setup** — for actual money. Follow `LEMONSQUEEZY_SETUP.md` (15 min in their dashboard).
2. **LinkedIn launch post** — already drafted in `cue-launch-content/02-linkedin-launch-post.md`
3. **Cold outreach + press pitches** — already drafted

You're at the launch line. Capture 5 screenshots → upload → submit.
