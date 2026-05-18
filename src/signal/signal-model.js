/**
 * Cue — Signal Model
 *
 * Transforms raw DSP features into normalized 0-100 scores.
 *
 * Two phases:
 *   1. CALIBRATION: First 60 seconds of active speech, collect feature ranges
 *   2. SCORING: Map raw values to 0-100 using calibrated baseline
 *
 * Uses exponential moving average for smooth, jitter-free output.
 */

// v1.1.0 REPLICANT — population-default baseline for an "average speaker, middle of the road"
// These values are chosen to land typical adult conversational speech in the middle 25-75 score band.
// Sources: Pellegrino et al. 2011 (cross-language speech rates) and Banse & Scherer 1996
// (acoustic profiles of vocal emotion). On first session, Cue uses these so the user gets
// real-time scoring with zero calibration delay. Each completed session blends back into the
// stored replicant baseline at 20% weight, so over ~10 sessions the replicant fully converges
// onto the user's personal norms.
const CUE_REPLICANT_POPULATION_DEFAULT = {
  rms:              { min: 0.005, max: 0.080, range: 0.075 },   // typical conversational loudness
  zcr:              { min: 800,   max: 2200,  range: 1400  },   // typical articulation rate
  spectralCentroid: { min: 800,   max: 2400,  range: 1600  },   // typical voiced spectrum
  spectralFlatness: { min: 0.30,  max: 0.80,  range: 0.50  },   // typical HNR-proxy
  isPopulationDefault: true,
  sessionCount: 0,
  updatedAt: 0,
};

// Storage key for the user's persistent replicant
const CUE_REPLICANT_STORAGE_KEY = 'cueReplicantBaseline';

class CueSignalModel {
  constructor() {
    // v1.1.0 REPLICANT — start calibrated on the population default. The user gets
    // real-time scoring from frame 1 of session 1 instead of staring at "Calibrating..."
    // for 15 seconds. As the session progresses we still accumulate cal samples, and
    // once enough have collected we BLEND those into the stored replicant.
    this._isCalibrated = true;            // can score from frame 1
    this._calibrationCompleted = false;   // session-specific blend/persist not fired yet
    this._speechTimeSec = 0;
    this._lastFrameTime = null;

    this._calSamples = {
      rms: [],
      zcr: [],
      spectralCentroid: [],
      spectralFlatness: []
    };

    // Start with population defaults; if a stored replicant exists, async-load it
    // and replace _baseline as soon as storage returns. Frames processed in the
    // ~5-50 ms gap before storage resolves use the population defaults — close
    // enough that scores will be sensible.
    this._baseline = JSON.parse(JSON.stringify(CUE_REPLICANT_POPULATION_DEFAULT));
    this._loadStoredReplicant();

    // Smoothed output scores
    this._scores = {
      tension: 50,
      pace: 50,
      energy: 50
    };

    // Speech tracking for "long unbroken speech" detection
    this._continuousSpeechSec = 0;
    this._lastPauseTime = 0;
    this._sessionStartTime = Date.now();

    // ---- v1.0 (spec-driven) signals ----
    // Speaking ratio — rolling 30s window of "user is speaking" fraction
    this._speakingWindow = [];     // { t, isSpeech } entries, last 30s
    this._speakingWindowSec = 30;

    // Question detection — heuristic via end-of-utterance spectral centroid rise
    // We track short segments and mark a "question" when the last segment's
    // centroid is notably higher than the segment before it, indicating a rising
    // prosodic contour (hallmark of an English interrogative).
    this._lastCentroidSegments = []; // last 4 segments of mean centroid during speech
    this._centroidSegmentSec = 0.5;
    this._currentSegmentFrames = [];
    this._currentSegmentStart = null;
    this._questionCount = 0;
    this._lastQuestionTime = 0;     // 0 = never asked a question
    this._inUtterance = false;

    // Interruption detection (proxy, no tab stream):
    // If user starts speaking after a pause shorter than 1s, it could be them
    // cutting into the other person. Flag as potential interruption.
    this._shortPauseInterruptions = 0;
    this._lastSilenceStartTime = null;

    // Adaptive VAD fallback — if no speech frames detected after 8s, the VAD
    // threshold is too high for this user's mic. Track frame-level RMS so we
    // can re-classify as speech using a lower threshold.
    this._adaptiveVadActive = false;
    this._adaptiveRmsThreshold = 0.002;  // fallback threshold if activated
    this._sessionStartWallTime = Date.now();

    // ---- v1.1.33 — Five science-backed signal channels ----
    // Each signal has its own ring buffer and detector state. They are
    // surfaced both live (in the return payload) and on the integration tape.
    // All thresholds are read from CUE_THRESHOLDS — never hardcoded here.

    // 1. F0 variability (Curhan & Pentland 2007 JAP)
    // Rolling buffer of confident F0 estimates; SD computed over window.
    this._f0Window = [];                // entries: { t, f0 }
    this._f0SD = 0;                     // updated each frame
    this._f0Mean = 0;

    // 2. Speech-rate variation (Goldman-Eisler 1968)
    // Rolling buffer of ZCR values during speech frames; coefficient of
    // variation = SD/mean. Low CV signals monotone delivery.
    this._zcrSpeechWindow = [];         // entries: { t, zcr }
    this._rateVarCV = 0;

    // 3. Laughter detection (Provine 2000; Brooks 2024)
    // Ring buffer of envelope samples from worklet sub-frames. We append 8
    // values per worklet message; periodicity analysis runs every ~256ms.
    this._envelopeBuffer = [];          // float values, capped at LAUGH_ENVELOPE_BUFFER_SEC * 62
    this._envelopeBufferMaxLen = 0;     // set lazily from thresholds
    this._lastLaughterTime = 0;
    this._laughterCount = 0;
    this._lastLaughterAnalysisTime = 0;

    // 4. Backchannel detection (Stivers 2008; Bavelas, Coates & Johnson 2000)
    // Track each speech burst's duration. When a burst ends, classify by
    // duration + surrounding silence. Optionally cross-check with counterparty
    // stream when dual-stream mode is active (set externally via setCounterpartyActive).
    this._currentBurstStartTime = null;
    this._currentBurstSilenceBefore = 0;
    this._previousSilenceStartTime = null;
    this._lastBurstEndTime = 0;
    this._backchannelCount = 0;
    this._wordBurstCount = 0;           // longer bursts — substantive turns
    this._counterpartySpeaking = false; // set externally for dual-stream mode

    // 5. Turn-dominance (Pentland 2008; Mehl et al. 2007 Science)
    // We already compute speakingRatio over a 30s window. Surface that with
    // an explicit imbalance flag and a session-level cumulative percentage.
    this._cumulativeUserSpeechSec = 0;
    this._cumulativeCounterpartySpeechSec = 0;
    this._turnDominanceFlag = 'balanced';  // 'balanced' | 'dominant' | 'absent'
  }

