/**
 * Cue — Coaching Engine
 *
 * The ENGAGEMENT layer. Complements the NudgeEngine (which handles warnings)
 * by delivering positive feedback and gentle check-ins at an adaptive cadence.
 *
 * Philosophy: Cue should feel like an engaged coach, not a watchdog.
 * - Fire a context-aware welcome right after calibration completes
 * - While speaking steadily: occasional affirmations ("Steady pace", "Calm tone")
 * - While listening (silent): occasional "Good listening" affirmations
 * - Adaptive: quiet when user is flowing, more active when user needs direction
 * - Anti-repeat: same message type never fires twice in a row
 * - Non-interrupting: positive cues go to a small inline bubble (not the big card)
 *
 * Intensity levels control cadence:
 *   - silent:  no positive cues (warnings only)
 *   - gentle:  check-in every ~25-30s (default)
 *   - active:  every ~12-18s
 *   - intense: every ~6-10s
 */

class CueCoachingEngine {
  constructor(onCoach, options = {}) {
    this._onCoach = onCoach; // callback: (coachEvent) => void
    this._intensity = options.intensity || 'gentle';

    // State tracking
    this._calibrationComplete = false;
    this._welcomeFired = false;
    this._sessionStartTime = Date.now();
    this._lastCoachTime = 0;
    this._lastCoachType = null;
    this._recentTypes = []; // ring buffer of last 3 types to avoid repeats

    // Signal history for context-aware messages
    this._signalHistory = []; // last 30 signal snapshots
    this._maxHistory = 30;

    // Speech-vs-listening detection
    this._silenceStartTime = null;
    this._speechStartTime = null;
    this._continuousSilenceSec = 0;
    this._continuousSpeechSec = 0;

    // Intensity → cadence (seconds between positive cues)
    this._cadenceByIntensity = {
      silent:  Infinity,
      gentle:  28,
      active:  15,
      intense: 8,
    };

    // Listening-mode affirmation threshold (silence duration before we affirm)
    this._listeningAffirmAfterSec = 15;

    // Welcome delay after calibration (Q2 asked for positive within 5s)
    this._welcomeDelaySec = 3;
  }

  /**
   * Message catalog. Each category has 3 variants for rotation/anti-repeat.
   * Types map to the 'category' field of the emitted coach event.
   */
  static CATALOG = {
    welcome_steady:     ['Cue is active — speak freely', 'You\u2019re warmed up', 'Nice steady start'],
    welcome_variable:   ['Cue is active — speak freely', 'You\u2019re warmed up — ready when you are', 'Calibrated to your voice'],
    welcome_quiet:      ['Cue is active — speak freely', 'Calibrated — take your time', 'I\u2019m listening'],

    steady_pace:        ['Steady pace', 'Right tempo', 'Good rhythm'],
    calm_tone:          ['Calm tone', 'You sound grounded', 'Centered'],
    nice_pause:         ['Nice pause', 'Good space', 'Well-timed pause'],
    flowing_well:       ['Flowing well', 'In a groove', 'Locked in'],
    faster:             ['A bit faster', 'Pick up the pace', 'Step up'],
    good_listening:     ['Good listening', 'Taking it in', 'Present'],
  };

  setIntensity(level) {
    if (this._cadenceByIntensity.hasOwnProperty(level)) {
      this._intensity = level;
    }
  }

  /**
   * Main input — called every frame with the current signal.
   * @param {Object} signal — output from CueSignalModel.process()
   */
  process(signal) {
    const now = Date.now();

    // Track calibration transition
    if (this._calibrationComplete === false && signal.isCalibrating === false) {
      this._calibrationComplete = true;
      this._calibrationCompleteTime = now;
    }

    // Nothing to do if still calibrating or intensity is silent
    if (signal.isCalibrating) return;
    if (this._intensity === 'silent') return;

    // Track speech / silence duration for listening-mode detection
    if (signal.isSpeech) {
      if (this._silenceStartTime !== null) {
        this._silenceStartTime = null;
        this._continuousSilenceSec = 0;
      }
      if (this._speechStartTime === null) this._speechStartTime = now;
      this._continuousSpeechSec = (now - this._speechStartTime) / 1000;
    } else {
      if (this._speechStartTime !== null) {
        this._speechStartTime = null;
        this._continuousSpeechSec = 0;
      }
      if (this._silenceStartTime === null) this._silenceStartTime = now;
      this._continuousSilenceSec = (now - this._silenceStartTime) / 1000;
    }

    // Snapshot history
    this._signalHistory.push({
      t: now,
      tension: signal.tension,
      pace: signal.pace,
      energy: signal.energy,
      isSpeech: signal.isSpeech,
    });
    if (this._signalHistory.length > this._maxHistory) this._signalHistory.shift();

    // 1. WELCOME — fire once, ~3s after calibration completes
    if (!this._welcomeFired) {
      const secSinceCal = (now - this._calibrationCompleteTime) / 1000;
      if (secSinceCal >= this._welcomeDelaySec) {
        this._fireWelcome(signal);
        this._welcomeFired = true;
      }
      return;
    }

    // 2. After welcome, respect cadence
    const cadenceSec = this._cadenceByIntensity[this._intensity];
    const secSinceLastCoach = (now - this._lastCoachTime) / 1000;
    if (secSinceLastCoach < cadenceSec) return;

    // 3. Pick a message based on state
    let type = null;

    if (this._continuousSilenceSec >= this._listeningAffirmAfterSec) {
      // Listening mode — affirm the listening
      type = 'good_listening';
    } else if (signal.isSpeech && this._continuousSpeechSec >= 5) {
      // Active speaking — pick a positive based on current signal state
      type = this._pickSpeakingAffirmation(signal);
    } else {
      // Too brief / transitional — skip this tick
      return;
    }

    if (!type) return;

    this._fireCoach(type, signal);
  }

