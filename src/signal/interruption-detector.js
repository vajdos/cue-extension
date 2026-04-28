/**
 * Cue — Interruption Detector (v1.0 dual-stream)
 *
 * Consumes VAD-level isSpeech flags from TWO concurrent audio streams
 * (user mic + remote tab audio) and flags a real interruption event when
 * both streams are "speaking" simultaneously for a sustained window.
 *
 * A real interruption = user started talking while the other person was
 * still speaking. The spec-correct signal, not the "short-pause proxy"
 * used in the mic-only mode.
 *
 * Each stream reports into `updateUser(isSpeech)` and `updateRemote(isSpeech)`
 * independently. The detector internally tracks an overlap timer.
 *
 * Debouncing:
 *   - Overlap must sustain for >300ms before firing (avoids transient
 *     filler sounds or breath noise)
 *   - 4s cooldown between interruption events
 */

class CueInterruptionDetector {
  constructor(onInterruption, options = {}) {
    this._onInterruption = onInterruption;
    this._overlapSustainMs = options.overlapSustainMs || 300;
    this._cooldownMs       = options.cooldownMs || 4000;

    this._userSpeaking = false;
    this._remoteSpeaking = false;
    this._overlapStartTime = null;
    this._lastInterruptionTime = 0;
    this._count = 0;
    this._history = []; // last 20 interruption events
  }

  get count() { return this._count; }
  get history() { return [...this._history]; }

  /**
   * Update the user's (mic) VAD state.
   */
  updateUser(isSpeech) {
    this._userSpeaking = !!isSpeech;
    this._checkOverlap();
  }

  /**
   * Update the remote (tab) VAD state.
   */
  updateRemote(isSpeech) {
    this._remoteSpeaking = !!isSpeech;
    this._checkOverlap();
  }

  _checkOverlap() {
    const now = Date.now();
    const both = this._userSpeaking && this._remoteSpeaking;

    if (both) {
      if (this._overlapStartTime === null) {
        this._overlapStartTime = now;
      } else {
        const overlapMs = now - this._overlapStartTime;
        if (overlapMs >= this._overlapSustainMs) {
          // Sustained overlap — check cooldown
          if (now - this._lastInterruptionTime >= this._cooldownMs) {
            this._lastInterruptionTime = now;
            this._count++;
            const event = {
              timestamp: now,
              overlapMs: Math.round(overlapMs),
              count: this._count,
            };
            this._history.push(event);
            if (this._history.length > 20) this._history.shift();
            console.log('[Interrupt] Detected interruption #' + this._count +
              ' (overlap ' + event.overlapMs + 'ms)');
            if (this._onInterruption) this._onInterruption(event);
          }
          // Reset overlap start so a continuous overlap doesn't re-fire
          // until both streams drop back to single-speaker state.
          this._overlapStartTime = null;
        }
      }
    } else {
      // Drop out of overlap — reset the timer
      this._overlapStartTime = null;
    }
  }

  reset() {
    this._userSpeaking = false;
    this._remoteSpeaking = false;
    this._overlapStartTime = null;
    this._lastInterruptionTime = 0;
    this._count = 0;
    this._history = [];
  }
}