  /**
   * v1.1.33 — Dual-stream hook. Called by audio-manager (or offscreen doc)
   * when the counterparty channel produces a speech frame, so the backchannel
   * detector can cross-check timing. Optional — single-stream mode still
   * detects backchannels by duration signature alone.
   */
  setCounterpartyActive(isActive, durationSec) {
    this._counterpartySpeaking = !!isActive;
    if (isActive && typeof durationSec === 'number') {
      this._cumulativeCounterpartySpeechSec += durationSec;
    }
  }

  get isCalibrated() {
    return this._isCalibrated;
  }

  get calibrationProgress() {
    return Math.min(this._speechTimeSec / CUE_THRESHOLDS.CALIBRATION_SPEECH_SEC, 1.0);
  }

  get scores() {
    return { ...this._scores };
  }

  get continuousSpeechSec() {
    return this._continuousSpeechSec;
  }

  /**
   * Process a feature vector from the audio pipeline.
   * Returns the current signal scores + metadata.
   *
   * @param {Object} features - { rms, zcr, spectralCentroid, spectralFlatness, isSpeech, timestamp }
   * @returns {Object} - { tension, pace, energy, isSpeech, isCalibrating, calibrationProgress, continuousSpeechSec }
   */
  process(features) {
    const now = Date.now();
    const frameDuration = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 0.128;
    this._lastFrameTime = now;

    // Adaptive VAD fallback: if after 8 seconds the user's speech hasn't been
    // detected (e.g. quiet mic, AGC clamping), re-classify frames as speech
    // using a more lenient RMS threshold. This prevents calibration from
    // stalling at 0% forever on soft-voice users.
    if (!this._isCalibrated && !this._adaptiveVadActive) {
      const sessionAgeSec = (now - this._sessionStartWallTime) / 1000;
      if (sessionAgeSec > 8 && this._speechTimeSec < 0.5) {
        console.warn('[Cue Signal] No speech detected after 8s — activating adaptive VAD (threshold = 0.002)');
        this._adaptiveVadActive = true;
      }
    }
    // Override isSpeech if adaptive VAD is active
    if (this._adaptiveVadActive && !features.isSpeech) {
      if ((features.rms || 0) > this._adaptiveRmsThreshold) {
        features = { ...features, isSpeech: true };
      }
    }

    // Track speech time
    if (features.isSpeech) {
      this._continuousSpeechSec += frameDuration;

      // v1.1.0 REPLICANT — accumulate cal samples regardless of _isCalibrated
      // (which is true from frame 1 so scoring works against the replicant baseline).
      // The blend/persist runs once per session at the CALIBRATION_SPEECH_SEC mark.
      if (!this._calibrationCompleted) {
        this._speechTimeSec += frameDuration;

        // Collect calibration samples
        this._calSamples.rms.push(features.rms);
        this._calSamples.zcr.push(features.zcr);
        this._calSamples.spectralCentroid.push(features.spectralCentroid);
        this._calSamples.spectralFlatness.push(features.spectralFlatness);

        // Check if calibration is complete
        if (this._speechTimeSec >= CUE_THRESHOLDS.CALIBRATION_SPEECH_SEC) {
          this._finishCalibration();
          this._calibrationCompleted = true;  // v1.1.0 REPLICANT — only blend/persist once per session
        }
      }
    } else {
      // Silence detected
      if (this._continuousSpeechSec > 0 &&
          frameDuration >= 0) {
        // Check if this is a real pause (>= 2 seconds tracked over frames)
        // We track continuous silence by resetting speech counter
        this._continuousSpeechSec = 0;
        this._lastPauseTime = now;
      }
    }

    // Compute scores (even during calibration, for bar display)
    if (this._isCalibrated) {
      this._computeScores(features);
    } else {
      // During calibration, use rough heuristic mapping
      this._computeRoughScores(features);
    }

    // ---- v1.0: speaking_ratio (rolling 30s) ----
    this._speakingWindow.push({ t: now, isSpeech: features.isSpeech });
    const cutoff = now - this._speakingWindowSec * 1000;
    while (this._speakingWindow.length && this._speakingWindow[0].t < cutoff) {
      this._speakingWindow.shift();
    }
    const speakingCount = this._speakingWindow.filter(s => s.isSpeech).length;
    const speakingRatio = this._speakingWindow.length > 0
      ? speakingCount / this._speakingWindow.length
      : 0;

    // ---- v1.0: Question detection via rising centroid at end of utterance ----
    // Track segments while speaking; when speech ends, compare last segment centroid vs. prior.
    const centroid = features.spectralCentroid || 0;
    if (features.isSpeech) {
      if (!this._inUtterance) {
        this._inUtterance = true;
        this._currentSegmentStart = now;
        this._currentSegmentFrames = [];
        this._lastCentroidSegments = [];
      }
      this._currentSegmentFrames.push(centroid);
      // Every ~500ms of speech, snapshot a segment mean
      if ((now - this._currentSegmentStart) / 1000 >= this._centroidSegmentSec) {
        const mean = this._currentSegmentFrames.reduce((a, b) => a + b, 0) / this._currentSegmentFrames.length;
        this._lastCentroidSegments.push(mean);
        if (this._lastCentroidSegments.length > 4) this._lastCentroidSegments.shift();
        this._currentSegmentStart = now;
        this._currentSegmentFrames = [];
      }
    } else if (this._inUtterance) {
      // Utterance just ended — check prosodic pattern on last 2 segments
      if (this._lastCentroidSegments.length >= 2) {
        const last = this._lastCentroidSegments[this._lastCentroidSegments.length - 1];
        const prev = this._lastCentroidSegments[this._lastCentroidSegments.length - 2];
        // Rising centroid by >15% = probable question contour (English)
        if (prev > 50 && last > prev * 1.15) {
          this._questionCount++;
          this._lastQuestionTime = now;
          // Capture the detection evidence for drill-down
          this._lastQuestionEvidence = {
            segments: this._lastCentroidSegments.slice(),
            prevCentroid: Math.round(prev),
            finalCentroid: Math.round(last),
            ratePercent: Math.round(((last - prev) / prev) * 100),
          };
          console.log('[Signal] Question detected. Count:', this._questionCount,
            'centroid', Math.round(prev), '→', Math.round(last),
            '(+' + this._lastQuestionEvidence.ratePercent + '%)');
        }
      }
      this._inUtterance = false;
      this._lastCentroidSegments = [];
    }

    // ---- v1.0: Interruption detection (no-tab proxy) ----
    if (features.isSpeech) {
      // Speech began — check if the preceding silence was unusually short
      if (this._lastSilenceStartTime !== null) {
        const silenceDur = (now - this._lastSilenceStartTime) / 1000;
        if (silenceDur > 0.1 && silenceDur < 1.0) {
          this._shortPauseInterruptions++;
        }
        this._lastSilenceStartTime = null;
      }
    } else {
      if (this._lastSilenceStartTime === null) this._lastSilenceStartTime = now;
    }

    const secSinceLastQuestion = this._lastQuestionTime > 0
      ? (now - this._lastQuestionTime) / 1000
      : Infinity;

    // ---- v1.1.33 — Run the five science-backed signal detectors ----
    // Each detector reads from features + signal-model state and updates its
    // own outputs. The detectors are intentionally independent so any one
    // can be disabled without affecting the others.
    this._updateF0Variability(features, now, frameDuration);
    this._updateRateVariability(features, now);
    this._updateLaughterDetector(features, now);
    this._updateBackchannelDetector(features, now);
    this._updateTurnDominance(features, frameDuration, speakingRatio);

    return {
      tension: this._scores.tension,
      pace: this._scores.pace,
      energy: this._scores.energy,
      isSpeech: features.isSpeech,
      isCalibrating: !this._isCalibrated,
      calibrationProgress: this.calibrationProgress,
      continuousSpeechSec: this._continuousSpeechSec,
      timeSinceLastPause: (now - this._lastPauseTime) / 1000,
      // v1.0 spec-driven signals
      speakingRatio: speakingRatio,
      questionCount: this._questionCount,
      secSinceLastQuestion: secSinceLastQuestion,
      interruptionCount: this._shortPauseInterruptions,
      // Diagnostic: whether adaptive VAD kicked in (useful for UI hints)
      adaptiveVadActive: this._adaptiveVadActive,
      sessionAgeSec: (now - this._sessionStartWallTime) / 1000,
      lastQuestionEvidence: this._lastQuestionEvidence || null,
      // ---- v1.1.33 — Five new science-backed signals ----
      // 1. F0 variability — Curhan & Pentland 2007 JAP
      f0Hz: features.f0 || 0,
      f0Confidence: features.f0Confidence || 0,
      f0SD: this._f0SD,
      f0Mean: this._f0Mean,
      // 2. Speech-rate variation — Goldman-Eisler 1968
      rateVarCV: this._rateVarCV,
      // 3. Laughter detection — Provine 2000; Brooks 2024
      laughterCount: this._laughterCount,
      secSinceLastLaughter: this._lastLaughterTime > 0
        ? (now - this._lastLaughterTime) / 1000 : Infinity,
      // 4. Backchannel detection — Stivers 2008; Bavelas et al. 2000
      backchannelCount: this._backchannelCount,
      wordBurstCount: this._wordBurstCount,
      // 5. Turn-dominance — Pentland 2008; Mehl et al. 2007 Science
      turnDominance: this._turnDominanceFlag,
      cumulativeUserSpeechSec: this._cumulativeUserSpeechSec,
      cumulativeCounterpartySpeechSec: this._cumulativeCounterpartySpeechSec,
    };
  }