  /**
   * Pick a positive or gentle-corrective based on current signal state.
   */
  _pickSpeakingAffirmation(signal) {
    // Decision tree based on signal — pick the MOST informative positive/correction
    const T = CUE_THRESHOLDS;

    // If pace is TOO slow (well below baseline midpoint), suggest faster
    if (signal.pace < 25) return 'faster';

    // If all three are in the healthy middle band, flowing
    const midband = (v) => v >= 30 && v <= 60;
    if (midband(signal.tension) && midband(signal.pace) && midband(signal.energy)) {
      // Rotate through steady_pace / calm_tone / flowing_well
      return this._chooseUnique(['steady_pace', 'calm_tone', 'flowing_well']);
    }

    // If tension is particularly calm (low-stable), affirm calm tone
    if (signal.tension < 40) return 'calm_tone';

    // If pace is solidly mid, affirm steady pace
    if (midband(signal.pace)) return 'steady_pace';

    // Otherwise: defer (the Nudge engine will handle warnings)
    return null;
  }

  /**
   * Pick a type from options not recently used.
   */
  _chooseUnique(options) {
    const fresh = options.filter(t => !this._recentTypes.includes(t));
    const pool = fresh.length > 0 ? fresh : options;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Fire the welcome — context-aware based on calibration variability.
   */
  _fireWelcome(signal) {
    // Determine calibration pattern from recent history
    const recent = this._signalHistory.slice(-10);
    let variability = 0;
    for (let i = 1; i < recent.length; i++) {
      variability += Math.abs(recent[i].tension - recent[i - 1].tension);
      variability += Math.abs(recent[i].pace - recent[i - 1].pace);
    }
    variability = variability / Math.max(1, recent.length - 1);

    let welcomeType;
    if (variability < 8) welcomeType = 'welcome_steady';
    else if (variability > 20) welcomeType = 'welcome_variable';
    else welcomeType = 'welcome_quiet';

    this._fireCoach(welcomeType, signal, { isWelcome: true });
  }

  _fireCoach(type, signal, meta = {}) {
    const now = Date.now();
    const variants = CueCoachingEngine.CATALOG[type] || [type];
    const text = this._chooseVariantNotRecent(type, variants);

    this._lastCoachTime = now;
    this._lastCoachType = type;
    this._recentTypes.push(type);
    if (this._recentTypes.length > 3) this._recentTypes.shift();

    const event = {
      type: type,
      text: text,
      timestamp: now,
      tone: type.startsWith('welcome_') ? 'welcome'
          : type === 'faster'           ? 'corrective'
          : type === 'good_listening'   ? 'listening'
          : 'positive',
      scores: {
        tension: Math.round(signal.tension),
        pace: Math.round(signal.pace),
        energy: Math.round(signal.energy),
      },
      ...meta,
    };

    console.log(`[Cue Coach] ${event.tone.toUpperCase()}: ${text}`);
    if (this._onCoach) this._onCoach(event);
  }

  /**
   * Pick a variant from the type's list, avoiding the most-recent one for this type.
   */
  _chooseVariantNotRecent(type, variants) {
    if (!this._variantHistory) this._variantHistory = {};
    const last = this._variantHistory[type];
    const pool = variants.filter(v => v !== last);
    const chosen = (pool.length ? pool : variants)[Math.floor(Math.random() * (pool.length || variants.length))];
    this._variantHistory[type] = chosen;
    return chosen;
  }

  /**
   * Reset state (new session).
   */
  reset() {
    this._calibrationComplete = false;
    this._welcomeFired = false;
    this._sessionStartTime = Date.now();
    this._lastCoachTime = 0;
    this._lastCoachType = null;
    this._recentTypes = [];
    this._signalHistory = [];
    this._variantHistory = {};
    this._silenceStartTime = null;
    this._speechStartTime = null;
    this._continuousSilenceSec = 0;
    this._continuousSpeechSec = 0;
  }
}
