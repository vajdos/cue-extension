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
}