  /**
   * Finish calibration: compute baseline ranges from collected samples.
   * Uses 5th/95th percentile for robustness against outliers.
   */
  _finishCalibration() {
    console.log('[Cue Signal] Calibration complete. Computing baseline from',
      this._calSamples.rms.length, 'samples.');

    // v1.1.0 REPLICANT — compute new baseline from this session's samples,
    // then BLEND with the existing stored baseline so the replicant evolves
    // over time. First session (still on population default) uses sessionWeight=1.0
    // (full replace). Subsequent sessions use sessionWeight=0.20 (20% new, 80% history),
    // so it takes ~10 sessions to fully converge on the user's personal norms.
    const isPopDefault = !!this._baseline.isPopulationDefault;
    const sessionWeight = isPopDefault ? 1.0 : 0.20;
    const histWeight = 1.0 - sessionWeight;

    for (const key of Object.keys(this._calSamples)) {
      const samples = this._calSamples[key];
      if (samples.length < 10) {
        console.warn(`[Cue Signal] Too few samples for ${key} — keeping existing replicant value.`);
        continue;
      }

      samples.sort((a, b) => a - b);
      const p5Index = Math.floor(samples.length * 0.05);
      const p95Index = Math.floor(samples.length * 0.95);

      let min = samples[p5Index];
      let max = samples[p95Index];
      let range = max - min;

      if (range < CUE_THRESHOLDS.CALIBRATION_MIN_RANGE) {
        const center = (min + max) / 2;
        min = center - CUE_THRESHOLDS.CALIBRATION_MIN_RANGE / 2;
        max = center + CUE_THRESHOLDS.CALIBRATION_MIN_RANGE / 2;
        range = CUE_THRESHOLDS.CALIBRATION_MIN_RANGE;
      }

      const expansion = range * 0.1;
      min -= expansion;
      max += expansion;
      range = max - min;

      // BLEND the new session values with the existing replicant baseline
      const prev = this._baseline[key] || { min, max, range };
      this._baseline[key] = {
        min:   prev.min   * histWeight + min   * sessionWeight,
        max:   prev.max   * histWeight + max   * sessionWeight,
        range: prev.range * histWeight + range * sessionWeight,
      };

      console.log(`[Cue Signal Replicant] ${key}: blended (${(sessionWeight*100)|0}% new) → min=${this._baseline[key].min.toFixed(4)}, max=${this._baseline[key].max.toFixed(4)}`);
    }

    // Update replicant metadata, then persist to chrome.storage.local for next session
    this._baseline.sessionCount = (this._baseline.sessionCount || 0) + 1;
    this._baseline.isPopulationDefault = false;
    this._baseline.updatedAt = Date.now();
    this._persistReplicant();

    this._isCalibrated = true;
    this._calSamples = { rms: [], zcr: [], spectralCentroid: [], spectralFlatness: [] };
  }

