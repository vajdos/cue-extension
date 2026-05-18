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
  // v1.1.6 — Five tone packs (gentle / direct / warm / dry / playful) plus a
  // regional flavor selector for the playful pack. Each pack defines text for
  // the four nudge types: pace, tension, long_speech, escalation.
  // Backward compat: 'directive' kept as alias for 'direct'; 'minimal' kept.
  // Selection: cueSettings.nudgePack picks the pack name; cueSettings.toneFlavor
  // picks the sub-flavor for 'playful' (defaults to 'neutral').
  NUDGE_PACKS: {
    gentle: {
      pace: 'Slow it down',
      tension: 'Take a breath',
      long_speech: 'Give them space',
      escalation: 'Take a breath'
    },
    direct: {
      pace: 'SLOW DOWN',
      tension: 'BREATHE. PAUSE.',
      long_speech: 'LET THEM SPEAK',
      escalation: 'BREATHE. PAUSE.'
    },
    // Backward-compat alias — older saved settings used 'directive'
    directive: {
      pace: 'SLOW DOWN',
      tension: 'BREATHE. PAUSE.',
      long_speech: 'LET THEM SPEAK',
      escalation: 'BREATHE. PAUSE.'
    },
    warm: {
      pace: 'Ease into it — you’ve got this',
      tension: 'You’re solid. One slow breath.',
      long_speech: 'Let them in — your voice will land',
      escalation: 'Breathe. You’ve got the room.'
    },
    dry: {
      pace: 'Pace high',
      tension: 'Tension high',
      long_speech: '30s+ unbroken',
      escalation: 'Pace + tension high'
    },
    playful: {
      // Sub-flavors — selected via cueSettings.toneFlavor.
      // Pack consumers should look up: NUDGE_PACKS.playful[flavor || 'neutral']
      neutral: {
        pace: 'Take a beat',
        tension: 'Easy now — exhale',
        long_speech: 'Toss it back to them',
        escalation: 'Whoa — breathe'
      },
      yiddish: {
        pace: 'Nu, slow down a touch',
        tension: 'Bubbeleh, take a breath',
        long_speech: 'Enough kibitzing — let them in',
        escalation: 'Oy — pause and breathe'
      },
      southern: {
        pace: 'Take it slow, hon',
        tension: 'Easy does it now',
        long_speech: 'Give ’em a turn',
        escalation: 'Whoa friend, breathe'
      },
      british_dry: {
        pace: 'Steady on',
        tension: 'Bit tight, that',
        long_speech: 'Their turn, perhaps',
        escalation: 'Right. Breathe.'
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
