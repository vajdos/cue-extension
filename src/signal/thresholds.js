/**
 * Cue — Threshold Constants
 *
 * All configurable thresholds and timing constants in one place.
 * These are tuned for Nathan's speaking style (talks fast, over-explains).
 *
 * Scores are 0-100, calibrated relative to the user's own baseline.
 */

var CUE_THRESHOLDS = {
  // -- Nudge Trigger Thresholds --
  // v1.1.12 tuning: Nathan reports "I'm not seeing anything slow" / "tell me
  // when to be quiet". Lowering across the board so nudges fire on REAL
  // conversational rhythms, not just monologues.
  PACE_THRESHOLD: 58,           // was 65 — fire on slightly above norm
  TENSION_THRESHOLD: 62,        // was 70 — catch tightening earlier
  ENERGY_THRESHOLD: 70,         // was 75 — used in escalation compound

  // -- Long Unbroken Speech (the "let them speak" / "be quiet" nudge) --
  // v1.1.12: dropped 30s → 18s. Real conversation has 15-20s bursts; 30s was
  // catching only true monologues, missing the moments Nathan wants to hear about.
  LONG_SPEECH_SEC: 18,          // was 30 — nudge after 18s of continuous speech
  PAUSE_DURATION_SEC: 2,        // Silence >= 2s counts as a "pause"

  // -- Escalation (compound signal) --
  ESCALATION_TENSION: 55,       // all three must exceed simultaneously
  ESCALATION_PACE: 58,          // was 60 — match new pace threshold
  ESCALATION_ENERGY: 62,        // was 65

  // -- Sustain & Cooldown --
  SUSTAIN_FRAMES: 3,            // ~384ms at 128ms per frame — must stay above threshold
  COOLDOWN_SEC: 5,              // Minimum seconds between nudges
  GRACE_PERIOD_SEC: 6,          // was 10 — start helping faster, don't wait long

  // -- Calibration --
  // v1.1.37 — Smarter calibration handling (CUE_BUILD_SPEC.md §11.3 + Part 13).
  // Old behavior: lock in baseline after exactly 5 seconds of voiced speech,
  // regardless of data quality. Problem: if the user's first 5 seconds were
  // a quiet sentence with little variation, the percentile range collapsed
  // and downstream scoring saturated. New behavior: 5s is the EARLY-EXIT
  // floor; if the RMS percentile range looks too thin (< CALIBRATION_MIN_RANGE
  // × CALIBRATION_RANGE_QUALITY_FACTOR), keep accumulating up to
  // CALIBRATION_MAX_SPEECH_SEC. Adaptive VAD activation bypasses early-exit
  // and waits for the full max — lower-threshold detection means noisier
  // samples that benefit from more data.
  CALIBRATION_SPEECH_SEC: 5,            // earliest-exit voiced-speech floor
  CALIBRATION_MAX_SPEECH_SEC: 15,       // hard cap aligned with spec §11.3
  // Factor of 1.0 = early-exit as soon as the natural RMS p95-p5 spans
  // the MIN_RANGE floor (so _finishCalibration won't have to artificially
  // widen it, which is the scoring-saturation failure mode this guards
  // against). Raise the factor if real-world data shows users early-
  // exiting with still-noisy baselines.
  CALIBRATION_RANGE_QUALITY_FACTOR: 1.0,
  CALIBRATION_MIN_RANGE: 0.1,   // Minimum range floor to prevent wild swings

  // -- Signal Smoothing --
  SMOOTH_ALPHA: 0.3,            // Exponential moving average factor (0=no change, 1=instant)

  // -- Display --
  ALERT_OPACITY_THRESHOLD: 60,  // Widget goes full opacity when any signal exceeds this

  // -- Latency --
  MAX_LATENCY_MS: 500,          // Disable nudges if pipeline latency exceeds this
  LATENCY_FAIL_FRAMES: 3,       // Must exceed for this many consecutive frames

  // -- Nudge Display --
  NUDGE_DISPLAY_SEC: 4,         // How long a nudge text card shows
  GLOW_FADE_SEC: 2,             // How long the edge glow lingers after nudge

  // -- v1.1.33 Science-backed signal thresholds --
  // Five additional signals ported from the peer-reviewed literature so Cue's
  // measurement claim is defensible against any consumer competitor in the
  // listening-coaching space. Each threshold is anchored to a citation, not
  // to product feel.

  // F0 variability (Curhan & Pentland 2007, J. Applied Psychology — "Thin
  // slices of negotiation"). Standard deviation of fundamental frequency
  // over a rolling window is a documented engagement signal; low F0-SD =
  // monotone / flat affect = lower perceived warmth & competence.
  F0_WINDOW_SEC: 30,            // rolling window over which to compute F0 SD
  F0_SD_LOW_THRESHOLD: 12,      // Hz — below this is monotone, fire engagement nudge
  F0_SD_MIN_SAMPLES: 30,        // need this many F0 estimates in window to score

  // Speech-rate variation (Goldman-Eisler 1968; Smith, Brown & Strong 1975).
  // Variation in articulation rate within a session signals topic shifts and
  // listener engagement; flat rate signals disengagement or scripting.
  // Computed as rolling SD of ZCR within speech frames.
  RATE_VAR_WINDOW_SEC: 20,      // rolling window for rate-variance measurement
  RATE_VAR_LOW_THRESHOLD: 0.15, // coefficient-of-variation floor (SD/mean)

  // v1.1.37 — Envelope-based syllable rate (Greenberg 1999, "Speaking in
  // shorthand: a syllable-centric perspective for understanding pronunciation
  // variation"). The ZCR-based pace measure correlates with high-frequency
  // content rather than syllable cadence; envelope peaks in the 4-8 Hz
  // modulation band track actual syllabic articulation. ZCR is retained on
  // the output as a legacy field; future Phase-1 work migrates pace scoring
  // to syllableRate (units: syllables-per-second-of-speech).
  SYLLABLE_RATE_WINDOW_SEC: 2.0,        // rolling envelope window for peak counting
  SYLLABLE_RATE_MIN_SEPARATION_MS: 100, // 10 Hz max syllable rate (physiological ceiling)
  SYLLABLE_RATE_MIN_PROMINENCE: 0.30,   // peak must exceed p50 + 0.3 * (p90 - p50)
  SYLLABLE_RATE_MIN_SPEECH_SEC: 0.5,    // need this much speech in window before scoring

  // v1.1.37 — Voice-quality augmentation (CUE_BUILD_SPEC.md §6 audit). The
  // existing tension measure derives from spectralCentroid + (inverted)
  // spectralFlatness — solid for detection but coarse for diagnosis. H1-H2
  // and CPP add directly-interpretable voice-quality signals from the
  // clinical literature.
  //
  // H1-H2 (Hillenbrand & Houde 1996 JSHR; Klatt & Klatt 1990 JASA):
  // amplitude difference between first two harmonics in dB. H1 > H2
  // (positive) = breathy phonation; H1 < H2 (negative) = pressed/tense
  // phonation. Computed only when F0 is voiced (worklet-side autocorrelation
  // confidence ≥ 0.3).
  H1H2_PRESSED_DB: -3,                  // observation threshold for "pressed" voice — no nudge wired yet
  H1H2_BREATHY_DB: 6,                   // observation threshold for "breathy" voice — no nudge wired yet
  //
  // CPP (Hillenbrand 1994 JSHR; Heman-Ackah et al. 2002 J Voice): cepstral
  // peak prominence in dB. The clinical standard for voice-quality
  // assessment; lower CPP correlates with dysphonia and vocal effort/strain.
  // Population norm for healthy adult speech: ~15-25 dB. < 10 dB is widely
  // used as a clinical concern threshold.
  CPP_LOW_DB: 10,                       // observation threshold — no nudge wired yet

  // Laughter detection (Provine 2000 "Laughter: A Scientific Investigation";
  // Brooks 2024 "Talk" — Levity dimension of TALK framework).
  // Laughter is acoustically characterized by:
  //   1. Rhythmic amplitude modulation at 3-8 Hz (laugh cycle)
  //   2. Bursts ~75ms long, gaps ~135ms — depth-modulated envelope
  //   3. Higher spectral centroid than baseline speech (breathy quality)
  // We detect periodicity in the sub-frame envelope band 3-8 Hz.
  LAUGH_FREQ_MIN_HZ: 3.0,
  LAUGH_FREQ_MAX_HZ: 8.0,
  LAUGH_ENVELOPE_BUFFER_SEC: 1.5,  // analyze envelope over this many seconds
  LAUGH_MODULATION_THRESHOLD: 0.45, // min modulation depth to call it laughter
  LAUGH_COOLDOWN_SEC: 4,            // don't double-count one laugh

  // Backchannel detection (Stivers 2008; Bavelas, Coates & Johnson 2000 JPSP;
  // Brennan & Schober 2001 grounding work). A backchannel is a short voiced
  // burst (typically 100-450ms — "mm-hmm", "yeah", "right") used to signal
  // continued attention. In single-stream (mic only) mode we detect by
  // duration signature alone. In dual-stream mode (counterparty captured)
  // we additionally require the counterparty channel to be active during
  // the user's short burst, dramatically reducing false positives.
  BACKCHANNEL_MIN_MS: 100,
  BACKCHANNEL_MAX_MS: 450,
  BACKCHANNEL_PRECEDING_SILENCE_MS: 300, // must follow at least this much silence
  BACKCHANNEL_FOLLOWING_SILENCE_MS: 200, // must be followed by at least this much silence

  // Speaking-time ratio (Pentland 2008 "Honest Signals"; Mehl et al. 2007
  // Science — Electronically Activated Recorder studies). Healthier
  // conversations balance speaking time. We already track speakingRatio
  // (user-speech-fraction-of-total-active-frames). v1.1.33 surfaces it
  // as a first-class signal with explicit imbalance thresholds.
  TURN_DOMINANCE_HIGH: 0.70,    // user takes >70% of speech time = imbalanced
  TURN_DOMINANCE_LOW: 0.30,     // user takes <30% = under-engaged (or partner monologue)
  TURN_DOMINANCE_MIN_SEC: 60,   // don't fire turn-dominance nudges before 60s in

  // -- Conversation Profiles --
  // Preset bundles of threshold + channel overrides per conversation type.
  // Each profile overrides the base thresholds for that session only.
  // Picked in the Side Panel before starting a session.
  PROFILES: {
    default: {
      label: 'Default',
      description: 'Balanced. Use when you aren\u2019t sure.',
      pace: 65, tension: 70, longSpeech: 30, cooldown: 5,
      nudgePack: 'gentle',
    },
    negotiation: {
      label: 'Negotiation',
      description: 'Strategic pauses valued. More tension tolerance. Rare nudges.',
      pace: 70, tension: 80, longSpeech: 45, cooldown: 10,
      nudgePack: 'gentle',
    },
    sales: {
      label: 'Sales / Discovery',
      description: 'Catch monologue drift and help you let the buyer talk.',
      pace: 60, tension: 70, longSpeech: 20, cooldown: 5,
      nudgePack: 'directive',
    },
    presentation: {
      label: 'Presentation',
      description: 'Pace-forward. Tension is expected from adrenaline.',
      pace: 55, tension: 85, longSpeech: 60, cooldown: 8,
      nudgePack: 'directive',
    },
    one_on_one: {
      label: '1-on-1 Coaching',
      description: 'Catch pace drift and long-speech early. Gentle feel.',
      pace: 60, tension: 70, longSpeech: 20, cooldown: 5,
      nudgePack: 'gentle',
    },
  },

  // -- Nudge Text Packs --
  // v1.1.6 — Five tone packs (gentle / direct / warm / dry / playful) plus a
  // regional flavor selector for the playful pack. Each pack defines text for
  // the four nudge types: pace, tension, long_speech, escalation.
  // Backward compat: 'directive' kept as alias for 'direct'; 'minimal' kept.
  // Selection: cueSettings.nudgePack picks the pack name; cueSettings.toneFlavor
  // picks the sub-flavor for 'playful' (defaults to 'neutral').
  // v1.1.36 — Nudge text trimmed to 1-2 words per Nathan's feedback:
  // "more-than-a-single-word cue is distracting." Playful sub-flavors also
  // capped; the British-dry and Yiddish flavors kept their character in
  // the shortest form that still carries meaning.
  NUDGE_PACKS: {
    gentle: {
      pace: 'Slow',
      tension: 'Breathe',
      long_speech: 'Listen',
      escalation: 'Pause'
    },
    direct: {
      pace: 'SLOW',
      tension: 'BREATHE',
      long_speech: 'LISTEN',
      escalation: 'PAUSE'
    },
    // Backward-compat alias — older saved settings used 'directive'
    directive: {
      pace: 'SLOW',
      tension: 'BREATHE',
      long_speech: 'LISTEN',
      escalation: 'PAUSE'
    },
    warm: {
      pace: 'Ease off',
      tension: 'Exhale',
      long_speech: 'Open up',
      escalation: 'Ground'
    },
    dry: {
      pace: 'Pace↑',
      tension: 'Tension↑',
      long_speech: 'Long',
      escalation: 'High'
    },
    playful: {
      // Sub-flavors — selected via cueSettings.toneFlavor.
      // Pack consumers should look up: NUDGE_PACKS.playful[flavor || 'neutral']
      neutral: {
        pace: 'Beat',
        tension: 'Exhale',
        long_speech: 'Toss back',
        escalation: 'Breathe'
      },
      yiddish: {
        pace: 'Nu, slow',
        tension: 'Breathe',
        long_speech: 'Let them',
        escalation: 'Pause'
      },
      southern: {
        pace: 'Slow, hon',
        tension: 'Easy now',
        long_speech: 'Their turn',
        escalation: 'Breathe'
      },
      british_dry: {
        pace: 'Steady',
        tension: 'Tight',
        long_speech: 'Their turn',
        escalation: 'Breathe.'
      }
    },
    minimal: {
      pace: null,    // glow only, no text
      tension: null,
      long_speech: null,
      escalation: null
    }
  }
};

