# Cue — Signal Model

This file is the canonical reference for Cue's IP — the signals measured, the calibration math, the thresholds, the decision engine, the nudge logic. If you change anything in `src/signal/` or `src/audio/`, the corresponding section here updates in the same commit.

**Generated 2026-05-18** against build v1.1.32. Source files: `src/signal/thresholds.js`, `src/signal/signal-model.js`, `src/signal/decision-engine.js`, `src/signal/nudge-engine.js`, `src/signal/voice-print.js`, `src/signal/interruption-detector.js`, `src/signal/coaching-engine.js`, `src/signal/adaptation-engine.js`, `src/signal/latency-monitor.js`, `src/audio/cue-processor.js`, `src/audio/audio-manager.js`.

---

## What Cue measures, in one paragraph

Cue captures the user's microphone audio in a hidden offscreen document (and optionally the active tab's audio via `tabCapture` for both-sides measurement). The audio stream feeds an `AudioWorkletNode` running `cue-processor.js`, which extracts per-frame acoustic features at ~128 ms frame intervals: RMS amplitude, zero-crossing rate, spectral centroid, spectral flatness, spectral rolloff, and four-band spectral energy. These features stream to the main thread of the offscreen document, where `signal-model.js` calibrates them against the user's personal baseline (warmup window of ~5 seconds → p5/p95 percentiles mapped to 0–100 scores → exponential moving average smoothing). The calibrated signals feed `decision-engine.js` (a state machine that outputs PAUSE / ASK_QUESTION / CONTINUE) and `nudge-engine.js` (the cooldown-gated text/visual nudge dispatcher). `voice-print.js` runs in parallel as a measurement-quality filter — frames whose spectral fingerprint doesn't match the calibrated user template are excluded from signal computation, so other speakers in the room don't pollute the user's measurements.

No audio is recorded. No transcription is performed. Every measurement is a number. Audio frames are consumed by the AudioWorklet and discarded.

---

## The five signals — what's measured and the science

Each signal maps to a peer-reviewed body of work on conversational behavior. Where the science is weak, that's named explicitly.

### 1. Response gap

**What it measures.** The duration (in milliseconds) between the moment the other party stops speaking and the moment the user starts speaking. Computed from voice-activity-detection (VAD) transitions across both audio sources (user mic + tab capture in `both` mode).

**Acoustic source.** RMS amplitude crossing a calibrated silence threshold, applied to both streams independently.

**Science.**
- **Sacks, Schegloff & Jefferson (1974)**, *Language* — the foundational paper on conversational turn-taking. Established the concept of "transition relevance places" and the existence of a near-zero gap as the universal turn-taking norm.
- **Stivers et al. (2009)**, *PNAS* — cross-cultural empirical study of 10 languages. Median response gap is ~200 ms across all studied languages, with most variance falling between 0 and 500 ms. Establishes the response gap as a universal pragmatic signal.

**Why it matters as a listening behavior.** Response gaps shorter than ~150 ms read as interruption or queuing-your-reply rather than processing. Response gaps longer than ~1 second read as disengagement or processing difficulty. The science supports the median range as a strong indicator of synchronous attentiveness.

**Threshold (signal score scale, 0–100, where 50 = your personal median).**

### 2. Within-turn pause

**What it measures.** Silences (≥ 2 s by default — `PAUSE_DURATION_SEC` in `thresholds.js`) inside the user's own speech. NOT the gap between turns — the gap inside a single turn.

**Acoustic source.** User mic VAD transitions, with the speaker-print filter applied.

**Science.**
- **Heldner & Edlund (2010)**, *Journal of Phonetics* — large-corpus analysis of conversational silences. Distinguishes within-turn pauses (signals processing) from gaps (signals turn transitions).
- **Liu (2025)**, *Journal of Experimental Social Psychology* — within-turn pauses by the listener elicit backchannel responses ("mm-hmm", "yeah", "right") from the speaker, which the speaker interprets as engaged listening.

**Why it matters.** Within-turn pause is the closest acoustic-only proxy for "the listener is processing, not queuing their reply." When the user holds a within-turn pause, the conversation reads as more deliberate to the other party. Strong science backing — among the strongest in the literature.

### 3. Energy mirroring

**What it measures.** The covariance between the user's RMS amplitude and the counterparty's RMS amplitude over a rolling window. Higher covariance = more vocal entrainment.

**Acoustic source.** RMS amplitude on both streams (`both` mode required).

