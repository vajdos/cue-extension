/**
 * Cue — Threshold Constants
 *
 * All configurable thresholds and timing constants in one place.
 * These are tuned for Nathan's speaking style (talks fast, over-explains).
 *
 * Scores are 0-100, calibrated relative to the user's own baseline.
 */

const CUE_THRESHOLDS = {
  // -- Nudge Trigger Thresholds --
  // Score must exceed these for sustained frames to trigger a nudge.
  // Lowered further so demos actually produce nudges in 2-3 min sessions.
  PACE_THRESHOLD: 65,           // was 70 — user talks fast, make sensitive
  TENSION_THRESHOLD: 70,        // was 75
  ENERGY_THRESHOLD: 75,         // was 80 — only used in escalation compound

  // -- Long Unbroken Speech --
  LONG_SPEECH_SEC: 30,          // Nudge if speaking continuously for 30s
  PAUSE_DURATION_SEC: 2,        // Silence >= 2s counts as a "pause"

  // -- Escalation (compound signal) --
  ESCALATION_TENSION: 55,       // was 60 — all three must exceed simultaneously
  ESCALATION_PACE: 60,          // was 65
  ESCALATION_ENERGY: 65,        // was 70

  // -- Sustain & Cooldown --
  SUSTAIN_FRAMES: 3,            // ~384ms at 128ms per frame — must stay above threshold
  COOLDOWN_SEC: 5,              // Minimum seconds between nudges (was 15 — tightened per Nathan)
  GRACE_PERIOD_SEC: 10,         // No nudges during first 10 seconds of session

  // -- Calibration --
  CALIBRATION_SPEECH_SEC: 5,    // Calibrate on first 5 seconds of active speech (was 15)
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
  NUDGE_PACKS: {
    directive: {
      pace: 'SLOW DOWN',
      tension: 'BREATHE. PAUSE.',
      long_speech: 'LET THEM SPEAK',
      escalation: 'BREATHE. PAUSE.'
    },
    gentle: {
      pace: 'Slow it down',
      tension: 'Take a breath',
      long_speech: 'Give them space',
      escalation: 'Take a breath'
    },
    minimal: {
      pace: null,    // glow only, no text
      tension: null,
      long_speech: null,
      escalation: null
    }
  }
};
