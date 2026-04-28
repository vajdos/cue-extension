/**
 * Cue — Adaptation Engine
 *
 * Auto-tunes nudge thresholds based on the user's session history.
 * Philosophy: Cue should get gentler for users who are already improving
 * (fewer nudges needed) and sharper for users who are plateauing (too few
 * nudges to learn). This is the first "continuously improving" loop.
 *
 * Storage:
 *   chrome.storage.local.cueSessionHistory — array of session summaries
 *   chrome.storage.local.cueAdaptation     — computed deltas (for transparency)
 *
 * Data unit (one per completed session):
 *   { id, startTime, endTime, durationMs, nudgeCount, avgPace, avgTension, timestamp }
 *
 * Rules:
 *   - If rolling avg nudges over last 3 sessions > 5 → raise thresholds +2 each
 *   - If rolling avg nudges < 1 AND avg duration > 2 min → lower thresholds -2
 *   - Cap: adjustments stay within ±10 of the base threshold
 *   - Never push a threshold below 50 or above 90
 */

class CueAdaptationEngine {
  constructor(options = {}) {
    this._windowSize = options.windowSize || 3;
    this._maxAdjustment = options.maxAdjustment || 10;
    this._nudgesHighThreshold = options.nudgesHighThreshold || 5;
    this._nudgesLowThreshold = options.nudgesLowThreshold || 1;
    this._minDurationForLoweringSec = options.minDurationForLoweringSec || 120;
    this._minThreshold = options.minThreshold || 50;
    this._maxThreshold = options.maxThreshold || 90;
  }

  /**
   * Compute adjustment deltas from a history array.
   * @param {Array} history — last N session summaries (any length)
   * @param {Object} baseThresholds — { pace, tension, longSpeech }
   * @returns {Object} { paceDelta, tensionDelta, longSpeechDelta, reason }
   */
  computeAdjustment(history, baseThresholds) {
    const deltas = { paceDelta: 0, tensionDelta: 0, longSpeechDelta: 0, reason: 'insufficient_history' };

    if (!Array.isArray(history) || history.length === 0) return deltas;

    // Take the last N sessions (windowSize)
    const recent = history.slice(-this._windowSize);
    const n = recent.length;

    const avgNudges = recent.reduce((s, x) => s + (x.nudgeCount || 0), 0) / n;
    const avgDurationSec = recent.reduce((s, x) => s + ((x.durationMs || 0) / 1000), 0) / n;

    if (avgNudges > this._nudgesHighThreshold) {
      // Too many nudges → raise thresholds (less sensitive)
      deltas.paceDelta = +2;
      deltas.tensionDelta = +2;
      deltas.longSpeechDelta = +5; // seconds, not 0-100
      deltas.reason = `avg ${avgNudges.toFixed(1)} nudges/session over last ${n} — raising thresholds to reduce interruption`;
    } else if (avgNudges < this._nudgesLowThreshold && avgDurationSec > this._minDurationForLoweringSec) {
      // Too few nudges with meaningful session length → lower thresholds (more sensitive)
      deltas.paceDelta = -2;
      deltas.tensionDelta = -2;
      deltas.longSpeechDelta = -5;
      deltas.reason = `avg ${avgNudges.toFixed(1)} nudges/session with avg ${Math.round(avgDurationSec)}s duration — lowering thresholds for more engagement`;
    } else {
      deltas.reason = `avg ${avgNudges.toFixed(1)} nudges/session — no adjustment`;
    }

    // Clamp to ±maxAdjustment relative to base, AND to [minThreshold..maxThreshold]
    if (baseThresholds) {
      const clampFor = (delta, base) => {
        const proposed = base + delta;
        const floored = Math.max(this._minThreshold, Math.min(this._maxThreshold, proposed));
        const clampedDelta = floored - base;
        return Math.max(-this._maxAdjustment, Math.min(this._maxAdjustment, clampedDelta));
      };
      deltas.paceDelta = clampFor(deltas.paceDelta, baseThresholds.pace || 65);
      deltas.tensionDelta = clampFor(deltas.tensionDelta, baseThresholds.tension || 70);
      // longSpeech is in seconds, different clamp
      const minLongSpeech = 15, maxLongSpeech = 120;
      const baseLS = baseThresholds.longSpeech || 30;
      const proposedLS = baseLS + deltas.longSpeechDelta;
      deltas.longSpeechDelta = Math.max(minLongSpeech, Math.min(maxLongSpeech, proposedLS)) - baseLS;
    }

    return deltas;
  }

  /**
   * Apply deltas to CUE_THRESHOLDS in-place.
   */
  applyToThresholds(deltas, thresholds) {
    if (!thresholds || !deltas) return;
    if (typeof thresholds.PACE_THRESHOLD === 'number') thresholds.PACE_THRESHOLD += (deltas.paceDelta || 0);
    if (typeof thresholds.TENSION_THRESHOLD === 'number') thresholds.TENSION_THRESHOLD += (deltas.tensionDelta || 0);
    if (typeof thresholds.LONG_SPEECH_SEC === 'number') thresholds.LONG_SPEECH_SEC += (deltas.longSpeechDelta || 0);
  }
}
