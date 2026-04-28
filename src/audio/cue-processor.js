/**
 * Cue — AudioWorklet Processor
 *
 * Runs on a dedicated audio thread (NOT the main thread).
 * Receives raw PCM audio samples from the microphone and computes:
 *   - RMS (Root Mean Square) energy — how loud you are
 *   - ZCR (Zero-Crossing Rate) — proxy for how fast you're talking
 *   - VAD (Voice Activity Detection) — are you speaking or silent?
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

    return {
      rms: rms,
      zcr: zcr,
      isSpeech: isSpeech,
      peak: peak,
      timestamp: currentTime, // currentTime is global in AudioWorklet scope (seconds)
      sampleRate: sampleRate
    };
  }
}

registerProcessor('cue-processor', CueProcessor);
