/**
 * Cue — Decision Engine (v1.0 spec-driven)
 *
 * The intervention policy layer. Reads the enriched signal stream and outputs
 * exactly ONE decision per tick:
 *
 *   PAUSE         — user is talking too much; stop to listen
 *   ASK_QUESTION  — user hasn't asked a question in too long; probe
 *   CONTINUE      — default (silent); flow is healthy
 *
 * Rules (v1 baseline):
 *   - IF speakingRatio > 0.75 over rolling 30s        → PAUSE
 *   - IF secSinceLastQuestion > 60s (after grace)     → ASK_QUESTION
 *   - IF interruption just happened                   → PAUSE
 *   - ELSE                                             → CONTINUE
 *
 * Design principles (from MOAT-FIRST spec):
 *   - Silence is a valid output. Over-coaching is failure.
 *   - Only ONE decision at a time. Priority: interruption > speaking_ratio > no_question.
 *   - No LLM. No external dependencies. Pure rules on pure signals.
 *   - Every non-CONTINUE decision is logged with full signal state for the
 *     behavioral reinforcement dataset (the core moat).
 *
 * The engine emits events; the downstream layer (offscreen doc) handles
 * logging, haptic delivery, and UI updates.
 */

class CueDecisionEngine {
  constructor(onDecision, options = {}) {
    this._onDecision = onDecision;

    // Thresholds (configurable per-session via options)
    this._speakingRatioThreshold = options.speakingRatioThreshold || 0.75;
    this._questionSilenceSec     = options.questionSilenceSec     || 60;
    this._cooldownSec            = options.cooldownSec            || 5;
    this._gracePeriodSec         = options.gracePeriodSec         || 10;
    this._interruptionCooldownSec = options.interruptionCooldownSec || 8;
    // v1.1.15 — interruption detection only makes sense when we have BOTH
    // streams (mic + tab). In mic-only mode, micro-pauses from the solo
    // speaker were falsely flagging as "interruptions". Gate by source.
    // Allowed values: 'mic', 'tab', 'both'. Default 'mic' for safety.
    this._source = options.source || 'mic';

    this._sessionStartTime = Date.now();
    this._lastDecisionTime = 0;
    this._lastDecision = 'CONTINUE';
    this._lastInterruptionCount = 0;

    // Sustain requirement — speakingRatio must stay above threshold for this
    // many consecutive ticks (~1.3s at 128ms/frame) before PAUSE fires.
    // Prevents momentary spikes from triggering a nudge.
    this._speakingRatioSustainTicks = options.speakingRatioSustainTicks || 10;
    this._ratioSustainCount = 0;

    // Counts
    this._decisionCounts = { PAUSE: 0, ASK_QUESTION: 0, CONTINUE: 0 };
    this._decisionHistory = []; // ring buffer of non-CONTINUE decisions this session
  }

  get decisionCounts() { return { ...this._decisionCounts }; }
  get decisionHistory() { return [...this._decisionHistory]; }

  /**
   * Main input — called on every signal tick.
   * @param {Object} signal — output from CueSignalModel.process()
   * @returns {string} the decision made this tick
   */
  process(signal) {
    const now = Date.now();
    const sessionAge = (now - this._sessionStartTime) / 1000;

    // Grace period: no interventions early in the session
    if (sessionAge < this._gracePeriodSec) {
      return this._emit('CONTINUE', signal, { reason: 'grace_period' });
    }

    // Still calibrating → silent
    if (signal.isCalibrating) {
      return this._emit('CONTINUE', signal, { reason: 'calibrating' });
    }

    // Cooldown — don't fire interventions rapid-fire
    const secSinceLast = (now - this._lastDecisionTime) / 1000;
    if (this._lastDecision !== 'CONTINUE' && secSinceLast < this._cooldownSec) {
      return this._emit('CONTINUE', signal, { reason: 'cooldown' });
    }

    // Priority 1: INTERRUPTION → PAUSE
    // v1.1.15 — only valid when we have a second speaker stream. In mic-only
    // mode the user is talking to no one we can measure; their own micro-pauses
    // were getting flagged. Skip entirely in mic-only mode.
    if (this._source !== 'mic' &&
        signal.interruptionCount > this._lastInterruptionCount) {
      this._lastInterruptionCount = signal.interruptionCount;
      // Only pause if we haven't pause'd recently (stricter cooldown)
      if (secSinceLast >= this._interruptionCooldownSec) {
        return this._emit('PAUSE', signal, { reason: 'interruption' });
      }
    } else if (this._source === 'mic') {
      // Keep counter aligned so a later mode-switch doesn't burst-fire.
      this._lastInterruptionCount = signal.interruptionCount || 0;
    }

    // Priority 2: SPEAKING RATIO too high → PAUSE
    // Must sustain for N consecutive ticks to avoid momentary spikes.
    if (signal.speakingRatio > this._speakingRatioThreshold) {
      this._ratioSustainCount++;
      if (this._ratioSustainCount >= this._speakingRatioSustainTicks) {
        this._ratioSustainCount = 0;
        return this._emit('PAUSE', signal, {
          reason: 'speaking_ratio_high',
          ratio: signal.speakingRatio.toFixed(2),
        });
      }
    } else {
      this._ratioSustainCount = 0; // reset on drop below threshold
    }

    // Priority 3: NO QUESTION in too long → ASK_QUESTION
    //   Only if the user has been active (speaking_ratio not trivially low)
    if (signal.secSinceLastQuestion > this._questionSilenceSec &&
        signal.speakingRatio > 0.15) {
      return this._emit('ASK_QUESTION', signal, {
        reason: 'no_question_in_window',
        sec: Math.round(signal.secSinceLastQuestion),
      });
    }

    // Default
    return this._emit('CONTINUE', signal, { reason: 'healthy' });
  }

  _emit(decision, signal, meta) {
    const now = Date.now();
    this._decisionCounts[decision]++;

    const event = {
      decision,
      timestamp: now,
      sessionAgeSec: (now - this._sessionStartTime) / 1000,
      signalState: {
        speakingRatio: Math.round((signal.speakingRatio || 0) * 100) / 100,
        pace: Math.round(signal.pace),
        tension: Math.round(signal.tension),
        energy: Math.round(signal.energy),
        questionCount: signal.questionCount || 0,
        secSinceLastQuestion: Math.round(signal.secSinceLastQuestion || 0),
        interruptionCount: signal.interruptionCount || 0,
        continuousSpeechSec: signal.continuousSpeechSec || 0,
      },
      meta,
    };

    // Log only non-CONTINUE decisions (reduce noise)
    if (decision !== 'CONTINUE') {
      this._decisionHistory.push(event);
      if (this._decisionHistory.length > 100) this._decisionHistory.shift();
      this._lastDecisionTime = now;
      this._lastDecision = decision;
      console.log(`[Decision] ${decision} —`, meta);
    }

    if (this._onDecision) this._onDecision(event);
    return decision;
  }

  /** Update audio source mode mid-session ('mic' | 'tab' | 'both'). */
  setSource(source) {
    if (source && source !== this._source) {
      this._source = source;
      // Clear stale counter so a mode-switch doesn't immediately fire.
      this._lastInterruptionCount = 0;
    }
  }

  reset() {
    this._sessionStartTime = Date.now();
    this._lastDecisionTime = 0;
    this._lastDecision = 'CONTINUE';
    this._lastInterruptionCount = 0;
    this._ratioSustainCount = 0;
    this._decisionCounts = { PAUSE: 0, ASK_QUESTION: 0, CONTINUE: 0 };
    this._decisionHistory = [];
  }
}
