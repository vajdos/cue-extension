/**
 * Cue — AudioWorklet Processor
 *
 * Runs on a dedicated audio thread (NOT the main thread).
 * Receives raw PCM audio samples from the microphone and computes:
 *   - RMS (Root Mean Square) energy — how loud you are
 *   - ZCR (Zero-Crossing Rate) — proxy for how fast you're talking
 *   - VAD (Voice Activity Detection) — are you speaking or silent?
 *   - F0 (fundamental frequency, voice pitch) — autocorrelation, 80-400 Hz
 *     Added v1.1.33 — drives the F0-SD signal (Curhan & Pentland 2007 JAP
 *     "Thin slices of negotiation" — pitch variability in first 5 minutes
 *     predicts negotiation outcomes).
 *   - subFrameRMS (8-element envelope, ~62Hz sampling) — drives downstream
 *     laughter detection (Provine 2000 — laugh cycle ~4.6 Hz) and finer
 *     backchannel boundary timing.
 *
 * Posts a feature vector to the main thread every ~128ms (accumulates frames).
 *
 * IMPORTANT: This file runs in an AudioWorklet scope, not the normal page scope.
 * No access to DOM, window, chrome APIs, etc. Only AudioWorkletProcessor is available.
 */

class CueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Accumulator — we collect multiple 128-sample frames before posting
    // At 48kHz sample rate, 128 samples = 2.67ms
    // We want to post every ~128ms, so we accumulate ~48 frames (6144 samples)
    this._buffer = [];
    this._bufferSize = 6144; // ~128ms at 48kHz
    this._frameCount = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // If no input connected, keep processor alive
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const samples = input[0]; // mono channel

    // Accumulate samples
    for (let i = 0; i < samples.length; i++) {
      this._buffer.push(samples[i]);
    }

    // When we have enough samples, compute features and post
    if (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.slice(0, this._bufferSize);
      this._buffer = this._buffer.slice(this._bufferSize);

      const features = this._computeFeatures(chunk);
      this.port.postMessage(features);
    }

    // Return true to keep the processor alive
    return true;
  }

  _computeFeatures(samples) {
    const n = samples.length;

    // -- RMS Energy --
    // sqrt(mean of squared samples)
    // Range: 0.0 (silence) to ~1.0 (max volume)
    let sumSquares = 0;
    for (let i = 0; i < n; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / n);

    // -- Zero-Crossing Rate --
    // Count how many times the signal crosses zero, normalized
    // Higher ZCR = more high-frequency content = faster/more energetic speech
    let zeroCrossings = 0;
    for (let i = 1; i < n; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) ||
          (samples[i] < 0 && samples[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }
    // Normalize to crossings per second
    // At 48kHz, bufferSize samples = bufferSize/48000 seconds
    const durationSec = n / sampleRate; // sampleRate is global in AudioWorklet scope
    const zcr = zeroCrossings / durationSec;

    // -- Voice Activity Detection (simple energy threshold) --
    // 0.005 catches soft speech on most mics while still rejecting ambient
    // hum. If users still can't calibrate, the signal model has a fallback
    // that nudges this down adaptively (see signal-model.js).
    const isSpeech = rms > 0.005;

    // -- Peak amplitude (for debugging) --
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }

    // -- F0 (fundamental frequency) via autocorrelation (v1.1.33) --
    // Only attempt during speech frames — autocorrelation on silence yields noise.
    // Voice F0 range: 80-400 Hz covers adult male (~85-180), adult female
    // (~165-255), and most child / animated speakers.
    // Compute cost: ~1M multiplies per 128ms frame. Well within budget.
    let f0 = 0;
    let f0Confidence = 0;
    if (isSpeech) {
      const f0Result = this._estimateF0(samples, sampleRate);
      f0 = f0Result.f0;
      f0Confidence = f0Result.confidence;
    }

    // -- Sub-frame envelope (v1.1.33) --
    // 8 RMS values spanning the 128ms buffer = ~62 Hz envelope sample rate.
    // Downstream (signal-model.js) accumulates these into a longer ring
    // buffer and runs periodicity analysis in the 3-8 Hz band for laughter
    // detection. Also provides finer-grained burst-onset timing than the
    // single per-frame isSpeech flag, which improves backchannel boundary
    // detection.
    const subFrameRMS = this._computeSubFrameRMS(samples, 8);

    return {
      rms: rms,
      zcr: zcr,
      isSpeech: isSpeech,
      peak: peak,
      // v1.1.33 additions
      f0: f0,
      f0Confidence: f0Confidence,
      subFrameRMS: subFrameRMS,
      // Existing
      timestamp: currentTime, // currentTime is global in AudioWorklet scope (seconds)
      sampleRate: sampleRate
    };
  }

  /**
   * Autocorrelation-based F0 estimator. Bounded to the human voice range
   * 80-400 Hz. Returns 0 if no clear pitch is found.
   *
   * Returns { f0: Hz, confidence: 0-1 } where confidence is the normalized
   * correlation strength at the chosen lag (1.0 = perfectly periodic at this
   * lag, 0 = no periodicity).
   *
   * This is the standard pitch-detection method used in pitch-tracking
   * libraries (PYIN, YIN, Praat's autocorrelation method). For Cue we only
   * need population-grade pitch — not perfect transcription — so the simple
   * normalized autocorrelation suffices.
   */
  _estimateF0(samples, sr) {
    // Use a window from the start of the buffer to limit compute
    const N = Math.min(samples.length, 2048);

    // F0 search range: 80 Hz to 400 Hz
    const minLag = Math.max(2, Math.floor(sr / 400));
    const maxLag = Math.min(N - 1, Math.floor(sr / 80));

    if (maxLag <= minLag) return { f0: 0, confidence: 0 };

    // Compute energy at lag 0 (denominator for normalization)
    let energy0 = 0;
    for (let i = 0; i < N; i++) {
      energy0 += samples[i] * samples[i];
    }
    if (energy0 < 1e-6) return { f0: 0, confidence: 0 };

    let bestLag = 0;
    let bestCorr = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      const limit = N - lag;
      for (let i = 0; i < limit; i++) {
        corr += samples[i] * samples[i + lag];
      }
      // Normalize by signal energy at this lag offset for fair comparison
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag === 0) return { f0: 0, confidence: 0 };

    const confidence = Math.max(0, Math.min(1, bestCorr / energy0));

    // Reject low-confidence estimates — they're noise, not pitch.
    if (confidence < 0.30) return { f0: 0, confidence: confidence };

    return { f0: sr / bestLag, confidence: confidence };
  }

  /**
   * Compute K sub-frame RMS values across the buffer. Used to build a
   * high-resolution amplitude envelope downstream. K=8 over a 128ms buffer
   * gives ~62 Hz envelope sampling — adequate for detecting the 3-8 Hz
   * modulation that characterizes laughter (Provine 2000).
   */
  _computeSubFrameRMS(samples, k) {
    const subSize = Math.floor(samples.length / k);
    const out = new Array(k);
    for (let s = 0; s < k; s++) {
      let sumSq = 0;
      const start = s * subSize;
      const end = start + subSize;
      for (let i = start; i < end; i++) {
        sumSq += samples[i] * samples[i];
      }
      out[s] = Math.sqrt(sumSq / subSize);
    }
    return out;
  }
}

registerProcessor('cue-processor', CueProcessor);