**Science.**
- **Pentland (2008)**, *Honest Signals* — synthesizes ~10 years of MIT Media Lab work on vocal entrainment as a predictor of cooperative outcomes in conversations.
- **Levitan & Hirschberg** follow-up acoustic studies — speakers whose vocal energy tracks each other rate the conversation as more cooperative.
- Accommodation theory (Giles 1971+) — broader theoretical framing of vocal/linguistic mirroring as a social-bonding behavior.

**Why it matters.** Energy mirroring is the highest-bandwidth nonverbal signal in conversational acoustics — predicting cooperation, trust, and post-conversation rapport better than any other single signal.

**Caveat.** Mirroring can also be coercive or sycophantic in adversarial contexts. The decision engine treats high mirroring as positive only in symmetric/pro-social profiles (Default, 1-on-1, Sales, Presentation), not in Negotiation.

### 4. Interruption count

**What it measures.** The number of times the user starts speaking while the counterparty is still speaking, where overlap duration exceeds `INTERRUPT_OVERLAP_MS` (see `interruption-detector.js`). Lives in `src/signal/interruption-detector.js`.

**Acoustic source.** Concurrent VAD across both streams (`both` mode).

**Science.**
- **Sacks, Schegloff & Jefferson (1974)** turn-taking framework — interruption is a violation of transition-relevance norms.
- Multiple follow-up studies on perceived dominance (Zimmerman & West 1975; Smith-Lovin & Brody 1989) — interruption rate predicts perceived listener dominance.

**Caveat.** Interruption is gender-confounded in the literature — what counts as an interruption depends partly on the cultural context. Cue measures the raw acoustic overlap; interpretation is left to the user via the integration tape.

### 5. Pace

**What it measures.** Words per minute (estimated from zero-crossing rate variance + voice-activity duration). Implementation: `signal-model.js` uses ZCR variance as a proxy for speech rate without doing actual speech-to-text.

**Acoustic source.** Zero-crossing rate of the user's mic stream.

**Science.**
- Indirectly grounded in comprehension and emotional-regulation literature. Slow pace correlates with deliberation; fast pace correlates with stress or domination.
- This is the **weakest-grounded** of the five signals — the science here is correlational and weaker than the other four.

**Why it ships anyway.** Pace is the easiest signal for users to feel and notice in themselves, and the lowest-cost signal to nudge on. The user-experience value is real even though the science is thinner.

---

## Signal-quality filter — voice-print + speaker counter

`voice-print.js` (newly ported from desktop in v1.1.32) is the measurement-quality layer. It does NOT add a signal — it filters which audio frames count toward the five signals above.

### How it works

- **Calibration.** A 20-second capture window during which the user speaks. The module extracts 8-dimensional feature vectors per speech frame (zero-crossing rate, spectral centroid, spectral flatness, spectral rolloff, four-band spectral energies). Computes mean + standard deviation across all calibration frames.
- **Runtime.** Each runtime frame is scored by z-score distance to the calibrated template. Frames below the threshold (`MATCH_THRESHOLD_SUM = 7.0 × 8 dimensions`) are accepted as "the user." Frames above the threshold are rejected.
- **Effect.** When another speaker (kid, spouse, coworker, person walking through the room) speaks at similar acoustic distance to the user's mic, their frames are filtered out. The five signals only measure the calibrated user.

### Speaker counter

Same file (`voice-print.js`) also contains `CueSpeakerCounter` — clusters the REJECTED frames by Euclidean distance in normalized 8-dim feature space to count distinct other voices. Each cluster confirms after `CONFIRM_FRAMES = 60` consistent frames. Surfaces "Cue heard 2 voices in this call" / "3 voices" in the integration tape.

### Privacy claim impact

The voice template is **16 floats per user** (8-dim mean + 8-dim stdev) stored in `chrome.storage.local`. It is:
- ❌ Not biometric identification (no name lookup, no external database comparison)
- ❌ Not enough data to reconstruct or identify the user's voice in any meaningful sense
- ✅ Local-only (never uploaded)
- ✅ Architecturally identical to the existing per-user baseline calibration

See `PRIVACY_THREAT_MODEL.md` for the full disclosure.

---

## Calibration math

Per-user signal scoring uses a percentile-mapped baseline that warms up over the user's first session.

### Step 1 — Warmup capture
For the first `CALIBRATION_SPEECH_SEC = 5` seconds of active speech, raw feature values are accumulated without scoring. UI shows *"Calibrating..."*. After warmup completes, the user sees signals starting.

