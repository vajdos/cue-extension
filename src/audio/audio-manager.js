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
    this._lastSpectralData = { spectralCentroid: 0, spectralFlatness: 0 };
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
    // Merge worklet features with latest spectral analysis
    const combined = {
      ...workletData,
      spectralCentroid: this._lastSpectralData.spectralCentroid,
      spectralFlatness: this._lastSpectralData.spectralFlatness,
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

      this._lastSpectralData = { spectralCentroid, spectralFlatness };

    }, 128); // Every ~128ms, matching the worklet post rate
  }
}