// v1.1.6 — Helper: resolve a nudge text from pack + flavor + nudge type.
// Handles the 'playful' pack's flavor sub-objects, falls back gracefully.
// Used by content-script and offscreen when generating nudge text.
function cueResolveNudgeText(packName, nudgeType, flavor) {
  const packs = (CUE_THRESHOLDS && CUE_THRESHOLDS.NUDGE_PACKS) || {};
  let pack = packs[packName] || packs.gentle || {};
  // 'playful' has flavor sub-objects
  if (packName === 'playful') {
    const f = (flavor && pack[flavor]) ? flavor : 'neutral';
    pack = pack[f] || pack.neutral || packs.gentle;
  }
  return pack[nudgeType] !== undefined ? pack[nudgeType] : (packs.gentle && packs.gentle[nudgeType]) || '';
}
if (typeof globalThis !== 'undefined') globalThis.cueResolveNudgeText = cueResolveNudgeText;
if (typeof window !== 'undefined') window.cueResolveNudgeText = cueResolveNudgeText;
if (typeof self !== 'undefined') self.cueResolveNudgeText = cueResolveNudgeText;

// Belt-and-suspenders global exposure — works in classic scripts (window),
// service workers (self), and any other browser global context. Fixes a
// repro where panel.js couldn't see CUE_THRESHOLDS even with the script
// tag loaded before it.
if (typeof globalThis !== 'undefined') globalThis.CUE_THRESHOLDS = CUE_THRESHOLDS;
if (typeof window !== 'undefined') window.CUE_THRESHOLDS = CUE_THRESHOLDS;
if (typeof self !== 'undefined') self.CUE_THRESHOLDS = CUE_THRESHOLDS;
