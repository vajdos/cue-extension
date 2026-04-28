/**
 * Cue — Latency Monitor
 *
 * Tracks pipeline latency (microphone capture → nudge display).
 * If latency exceeds MAX_LATENCY_MS for LATENCY_FAIL_FRAMES consecutive
 * frames, nudges are disabled and a warning indicator is shown.
 *
 * This protects the demo from delivering stale nudges when the browser
 * is under heavy load (background tabs, screen sharing, etc.).
 *
 * Usage:
 *   const monitor = new CueLatencyMonitor();
 *   // In the AudioWorklet processor, stamp each message:
 *   port.postMessage({ ...features, _audioTimestamp: performance.now() });
 *
 *   // In onFeatures:
 *   monitor.mark(features._audioTimestamp);
 *   if (monitor.isHealthy) { nudgeEngine.process(signal); }
 */

class CueLatencyMonitor {
  constructor(options = {}) {
    this._maxLatencyMs = options.maxLatencyMs || CUE_THRESHOLDS.MAX_LATENCY_MS || 500;
    this._failThreshold = options.failFrames || CUE_THRESHOLDS.LATENCY_FAIL_FRAMES || 3;

    this._consecutiveFailures = 0;
    this._isHealthy = true;
    this._lastLatencyMs = 0;
    this._avgLatencyMs = 0;
    this._peakLatencyMs = 0;
    this._sampleCount = 0;

    // Rolling window for average (last 50 frames ~6.4s)
    this._latencyWindow = [];
    this._windowSize = 50;

    // Callback when health state changes
    this._onHealthChange = options.onHealthChange || null;
  }

  /**
   * Whether the pipeline is running within acceptable latency.
   */
  get isHealthy() {
    return this._isHealthy;
  }

  /**
   * Current latency in ms.
   */
  get latencyMs() {
    return this._lastLatencyMs;
  }

  /**
   * Rolling average latency in ms.
   */
  get avgLatencyMs() {
    return Math.round(this._avgLatencyMs);
  }

  /**
   * Peak latency observed during this session.
   */
  get peakLatencyMs() {
    return this._peakLatencyMs;
  }

  /**
   * Call this each time a feature frame arrives from the audio pipeline.
   * Pass the timestamp that was stamped in the AudioWorklet processor.
   *
   * @param {number} audioTimestamp - performance.now() at the time the
   *   AudioWorklet emitted the frame.
   */
  mark(audioTimestamp) {
    if (!audioTimestamp) return;

    const now = performance.now();
    const latency = now - audioTimestamp;

    this._lastLatencyMs = latency;
    this._sampleCount++;

    // Track peak
    if (latency > this._peakLatencyMs) {
      this._peakLatencyMs = latency;
    }

    // Rolling average
    this._latencyWindow.push(latency);
    if (this._latencyWindow.length > this._windowSize) {
      this._latencyWindow.shift();
    }
    this._avgLatencyMs = this._latencyWindow.reduce((a, b) => a + b, 0) / this._latencyWindow.length;

    // Check threshold
    if (latency > this._maxLatencyMs) {
      this._consecutiveFailures++;
      if (this._consecutiveFailures >= this._failThreshold && this._isHealthy) {
        this._isHealthy = false;
        console.warn(`[Cue Latency] Pipeline unhealthy: ${Math.round(latency)}ms (threshold: ${this._maxLatencyMs}ms, ${this._consecutiveFailures} consecutive failures)`);
        if (this._onHealthChange) {
          this._onHealthChange(false, latency);
        }
      }
    } else {
      if (!this._isHealthy && this._consecutiveFailures > 0) {
        // Require 3 consecutive good frames to recover
        this._consecutiveFailures--;
        if (this._consecutiveFailures <= 0) {
          this._consecutiveFailures = 0;
          this._isHealthy = true;
          console.log(`[Cue Latency] Pipeline recovered: ${Math.round(latency)}ms`);
          if (this._onHealthChange) {
            this._onHealthChange(true, latency);
          }
        }
      } else {
        this._consecutiveFailures = 0;
      }
    }
  }

  /**
   * Get a diagnostic snapshot for debugging.
   */
  getReport() {
    return {
      isHealthy: this._isHealthy,
      lastMs: Math.round(this._lastLatencyMs),
      avgMs: Math.round(this._avgLatencyMs),
      peakMs: Math.round(this._peakLatencyMs),
      samples: this._sampleCount,
      consecutiveFailures: this._consecutiveFailures,
    };
  }

  /**
   * Reset all state (e.g., on session restart).
   */
  reset() {
    this._consecutiveFailures = 0;
    this._isHealthy = true;
    this._lastLatencyMs = 0;
    this._avgLatencyMs = 0;
    this._peakLatencyMs = 0;
    this._sampleCount = 0;
    this._latencyWindow = [];
  }
}