### Step 2 — Percentile mapping
For each signal dimension, compute the p5 and p95 of the warmup capture. Map raw values to 0–100 scores such that:
- p5 → score 25
- median → score 50
- p95 → score 75
- Linear interpolation between, clipped to [0, 100]

The 25/75 band is the "tight tolerance" zone visible as a faint dashed band in the side-panel UI (see `panel.css` `.p-bar-track::before`).

### Step 3 — Exponential moving average
Raw per-frame scores are smoothed via EMA: `smoothed[t] = α × raw[t] + (1 − α) × smoothed[t-1]`, where `α = SMOOTH_ALPHA = 0.3`.

A second EMA layer in `panel.js` further smooths the *displayed* bars (`PANEL_BAR_ALPHA`) so the UI feels calm even when the underlying signal is jittery.

### Step 4 — Sustain requirement
A signal must exceed its threshold for `SUSTAIN_FRAMES = 3` consecutive frames (~384 ms at 128 ms frame interval) before the decision engine considers it actionable. This prevents transient spikes from firing nudges.

### Step 5 — Floor on stdev
Calibration with very flat features (`stdev → 0`) would create infinite z-scores. The implementation floors stdev at 0.0001 per dimension. Prevents wild swings on quiet calibration windows.

### Calibration minimum range
Per `CALIBRATION_MIN_RANGE = 0.1` — if the captured range for a feature is too tight (e.g., the user only spoke quietly during warmup), Cue widens the band to a minimum to prevent over-sensitive thresholding.

---

## Threshold table (build v1.1.32)

From `src/signal/thresholds.js`. Values are on the 0–100 calibrated-score scale unless noted.

### Base thresholds (Default profile)

| Constant | Value | Meaning |
|---|---|---|
| `PACE_THRESHOLD` | 65 | Pace score above which "Slow down" nudge fires |
| `TENSION_THRESHOLD` | 70 | Tension score above which "Take a breath" nudge fires |
| `ENERGY_LOW` | 30 | Energy score below which "Speak up" nudge fires |
| `ENERGY_HIGH` | 75 | Energy score above which "Lower energy" nudge fires |
| `LONG_SPEECH_SEC` | 18 | Continuous-speech seconds before "Give them space" fires |
| `PAUSE_DURATION_SEC` | 2 | Silence ≥ 2 s counts as a "pause" |
| `INTERRUPT_OVERLAP_MS` | (per `interruption-detector.js`) | Both-stream overlap threshold for interruption |

### Escalation (compound signal)

When ALL three exceed simultaneously for `SUSTAIN_FRAMES`, the escalation nudge fires:

| Constant | Value |
|---|---|
| `ESCALATION_TENSION` | 55 |
| `ESCALATION_PACE` | 58 |
| `ESCALATION_ENERGY` | 62 |

### Cooldown matrix

| Constant | Value | Meaning |
|---|---|---|
| `SUSTAIN_FRAMES` | 3 (~384 ms) | Consecutive frames a signal must exceed threshold before firing |
| `COOLDOWN_SEC` | 5 | Minimum seconds between nudges (per-key) |
| `GRACE_PERIOD_SEC` | 6 | After session start, first nudge can fire after this |
| `MIN_NUDGE_GAP_MS` | ~3000–5000 (per `nudge-engine.js`) | Global cooldown between any two nudges, regardless of key |
| `WARMUP_SECONDS` | (computed from calibration) | Only `hi`/`flow`/`calibrating` nudges allowed before this |
| `FIRST_CORRECTIVE_AFTER` | (per `nudge-engine.js`) | First corrective (red/orange/purple) nudge gated after this |

### Display

| Constant | Value | Meaning |
|---|---|---|
| `NUDGE_DISPLAY_SEC` | 4 | How long a nudge text card shows |
| `GLOW_FADE_SEC` | 2 | How long the edge glow lingers after nudge |
| `ALERT_OPACITY_THRESHOLD` | 60 | Widget goes full opacity when any signal exceeds this |

### Latency budget

| Constant | Value | Meaning |
|---|---|---|
| `MAX_LATENCY_MS` | 500 | Disable nudges if pipeline latency exceeds this |
| `LATENCY_FAIL_FRAMES` | 3 | Must exceed for this many consecutive frames before disabling |

---

## Per-context profile overrides

Conversation Profiles override base thresholds for the duration of one session. Selected via the panel's dropdown.