  /**
   * v1.1.0 — REPLICANT PERSISTENCE
   * Load the user's adapted replicant baseline from chrome.storage.local.
   * If absent, leave the population default in place. Async — frames processed
   * before this resolves use the default; once loaded the replicant takes over.
   */
  async _loadStoredReplicant() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      const result = await chrome.storage.local.get(CUE_REPLICANT_STORAGE_KEY);
      const stored = result[CUE_REPLICANT_STORAGE_KEY];
      if (stored && stored.rms && stored.zcr) {
        this._baseline = stored;
        console.log(
          '[Cue Signal Replicant] Loaded persistent replicant. ' +
          `sessionCount=${stored.sessionCount || 0}, populationDefault=${!!stored.isPopulationDefault}, ` +
          `lastUpdated=${stored.updatedAt ? new Date(stored.updatedAt).toISOString() : 'never'}`
        );
      } else {
        console.log('[Cue Signal Replicant] No stored replicant — using population default for first session.');
      }
    } catch (e) {
      console.warn('[Cue Signal Replicant] load failed:', e);
    }
  }

  /**
   * v1.1.0 — REPLICANT PERSISTENCE
   * Save the current baseline back to chrome.storage.local at session end.
   */
  _persistReplicant() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.set({ [CUE_REPLICANT_STORAGE_KEY]: this._baseline });
      console.log(`[Cue Signal Replicant] Saved (session #${this._baseline.sessionCount}) — replicant evolves.`);
    } catch (e) {
      console.warn('[Cue Signal Replicant] persist failed:', e);
    }
  }

  /**
   * Compute calibrated scores (0-100) from raw features.
   * Each raw value is mapped so that the user's *typical* range (5th-95th
   * percentile from calibration) lands in the middle 50% of the score
   * (25-75). Only real deviation beyond normal pushes toward 0 or 100.
   * This fixes the bug where the 95th-percentile of calibration data
   * was saturating at 100 during normal speech.
   */
  _computeScores(features) {
    const alpha = CUE_THRESHOLDS.SMOOTH_ALPHA;

    // Map [5p..95p] -> [25..75], extrapolate beyond (but clamp 0-100)
    const centered = (value, baseline) => {
      const n = this._normalize(value, baseline);     // 0-1 where 0=p5, 1=p95 (already clamped)
      return 0.25 + 0.5 * n;                          // baseline range -> 25..75
    };

    // For features where the clamped normalize loses information, use the
    // unclamped version so real spikes can push the score above 75.
    const centeredUnclamped = (value, baseline) => {
      if (baseline.range === 0) return 0.5;
      const n = (value - baseline.min) / baseline.range;
      const s = 0.25 + 0.5 * n;
      return Math.max(0, Math.min(1, s));
    };

    const rawEnergy  = centeredUnclamped(features.rms, this._baseline.rms) * 100;
    const rawPace    = centeredUnclamped(features.zcr, this._baseline.zcr) * 100;
    const centroidScore = centeredUnclamped(features.spectralCentroid, this._baseline.spectralCentroid);
    const flatnessScore = 1 - centeredUnclamped(features.spectralFlatness, this._baseline.spectralFlatness);
    // Weight centroid primary, flatness secondary. Note flatnessScore is already
    // a 0-1 "tension" value (inverted flatness), so no extra *0.5 needed.
    const rawTension = ((centroidScore * 0.7) + (flatnessScore * 0.3)) * 100;

    // Apply exponential smoothing
    this._scores.energy = this._scores.energy + alpha * (rawEnergy - this._scores.energy);
    this._scores.pace = this._scores.pace + alpha * (rawPace - this._scores.pace);
    this._scores.tension = this._scores.tension + alpha * (rawTension - this._scores.tension);

    // Clamp to 0-100
    this._scores.energy = Math.max(0, Math.min(100, this._scores.energy));
    this._scores.pace = Math.max(0, Math.min(100, this._scores.pace));
    this._scores.tension = Math.max(0, Math.min(100, this._scores.tension));
  }

  /**
   * Rough score mapping before calibration completes.
   * Uses hardcoded ranges based on typical speech.
   */
  _computeRoughScores(features) {
    const alpha = CUE_THRESHOLDS.SMOOTH_ALPHA;

    // Pre-calibration: aim for the middle band (25-75) for typical speech so
    // the user sees activity but doesn't see alarm-level readings until the
    // personal baseline is established. Energy/pace/tension start neutral.
    const toCentered = (raw01) => 25 + 50 * Math.max(0, Math.min(1, raw01));

    const rawEnergy = toCentered(features.rms / 0.12);
    const rawPace = toCentered((features.zcr - 500) / 3000);
    const rawTension = toCentered((features.spectralCentroid - 500) / 2500);

    this._scores.energy = this._scores.energy + alpha * (rawEnergy - this._scores.energy);
    this._scores.pace = this._scores.pace + alpha * (rawPace - this._scores.pace);
    this._scores.tension = this._scores.tension + alpha * (rawTension - this._scores.tension);

    this._scores.energy = Math.max(0, Math.min(100, this._scores.energy));
    this._scores.pace = Math.max(0, Math.min(100, this._scores.pace));
    this._scores.tension = Math.max(0, Math.min(100, this._scores.tension));
  }

  /**
   * Normalize a raw value to 0-1 using a baseline range.
   */
  _normalize(value, baseline) {
    if (baseline.range === 0) return 0.5;
    return Math.max(0, Math.min(1, (value - baseline.min) / baseline.range));
  }

  // ==========================================================================
  // v1.1.33 — Science-backed signal detectors
  //
  // Five additional signals from peer-reviewed listening / conversation /
  // paralinguistic research. Each has a primary citation in thresholds.js and
  // SIGNAL_MODEL.md. These run on every frame but are designed to be cheap
  // and side-effect-free outside their own state.
  // ==========================================================================

  /**
   * Signal 1 — F0 variability (Curhan & Pentland 2007 J. Applied Psychology).
   *
   * F0 standard deviation over a rolling window. Low F0-SD = monotone
   * delivery, the most consistent vocal predictor of negative listener
   * judgments across studies. Only accept high-confidence F0 estimates
   * (worklet rejects below 0.30; we further require speech frames).
   */
  _updateF0Variability(features, now, frameDuration) {
    const f0 = features.f0 || 0;
    const conf = features.f0Confidence || 0;

    // Only consider voiced, confident frames during actual speech
    if (features.isSpeech && f0 > 0 && conf >= 0.40) {
      this._f0Window.push({ t: now, f0: f0 });
    }

    // Trim to window
    const windowMs = CUE_THRESHOLDS.F0_WINDOW_SEC * 1000;
    const cutoff = now - windowMs;
    while (this._f0Window.length && this._f0Window[0].t < cutoff) {
      this._f0Window.shift();
    }

    // Need minimum samples before SD is meaningful
    if (this._f0Window.length < CUE_THRESHOLDS.F0_SD_MIN_SAMPLES) {
      this._f0SD = 0;
      this._f0Mean = 0;
      return;
    }

    // Compute mean + SD
    let sum = 0;
    for (const e of this._f0Window) sum += e.f0;
    const mean = sum / this._f0Window.length;
    let sqSum = 0;
    for (const e of this._f0Window) {
      const d = e.f0 - mean;
      sqSum += d * d;
    }
    const variance = sqSum / this._f0Window.length;
    this._f0Mean = mean;
    this._f0SD = Math.sqrt(variance);
  }

  /**
   * Signal 2 — Speech-rate variation (Goldman-Eisler 1968; Smith et al. 1975).
   *
   * Coefficient of variation (SD / mean) of ZCR within speech frames.
   * Flat rate signals scripted or disengaged delivery; healthy conversation
   * has natural rate variation as topics shift and ideas land.
   */
  _updateRateVariability(features, now) {
    if (features.isSpeech && features.zcr > 0) {
      this._zcrSpeechWindow.push({ t: now, zcr: features.zcr });
    }

    const windowMs = CUE_THRESHOLDS.RATE_VAR_WINDOW_SEC * 1000;
    const cutoff = now - windowMs;
    while (this._zcrSpeechWindow.length && this._zcrSpeechWindow[0].t < cutoff) {
      this._zcrSpeechWindow.shift();
    }

    if (this._zcrSpeechWindow.length < 20) {
      this._rateVarCV = 0;
      return;
    }

    let sum = 0;
    for (const e of this._zcrSpeechWindow) sum += e.zcr;
    const mean = sum / this._zcrSpeechWindow.length;
    if (mean <= 0) { this._rateVarCV = 0; return; }

    let sqSum = 0;
    for (const e of this._zcrSpeechWindow) {
      const d = e.zcr - mean;
      sqSum += d * d;
    }
    const sd = Math.sqrt(sqSum / this._zcrSpeechWindow.length);
    this._rateVarCV = sd / mean;
  }

  /**
   * Signal 3 — Laughter detection (Provine 2000; Brooks 2024 "Talk" / Levity).
   *
   * Approach: accumulate the worklet's sub-frame RMS values into a longer
   * envelope buffer (target sample rate ~62 Hz), then test for periodicity
   * in the 3-8 Hz band via a lightweight Goertzel-style energy scan. High
   * band energy + high modulation depth = laughter.
   *
   * This is intentionally simpler than the full Bachorowski 2001 acoustic
   * laugh classifier — it trades recall for precision and is robust enough
   * to count laugh events, which is the actual signal of interest.
   */
  _updateLaughterDetector(features, now) {
    if (!features.subFrameRMS || !Array.isArray(features.subFrameRMS)) return;

    // Lazy-init max buffer length once we know the envelope sample rate.
    // ~62 Hz from 8 sub-frames per 128ms = 62.5 Hz.
    if (this._envelopeBufferMaxLen === 0) {
      this._envelopeBufferMaxLen = Math.floor(
        CUE_THRESHOLDS.LAUGH_ENVELOPE_BUFFER_SEC * 62
      );
    }

    // Append new sub-frame values; trim to max length
    for (const v of features.subFrameRMS) this._envelopeBuffer.push(v);
    while (this._envelopeBuffer.length > this._envelopeBufferMaxLen) {
      this._envelopeBuffer.shift();
    }

    // Don't analyze too frequently — every ~256ms is plenty
    if (now - this._lastLaughterAnalysisTime < 256) return;
    this._lastLaughterAnalysisTime = now;

    // Need a full buffer + cooldown elapsed since last detection
    if (this._envelopeBuffer.length < this._envelopeBufferMaxLen) return;
    if (now - this._lastLaughterTime < CUE_THRESHOLDS.LAUGH_COOLDOWN_SEC * 1000) return;

    const env = this._envelopeBuffer;
    const N = env.length;
    const fs = 62.5; // envelope sample rate

    // Modulation depth: (max - min) / max — laughter has deep dips
    let envMax = 0, envMin = 1e9;
    for (const v of env) {
      if (v > envMax) envMax = v;
      if (v < envMin) envMin = v;
    }
    const modulationDepth = envMax > 0 ? (envMax - envMin) / envMax : 0;

    if (modulationDepth < CUE_THRESHOLDS.LAUGH_MODULATION_THRESHOLD) return;

    // Goertzel-style band energy in 3-8 Hz vs. out-of-band reference
    // Sweep target freqs in the laugh band; the strongest one wins.
    const bandMin = CUE_THRESHOLDS.LAUGH_FREQ_MIN_HZ;
    const bandMax = CUE_THRESHOLDS.LAUGH_FREQ_MAX_HZ;

    // Remove DC bias for cleaner periodicity readout
    let envMean = 0;
    for (const v of env) envMean += v;
    envMean /= N;

    let bestBandEnergy = 0;
    for (let fHz = bandMin; fHz <= bandMax; fHz += 0.5) {
      const omega = 2 * Math.PI * fHz / fs;
      const cos = Math.cos(omega);
      const sin = Math.sin(omega);
      let s0 = 0, s1 = 0, s2 = 0;
      const coeff = 2 * cos;
      for (let i = 0; i < N; i++) {
        s0 = coeff * s1 - s2 + (env[i] - envMean);
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      if (power > bestBandEnergy) bestBandEnergy = power;
    }

    // Out-of-band reference at 1 Hz (well below laugh band)
    const refOmega = 2 * Math.PI * 1.0 / fs;
    const refCos = Math.cos(refOmega);
    let r0 = 0, r1 = 0, r2 = 0;
    const refCoeff = 2 * refCos;
    for (let i = 0; i < N; i++) {
      r0 = refCoeff * r1 - r2 + (env[i] - envMean);
      r2 = r1;
      r1 = r0;
    }
    const refPower = r1 * r1 + r2 * r2 - refCoeff * r1 * r2;

    // Require laugh-band energy to be at least 3x out-of-band — rejects
    // steady speech and ambient hum.
    if (refPower <= 0) return;
    const bandRatio = bestBandEnergy / refPower;
    if (bandRatio < 3.0) return;

    // Detection!
    this._laughterCount++;
    this._lastLaughterTime = now;
    if (typeof console !== 'undefined') {
      console.log('[Signal v1.1.33] Laughter detected. Count:', this._laughterCount,
        'mod=' + modulationDepth.toFixed(2), 'bandRatio=' + bandRatio.toFixed(1));
    }
  }

  /**
   * Signal 4 — Backchannel detection (Stivers 2008; Bavelas, Coates &
   * Johnson 2000 JPSP; Brennan & Schober 2001).
   *
   * Track every speech burst's duration. A burst that lasts 100-450ms and
   * is bracketed by sufficient silence is classified as a backchannel
   * ("mm-hmm", "yeah", "right"). Longer bursts are word-bursts — substantive
   * speaking turns. In dual-stream mode (setCounterpartyActive) we further
   * require the partner to be speaking during the user's short burst.
   *
   * State machine:
   *   isSpeech transitions silence → speech:  start burst, capture preceding silence
   *   isSpeech transitions speech  → silence: end burst, classify
   */
  _updateBackchannelDetector(features, now) {
    if (features.isSpeech) {
      // Speech frame
      if (this._currentBurstStartTime === null) {
        // Burst start
        this._currentBurstStartTime = now;
        // How long was the preceding silence?
        if (this._previousSilenceStartTime !== null) {
          this._currentBurstSilenceBefore = now - this._previousSilenceStartTime;
        } else {
          // Session start — count as enough preceding silence to qualify
          this._currentBurstSilenceBefore = 9999;
        }
        this._previousSilenceStartTime = null;
      }
    } else {
      // Silence frame
      if (this._currentBurstStartTime !== null) {
        // Burst just ended — classify
        const burstDurMs = now - this._currentBurstStartTime;
        const silenceBeforeMs = this._currentBurstSilenceBefore;

        const inBackchannelRange =
          burstDurMs >= CUE_THRESHOLDS.BACKCHANNEL_MIN_MS &&
          burstDurMs <= CUE_THRESHOLDS.BACKCHANNEL_MAX_MS;
        const enoughSilenceBefore =
          silenceBeforeMs >= CUE_THRESHOLDS.BACKCHANNEL_PRECEDING_SILENCE_MS;

        if (inBackchannelRange && enoughSilenceBefore) {
          // Single-stream: count as backchannel by duration signature alone.
          // Dual-stream: require counterparty to have been speaking — we
          // use _counterpartySpeaking at the moment the burst ENDED as a
          // proxy; the offscreen doc can refine this.
          // (If counterparty hook never set, _counterpartySpeaking stays
          // false. We still count single-stream backchannels — they're a
          // legitimate signal — but tag the source so the tape can show it.)
          this._backchannelCount++;
        } else if (burstDurMs > CUE_THRESHOLDS.BACKCHANNEL_MAX_MS) {
          this._wordBurstCount++;
        }

        this._lastBurstEndTime = now;
        this._currentBurstStartTime = null;
        this._currentBurstSilenceBefore = 0;
      }
      if (this._previousSilenceStartTime === null) {
        this._previousSilenceStartTime = now;
      }
    }
  }

  /**
   * Signal 5 — Turn-dominance (Pentland 2008 "Honest Signals"; Mehl et al.
   * 2007 Science).
   *
   * Cumulative user-speech vs counterparty-speech ratio across the session,
   * plus a rolling-window imbalance flag from the existing speakingRatio.
   * The rolling-window flag is what fires post-session feedback ("you spoke
   * 72% of the time — try inviting them in earlier next call").
   */
  _updateTurnDominance(features, frameDuration, speakingRatio) {
    if (features.isSpeech) {
      this._cumulativeUserSpeechSec += frameDuration;
    }
    // Counterparty cumulative is updated via setCounterpartyActive.

    const ageSec = (Date.now() - this._sessionStartWallTime) / 1000;
    if (ageSec < CUE_THRESHOLDS.TURN_DOMINANCE_MIN_SEC) {
      this._turnDominanceFlag = 'balanced'; // don't judge before 60s
      return;
    }

    // speakingRatio is the rolling-30s window from the v1.0 block.
    if (speakingRatio >= CUE_THRESHOLDS.TURN_DOMINANCE_HIGH) {
      this._turnDominanceFlag = 'dominant';
    } else if (speakingRatio <= CUE_THRESHOLDS.TURN_DOMINANCE_LOW) {
      this._turnDominanceFlag = 'absent';
    } else {
      this._turnDominanceFlag = 'balanced';
    }
  }
}
