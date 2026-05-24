/**
 * Cue — Audio Manager
 *
 * Manages the entire audio pipeline:
 *   1. Requests microphone access
 *   2. Creates AudioContext with AudioWorklet for DSP
 *   3. Sets up AnalyserNode for spectral analysis (main thread)
 *   4. Posts combined feature vectors to a callback
 *
 * Usage:
 *   const manager = new CueAudioManager(onFeatures);
 *   await manager.start();
 *   // ... later ...
 *   manager.stop();
 */

class CueAudioManager {
  constructor(onFeatures) {
    this._onFeatures = onFeatures; // callback: (featureVector) => void
    this._audioContext = null;
    this._stream = null;
    this._workletNode = null;
    this._analyser = null;
    this._spectralInterval = null;
    // v1.1.37 — h1h2 + cpp added per CUE_BUILD_SPEC.md §6 voice-quality
    // augmentation. Both require F0 from the worklet, cached in
    // _lastWorkletF0 so the spectral-analysis interval can read it.
    this._lastSpectralData = { spectralCentroid: 0, spectralFlatness: 0, h1h2: 0, cpp: 0 };
    this._lastWorkletF0 = 0;
    this._isRunning = false;
  }

  get isRunning() {
    return this._isRunning;
  }

  async start(preAcquiredStream) {
    if (this._isRunning) {
      console.warn('[Cue Audio] Already running.');
      return;
    }

    try {
      // Step 1: Request microphone (or use a pre-acquired stream)
      if (preAcquiredStream) {
        this._stream = preAcquiredStream;
        console.log('[Cue Audio] Using pre-acquired microphone stream.');
      } else {
        console.log('[Cue Audio] Requesting microphone access...');
        // Enable Chrome's built-in noise suppression, echo cancellation, and
        // auto-gain control. This focuses calibration on your voice rather
        // than room tone, keyboard clicks, or background hum. The features
        // we use (RMS, ZCR, spectral centroid) work better on clean speech.
        this._stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        console.log('[Cue Audio] Microphone access granted with noise suppression.');
      }

      // Step 2: Create AudioContext
      // Use default sample rate (usually 48000 on most systems)
      this._audioContext = new AudioContext();

      // Resume if suspended (Chrome requires user gesture)
      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }
      console.log('[Cue Audio] AudioContext created. Sample rate:', this._audioContext.sampleRate);

      // Step 3: Load AudioWorklet processor
      const processorUrl = this._getProcessorUrl();
      console.log('[Cue Audio] Loading AudioWorklet from:', processorUrl);
      await this._audioContext.audioWorklet.addModule(processorUrl);
      console.log('[Cue Audio] AudioWorklet loaded.');

      // Step 4: Create audio graph
      //
      //   Mic → MediaStreamSource → AudioWorkletNode (DSP in audio thread)
      //                            ↘ AnalyserNode (spectral data on main thread)
      //
      const source = this._audioContext.createMediaStreamSource(this._stream);

      // AudioWorklet node for RMS, ZCR, VAD
      this._workletNode = new AudioWorkletNode(this._audioContext, 'cue-processor');

      // Listen for feature messages from the worklet
      this._workletNode.port.onmessage = (event) => {
        this._handleWorkletMessage(event.data);
      };

      // AnalyserNode for frequency-domain analysis (spectral centroid)
      this._analyser = this._audioContext.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0.3;

      // Connect the graph
      source.connect(this._workletNode);
      source.connect(this._analyser);

      // The worklet doesn't produce output audio, but we need to connect it
      // to avoid Chrome garbage-collecting it. Connect to a silent destination.
      // Actually, AudioWorkletNode stays alive as long as it returns true from process().
      // No need to connect output.

      // Step 5: Start spectral analysis on main thread (every ~128ms)
      this._startSpectralAnalysis();

      this._isRunning = true;
      console.log('[Cue Audio] Pipeline running.');

    } catch (err) {
      console.error('[Cue Audio] Failed to start:', err);
      this.stop();
      throw err;
    }
  }

  stop() {
    console.log('[Cue Audio] Stopping...');

    if (this._spectralInterval) {
      clearInterval(this._spectralInterval);
      this._spectralInterval = null;
    }

    if (this._workletNode) {
      this._workletNode.port.close();
      this._workletNode.disconnect();
      this._workletNode = null;
    }

    if (this._analyser) {
      this._analyser.disconnect();
      this._analyser = null;
    }

    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }

    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }

    this._isRunning = false;
    console.log('[Cue Audio] Stopped.');
  }

  /**
   * Get the URL for the AudioWorklet processor file.
   * Must be listed in web_accessible_resources in manifest.json.
   */
  _getProcessorUrl() {
    // chrome.runtime.getURL gives us the extension's internal URL
    // which is accessible because we listed it in web_accessible_resources
    return chrome.runtime.getURL('src/audio/cue-processor.js');
  }

  /**
   * Handle feature messages from the AudioWorklet.
   * Combines worklet data (RMS, ZCR, VAD) with main-thread spectral data.
   */
  _handleWorkletMessage(workletData) {
    // v1.1.37 — Cache the worklet's F0 so the next spectral-analysis tick
    // can compute H1-H2 and CPP at the right harmonic / quefrency.
    if (workletData && typeof workletData.f0 === 'number' &&
        workletData.f0 > 0 && (workletData.f0Confidence || 0) >= 0.3) {
      this._lastWorkletF0 = workletData.f0;
    }

    // Merge worklet features with latest spectral analysis
    const combined = {
      ...workletData,
      spectralCentroid: this._lastSpectralData.spectralCentroid,
      spectralFlatness: this._lastSpectralData.spectralFlatness,
      // v1.1.37 — Voice-quality augmentation (CUE_BUILD_SPEC.md §6)
      h1h2: this._lastSpectralData.h1h2,
      cpp: this._lastSpectralData.cpp,
      _audioTimestamp: performance.now() // stamp for latency tracking
    };

    // Send to callback
    if (this._onFeatures) {
      this._onFeatures(combined);
    }
  }

  /**
   * Run spectral analysis on the main thread using AnalyserNode.
   * Computes spectral centroid and spectral flatness every ~128ms.
   */
  _startSpectralAnalysis() {
    const bufferLength = this._analyser.frequencyBinCount; // fftSize / 2 = 1024
    const freqData = new Float32Array(bufferLength);

    this._spectralInterval = setInterval(() => {
      if (!this._analyser) return;

      this._analyser.getFloatFrequencyData(freqData);

      // Convert from dB to linear magnitude
      // getFloatFrequencyData returns values in dB (typically -100 to 0)
      const magnitudes = new Float32Array(bufferLength);
      for (let i = 0; i < bufferLength; i++) {
        // Convert dB to linear (clamp to minimum of -100dB)
        magnitudes[i] = Math.pow(10, Math.max(freqData[i], -100) / 20);
      }

      // -- Spectral Centroid --
      // Weighted average of frequencies by their magnitudes
      // Higher centroid = more high-frequency energy = tenser/sharper voice
      const nyquist = this._audioContext.sampleRate / 2;
      const binWidth = nyquist / bufferLength;

      let weightedSum = 0;
      let magnitudeSum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const frequency = i * binWidth;
        weightedSum += frequency * magnitudes[i];
        magnitudeSum += magnitudes[i];
      }
      const spectralCentroid = magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;

      // -- Spectral Flatness (Wiener entropy) --
      // Geometric mean / arithmetic mean of magnitudes
      // Closer to 1 = noisy/flat spectrum, closer to 0 = tonal/harmonic
      // We use this as a proxy for harmonic-to-noise ratio (HNR)
      let logSum = 0;
      let linSum = 0;
      let validBins = 0;
      for (let i = 1; i < bufferLength; i++) { // skip DC bin
        if (magnitudes[i] > 0) {
          logSum += Math.log(magnitudes[i]);
          linSum += magnitudes[i];
          validBins++;
        }
      }

      let spectralFlatness = 0;
      if (validBins > 0 && linSum > 0) {
        const geometricMean = Math.exp(logSum / validBins);
        const arithmeticMean = linSum / validBins;
        spectralFlatness = geometricMean / arithmeticMean;
      }

      // v1.1.37 — Voice-quality augmentation (CUE_BUILD_SPEC.md §6).
      // H1-H2 (Hillenbrand & Houde 1996) and CPP (Hillenbrand 1994). Both
      // are spectral measures that need F0 — read the cached worklet F0.
      const f0 = this._lastWorkletF0;
      let h1h2 = 0;
      let cpp = 0;
      if (f0 > 0) {
        h1h2 = this._computeH1H2(magnitudes, f0, this._audioContext.sampleRate, this._analyser.fftSize);
        cpp = this._computeCPP(magnitudes, this._audioContext.sampleRate, f0);
      }

      this._lastSpectralData = { spectralCentroid, spectralFlatness, h1h2, cpp };

    }, 128); // Every ~128ms, matching the worklet post rate
  }

  /**
   * v1.1.37 — H1-H2 (amplitude difference between first two harmonics in dB).
   *
   * Hillenbrand & Houde 1996, "Acoustic Correlates of Breathy Vocal Quality",
   * J Speech Hear Res. Standard measure of glottal closure pattern:
   *   H1 - H2 > 0 dB → breathy phonation (incomplete closure)
   *   H1 - H2 ≈ 0 dB → modal voice
   *   H1 - H2 < 0 dB → pressed / tense voice (over-closure)
   *
   * Implementation: locate the bins nearest f0 and 2*f0, then scan ±2 bins
   * to find the local magnitude peak (handles FFT bin jitter against the
   * true harmonic frequency).
   *
   * Returns dB difference, or 0 if either harmonic is below the spectrum
   * resolvability range.
   */
  _computeH1H2(magnitudes, f0Hz, sampleRate, fftSize) {
    if (f0Hz <= 0) return 0;
    const binWidth = sampleRate / fftSize; // Hz per FFT bin
    const h1Bin = Math.round(f0Hz / binWidth);
    const h2Bin = Math.round(2 * f0Hz / binWidth);
    if (h2Bin >= magnitudes.length - 1 || h1Bin < 1) return 0;

    const localMax = (centerBin) => {
      const lo = Math.max(0, centerBin - 2);
      const hi = Math.min(magnitudes.length - 1, centerBin + 2);
      let m = 0;
      for (let i = lo; i <= hi; i++) if (magnitudes[i] > m) m = magnitudes[i];
      return m;
    };

    const h1 = localMax(h1Bin);
    const h2 = localMax(h2Bin);
    if (h1 <= 0 || h2 <= 0) return 0;

    return 20 * (Math.log10(h1) - Math.log10(h2));
  }

  /**
   * v1.1.37 — CPP (cepstral peak prominence) in dB.
   *
   * Hillenbrand 1994 JSHR; Heman-Ackah et al. 2002 J Voice. The clinical
   * standard for voice-quality assessment; widely used in dysphonia
   * screening. High CPP = clean harmonic structure; low CPP = noise-
   * dominated or hoarse.
   *
   * Algorithm:
   *   1. Convert magnitude spectrum to log-power.
   *   2. Compute the cepstrum (DCT-II of log-power) at lags around the
   *      expected F0 period. Only a narrow range around f0 → cheaper than
   *      a full IFFT.
   *   3. Find peak of cepstrum in that range.
   *   4. Fit linear regression to the cepstrum across the range.
   *   5. CPP = peak - regression-at-peak, in dB.
   *
   * Cost: O(range_width × N) ≈ 50 × 1024 = ~50k multiplies per call at 8 Hz.
   * Negligible.
   *
   * NOTE on absolute scale: synthetic test signals reproduce the EXPECTED
   * DIRECTIONALITY (harmonic > noise, breathy ≈ pressed > noise) but the
   * absolute dB value depends on the DCT normalization and is not yet
   * calibrated against the clinical-literature range of 15-25 dB for
   * healthy adult speech (Heman-Ackah 2002). CPP_LOW_DB in thresholds.js
   * is set to 10 per the literature; first real-recording sessions will
   * tell us whether a scale-correction factor is needed before any nudge
   * can be wired to this signal.
   */
  _computeCPP(magnitudes, sampleRate, f0Hint) {
    if (f0Hint <= 0) return 0;
    const N = magnitudes.length;
    const eps = 1e-12;

    // Log-power spectrum
    const logPwr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const m = magnitudes[i];
      logPwr[i] = Math.log10(m * m + eps);
    }

    // Quefrency / lag corresponding to F0 (in cepstrum index units, where
    // index m maps to a periodicity of sampleRate / m Hz across the full
    // FFT half-spectrum we operate on).
    const f0LagCenter = Math.round(sampleRate / f0Hint);
    const searchLow = Math.max(2, Math.round(f0LagCenter * 0.7));
    const searchHigh = Math.min(N - 1, Math.round(f0LagCenter * 1.4));
    if (searchHigh - searchLow < 3) return 0;

    const range = searchHigh - searchLow + 1;
    const cepstrum = new Float32Array(range);

    // Partial DCT-II at each lag in the search range. Real-valued because
    // the log-power spectrum is symmetric in the implicit even extension.
    for (let mi = 0; mi < range; mi++) {
      const m = searchLow + mi;
      let sum = 0;
      const coeff = Math.PI * m / N;
      for (let k = 0; k < N; k++) {
        sum += logPwr[k] * Math.cos(coeff * (k + 0.5));
      }
      cepstrum[mi] = sum / N;
    }

    // Find peak
    let peakIdx = 0;
    let peakVal = cepstrum[0];
    for (let i = 1; i < range; i++) {
      if (cepstrum[i] > peakVal) { peakVal = cepstrum[i]; peakIdx = i; }
    }

    // Linear regression to compute baseline at the peak position
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < range; i++) {
      sumX += i;
      sumY += cepstrum[i];
      sumXY += i * cepstrum[i];
      sumX2 += i * i;
    }
    const denom = range * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    const slope = (range * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / range;
    const baselineAtPeak = slope * peakIdx + intercept;

    // peakVal is in log10(power); 10 × difference gives dB.
    return 10 * (peakVal - baselineAtPeak);
  }
}
