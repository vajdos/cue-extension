/**
 * Cue — Nudge Engine
 *
 * Monitors signal scores and triggers nudge events when thresholds are crossed.
 *
 * Features:
 *   - Grace period: no nudges during first 30 seconds
 *   - Sustain: signal must exceed threshold for 5 consecutive frames (~640ms)
 *   - Cooldown: minimum 30 seconds between nudges
 *   - Priority: escalation > tension > pace > long_speech
 *   - Long unbroken speech detection (45 seconds without a pause)
 *
 * Usage:
 *   const engine = new CueNudgeEngine(onNudge);
 *   engine.process(signalOutput); // called every ~128ms
 */

class CueNudgeEngine {
  constructor(onNudge, options = {}) {
    this._onNudge = onNudge;  // callback: (nudgeEvent) => void
    this._sessionStartTime = Date.now();
    this._lastNudgeTime = 0;
    this._isPro = options.isPro || false;
    this._freeNudgeLimit = 3;  // Free tier: max 3 nudges per call

    // Sustain counters — track consecutive frames above threshold
    this._sustainCounters = {
      pace: 0,
      tension: 0,
      escalation: 0
    };

    // Statistics
    this._nudgeCount = 0;
    this._nudgeHistory = [];  // { type, timestamp, scores }
  }

  get nudgeCount() {
    return this._nudgeCount;
  }

  get nudgeHistory() {
    return [...this._nudgeHistory];
  }

  /**
   * Process signal scores and check for nudge triggers.
   *
   * @param {Object} signal - Output from CueSignalModel.process():
   *   { tension, pace, energy, isSpeech, isCalibrating, continuousSpeechSec }
   */
  process(signal) {
    const now = Date.now();
    const sessionAge = (now - this._sessionStartTime) / 1000;
    const cooldownElapsed = (now - this._lastNudgeTime) / 1000;

    // -- Grace period: no nudges in first 30 seconds --
    if (sessionAge < CUE_THRESHOLDS.GRACE_PERIOD_SEC) {
      this._resetAllCounters();
      return;
    }

    // -- Still calibrating: no nudges --
    if (signal.isCalibrating) {
      this._resetAllCounters();
      return;
    }

    // -- Cooldown: wait at least 30 seconds between nudges --
    if (this._lastNudgeTime > 0 && cooldownElapsed < CUE_THRESHOLDS.COOLDOWN_SEC) {
      // Still in cooldown, but keep tracking sustain counters
      // (so a sustained signal during cooldown can fire immediately when cooldown ends)
      this._updateCounters(signal);
      return;
    }

    // -- Update sustain counters --
    this._updateCounters(signal);

    // -- Check triggers in priority order --
    // Priority: escalation > tension > pace > long_speech

    // 1. ESCALATION: All three signals elevated simultaneously
    if (this._sustainCounters.escalation >= CUE_THRESHOLDS.SUSTAIN_FRAMES) {
      this._fireNudge('escalation', signal, now);
      return;
    }

    // 2. TENSION: Voice tension/stress elevated
    if (this._sustainCounters.tension >= CUE_THRESHOLDS.SUSTAIN_FRAMES) {
      this._fireNudge('tension', signal, now);
      return;
    }

    // 3. PACE: Speaking too fast
    if (this._sustainCounters.pace >= CUE_THRESHOLDS.SUSTAIN_FRAMES) {
      this._fireNudge('pace', signal, now);
      return;
    }

    // 4. LONG SPEECH: Speaking continuously without pause
    if (signal.isSpeech && signal.continuousSpeechSec >= CUE_THRESHOLDS.LONG_SPEECH_SEC) {
      this._fireNudge('long_speech', signal, now);
      return;
    }
  }

  /**
   * Update sustain counters based on current scores.
   * Counter increments when above threshold, resets to 0 when below.
   */
  _updateCounters(signal) {
    // Pace counter
    if (signal.pace > CUE_THRESHOLDS.PACE_THRESHOLD) {
      this._sustainCounters.pace++;
    } else {
      this._sustainCounters.pace = 0;  // Hard reset, not decrement
    }

    // Tension counter
    if (signal.tension > CUE_THRESHOLDS.TENSION_THRESHOLD) {
      this._sustainCounters.tension++;
    } else {
      this._sustainCounters.tension = 0;
    }

    // Escalation counter (all three must be elevated)
    if (signal.tension > CUE_THRESHOLDS.ESCALATION_TENSION &&
        signal.pace > CUE_THRESHOLDS.ESCALATION_PACE &&
        signal.energy > CUE_THRESHOLDS.ESCALATION_ENERGY) {
      this._sustainCounters.escalation++;
    } else {
      this._sustainCounters.escalation = 0;
    }
  }

  /**
   * Fire a nudge event.
   */
  _fireNudge(type, signal, timestamp) {
    // Free tier: limit nudges per call
    if (!this._isPro && this._nudgeCount >= this._freeNudgeLimit) {
      console.log(`[Cue Nudge] Free tier limit reached (${this._freeNudgeLimit} nudges). Upgrade to Pro for unlimited.`);
      // Still record in history but don't display
      this._nudgeHistory.push({
        type: type,
        timestamp: timestamp,
        scores: { tension: Math.round(signal.tension), pace: Math.round(signal.pace), energy: Math.round(signal.energy) },
        blocked: true
      });
      this._resetAllCounters();
      this._lastNudgeTime = timestamp;
      return;
    }

    // Reset all counters after firing
    this._resetAllCounters();
    this._lastNudgeTime = timestamp;
    this._nudgeCount++;

    const nudgeEvent = {
      type: type,
      timestamp: timestamp,
      scores: {
        tension: Math.round(signal.tension),
        pace: Math.round(signal.pace),
        energy: Math.round(signal.energy)
      },
      continuousSpeechSec: Math.round(signal.continuousSpeechSec),
      nudgeNumber: this._nudgeCount
    };

    // Store in history
    this._nudgeHistory.push(nudgeEvent);

    console.log(`[Cue Nudge] 🔔 ${type.toUpperCase()} nudge #${this._nudgeCount}`,
      `T:${nudgeEvent.scores.tension} P:${nudgeEvent.scores.pace} E:${nudgeEvent.scores.energy}`);

    // Dispatch to callback
    if (this._onNudge) {
      this._onNudge(nudgeEvent);
    }
  }

  _resetAllCounters() {
    this._sustainCounters.pace = 0;
    this._sustainCounters.tension = 0;
    this._sustainCounters.escalation = 0;
  }
}