| Profile | Pace | Tension | Long Speech | Cooldown | Nudge Pack |
|---|---|---|---|---|---|
| **Default** | 65 | 70 | 30 | 5 | gentle |
| **1-on-1 Coaching** | 60 | 70 | 20 | 5 | gentle |
| **Sales / Discovery** | 60 | 70 | 20 | 5 | directive |
| **Presentation** | 55 | 85 | 60 | 8 | directive |
| **Negotiation** | 70 | 80 | 45 | 10 | gentle |
| **Interview** (v1.1.32 new) | 60 | 75 | 30 | 8 | gentle |
| **Hard conversation** (v1.1.32 new) | 60 | 70 | 30 | 8 | warm |

### Per-context counterparty-capture default (v1.1.32 new)

From `panel.js` `COUNTERPARTY_DEFAULT_BY_PROFILE`:

| Profile | Counterparty capture default | Rationale |
|---|---|---|
| Default | both | Most calls, pro-social |
| 1-on-1 Coaching | both | Mutual, collaborative |
| Sales / Discovery | both | Norm-shift strongest here; every sales platform measures both sides |
| Presentation | both | Audience is implicit-consent context |
| Negotiation | mic only | Adversarial — protect against accidental two-party-consent exposure |
| Interview | mic only | Asymmetric — interviewee may not appreciate measurement |
| Hard conversation | mic only | High-stakes interpersonal — courtesy beats efficiency |

---

## Decision engine state machine (`decision-engine.js`)

The decision engine takes the calibrated signal stream and outputs one of three intervention decisions per evaluation cycle.

### States

- **CONTINUE** — no intervention. Default state. Signals are within band or just briefly elevated.
- **PAUSE** — speaker should stop and create space. Triggered by long_speech sustained over threshold + high pace + low recent within-turn-pause.
- **ASK_QUESTION** — speaker has been talking too long without inviting the other party in. Triggered by sustained low talk-listen ratio for them + high floor-share for the user.

### Transition logic (simplified)

```
CONTINUE → PAUSE   when:
  boutDur > LONG_SPEECH_SEC
  AND pace > PACE_THRESHOLD (sustained)
  AND no within-turn-pause in last 8 seconds

CONTINUE → ASK_QUESTION   when:
  talkPct > 0.65 (user holding floor)
  AND elapsed_since_last_question > QUESTION_INTERVAL_SEC
  AND counterparty has been quiet > 12 seconds

PAUSE → CONTINUE   when:
  user_speech_RMS < silence_threshold for > 2 seconds (they paused — success)
  OR > NUDGE_DISPLAY_SEC elapsed

ASK_QUESTION → CONTINUE   when:
  detected question (rising pitch terminal) — TODO: v1.1.33
  OR counterparty starts speaking
  OR > NUDGE_DISPLAY_SEC elapsed
```

### Pause/ASK_QUESTION success tracking

When the decision engine fires PAUSE and the user actually pauses within the response window, that's tracked as a success. Same for ASK_QUESTION. Surfaced in the integration tape post-session.

---

## Nudge engine — text + tone (`nudge-engine.js`, `thresholds.js NUDGE_PACKS`)

Nudges are short text strings (1–4 words) routed to the center-screen overlay. The text varies by tone pack:

### Nudge packs (`NUDGE_PACKS` in thresholds.js)

| Pack | Pace | Tension | Long speech | Escalation |
|---|---|---|---|---|
| **gentle** | "Slow it down" | "Take a breath" | "Give them space" | "Take a breath" |
| **direct** (and `directive` alias) | "SLOW DOWN" | "BREATHE. PAUSE." | "LET THEM SPEAK" | "BREATHE. PAUSE." |
| **warm** | "Ease into it" | "You're solid. One breath." | "Let them in" | "You're solid. One breath." |
| **dry** | (see thresholds.js) | | | |
| **playful** | (see thresholds.js, with regional flavor selector) | | | |

### Tone selection

- `nudgePack` (chosen in Settings or per Profile) selects which pack
- `toneFlavor` (for `playful` pack) selects regional variant (default: `neutral`)
- Profile-level override: each Conversation Profile pins a default pack

### Rendering

- Default rendering surface: **center-screen overlay** injected into the active tab via `chrome.scripting.executeScript`. The overlay is a transparent fixed-position div that fades in for `NUDGE_DISPLAY_SEC` seconds, then fades out.
- Fallback rendering: **OS notification** via `chrome.notifications.create` — used when the active tab is not a Chrome tab (Teams desktop user). The notification body contains the nudge text.

### Tier escalation (v1.1.20+)

If the same nudge type fires twice within `ESCALATION_WINDOW_MS = 90,000` (90 seconds), the visual tier escalates:

| Tier | Trigger | Visual |
|---|---|---|
| 1 (subtle) | First fire | Lower-center pill, no label, 2.5 s fade, gray |
| 2 (urgent) | Second fire within window | Center card, label visible, 4 s, orange or red border |
| 3 (critical) | Third+ fire | Center card with breathing pulse, 6 s |

If the user "catches the drift" (signal returns to band), the escalation counter resets.

---

## Adaptation engine (`adaptation-engine.js`)

Over time, the adaptation engine refines per-user thresholds based on which nudges produced a behavior shift versus which were ignored.

Records (per-nudge):
- Pre-fire signal level
- Time-to-correction (when signal returned to band)
- Response-window threshold (whether user reacted within `responseWindowSec`)

Updates persisted to `chrome.storage.local.cueAdaptation` and survive sessions. Surfaces in the integration tape as *"Your pace correction time has improved from 8.4 s to 4.1 s over 12 sessions."*

---

## Latency monitor (`latency-monitor.js`)

Pipeline latency is the time between an acoustic event (user speech) and the corresponding signal frame being available to the decision engine. Cue targets **mouth-to-nudge p50 ≈ 75–95 ms** end-to-end (frame interval + worklet emit + main-thread dispatch).

If pipeline latency exceeds `MAX_LATENCY_MS = 500` for `LATENCY_FAIL_FRAMES = 3` consecutive frames, the latency monitor **auto-pauses nudges** for that session. The user sees a status message; signals continue to be measured for the post-session tape, but no live nudges fire. Prevents lagged, out-of-context nudges from making the product feel broken.

---

## What's NOT in the model today

### Question-detection (queued for v1.1.33)

Per `ROADMAP.md` Phase 1 work plan: the next session writes the acoustic question-detection subsystem. It will use:
- Pitch tracking (YIN or autocorrelation in the AudioWorklet)
- End-of-phrase detection (silence within user speech)
- Rising terminal pitch as the question signature
- Measurement-only — no nudges that prompt the user to ask questions (that pattern was explicitly removed per Nathan's directive)

When shipped, integration-tape will surface "You asked N follow-up questions" per session. Aligns with Huang et al. 2017 *JPSP* — the single strongest single-behavior predictor of being heard.

### Calendar-context awareness (deferred to Phase 5)

Calendar integration was removed in the v1.1.30 privacy cleanup. When it returns (Phase 5), the calendar event title/description will optionally drive automatic profile selection: events tagged "negotiation" auto-pick the Negotiation profile, etc. Out of scope today.

### Per-relationship personalization (deferred to Phase 5)

Within the corpus telemetry workstream (opt-in), per-relationship learning becomes possible: *"With this counterparty, your pace runs 8% faster than your baseline."* Requires meeting-identity tagging that doesn't exist yet.

---

## How to change the model safely

If you edit `src/signal/thresholds.js`:
1. Update the corresponding row in the threshold table above in this file
2. Add a comment to the changed constant referencing the version: `// v1.1.X — was Y, raised to Z because <reason>`
3. Note the change in `ROADMAP.md` Progress log

If you add a new signal:
1. Add a new section above (mirroring the "Response gap" structure with science citations)
2. Update `manifest.json` `web_accessible_resources` if a new file ships
3. Update `PRIVACY_THREAT_MODEL.md` if the new signal expands the measurement surface
4. Add to the threshold table

If you change calibration math:
1. Update the "Calibration math" section
2. Test against the existing verify page (`verify/verify.html`)
3. Run the privacy audit grep template — calibration changes occasionally pull in new dependencies

---

## Cross-references

- `ROADMAP.md` — Phase 1 + Phase 5 reference this file
- `PRIVACY_THREAT_MODEL.md` — voice-print + corpus telemetry implications
- `CLAUDE.md` — must-read files include this one for any signal-model session
- `ARCHITECTURE.md` (Phase 1.3, not yet written) — runtime data flow that feeds this model
- `DOCUMENTATION_PLAN.md` Phase 1.2 — this is the doc it called for

---

_Updated 2026-05-18: created in the v1.1.32 ship session. Captures the model as-of voice-print port. Question-detection deferred to v1.1.33._
