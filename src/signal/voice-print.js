/**
 * Cue — Voice Print (v0.9)
 *
 * Lightweight speaker fingerprinting. Captures a feature vector during a
 * 20-second calibration, then gates each runtime frame by z-score distance
 * to the captured template. Filters OTHER speakers even when they're at
 * the same near-field distance as the user.
 *
 * Approach:
 *   - 6-dimensional feature vector per frame:
 *       [zcr, spectralCentroid, spectralFlatness, spectralRolloff,
 *        bandEnergy[0], bandEnergy[1], bandEnergy[2], bandEnergy[3]]
 *     (8 dims actually, hence "voice fingerprint")
 *   - Calibration computes mean + stdev for each dimension across all
 *     SPEECH frames during the 20s window
 *   - Runtime: per-frame z-score = sum( ((x-mean)/stdev)^2 ) / dim
 *     z-score below threshold => same speaker
 *
 * Trade-offs:
 *   - Far weaker than learned embeddings (no MFCC, no DNN), but pure JS,
 *     ~10ms compute per frame, no model files to ship.
 *   - Tuned to differentiate adult speakers in similar acoustic conditions.
 *   - Works best when the OTHER speaker has different fundamental
 *     frequency / formants — i.e. opposite-sex partners, parents w/ kids,
 *     adults w/ teens. Can struggle to distinguish two same-sex adults
 *     in the same room. v1.0 would need MFCC + cosine similarity for that.
 */

class CueVoicePrint {
  constructor() {
    this._template = null;        // { mean[8], stdev[8], frameCount }
    this._calibrating = false;
    this._calibStart = 0;
    this._calibSamples = [];      // [number[8]]
    this._calibDurationMs = 20000;
    this._matchThreshold = 7.0;   // total z-score sum acceptable as "same speaker"
    this._enabled = false;        // false until calibration completes
  }

  /** True if a voice print is loaded and ready to gate runtime frames. */
  get isEnabled() { return this._enabled && !!this._template; }

  /** True if currently capturing a calibration sample. */
  get isCalibrating() { return this._calibrating; }

  /**
   * Begin a 20-second calibration capture. The caller should keep feeding
   * `recordFrame()` for the duration. `onProgress(secondsLeft, framesUsed)`
   * fires every frame so the UI can show a countdown.
   */
  startCalibration() {
    this._calibrating = true;
    this._calibStart = Date.now();
    this._calibSamples = [];
  }

  /**
   * Cancel a calibration in progress without saving.
   */
  cancelCalibration() {
    this._calibrating = false;
    this._calibSamples = [];
  }

  /**
   * Feed one feature frame into the calibration capture.
   * Returns { progress: 0..1, framesUsed, done }.
   * When done=true the caller should call finalizeCalibration().
   */
  recordFrame(features) {
    if (!this._calibrating) return { progress: 0, framesUsed: 0, done: false };
    // Only count frames that are actually speech — silence frames
    // pollute the template.
    if (!features || !features.isSpeech) {
      const elapsed = Date.now() - this._calibStart;
      return {
        progress: Math.min(1, elapsed / this._calibDurationMs),
        framesUsed: this._calibSamples.length,
        done: elapsed >= this._calibDurationMs,
      };
    }
    const v = this._extractVector(features);
    if (v) this._calibSamples.push(v);
    const elapsed = Date.now() - this._calibStart;
    return {
      progress: Math.min(1, elapsed / this._calibDurationMs),
      framesUsed: this._calibSamples.length,
      done: elapsed >= this._calibDurationMs,
    };
  }

  /**
   * Compute the voice template (mean + stdev) from the captured samples
   * and store it. Returns true if calibration succeeded (>= 30 frames),
   * false if not enough speech data was collected.
   */
  finalizeCalibration() {
    this._calibrating = false;
    if (this._calibSamples.length < 30) {
      console.warn('[Cue VoicePrint] not enough speech frames:', this._calibSamples.length);
      this._calibSamples = [];
      return false;
    }
    const dim = 8;
    const mean = new Array(dim).fill(0);
    for (const s of this._calibSamples) {
      for (let i = 0; i < dim; i++) mean[i] += s[i];
    }
    for (let i = 0; i < dim; i++) mean[i] /= this._calibSamples.length;
    const variance = new Array(dim).fill(0);
    for (const s of this._calibSamples) {
      for (let i = 0; i < dim; i++) {
        const d = s[i] - mean[i];
        variance[i] += d * d;
      }
    }
    const stdev = variance.map(v => {
      const sd = Math.sqrt(v / Math.max(1, this._calibSamples.length - 1));
      // Floor stdev so zero-variance dims don't blow up z-score.
      return Math.max(sd, mean.length > 0 ? 0.0001 : 0.0001);
    });
    this._template = {
      mean, stdev,
      frameCount: this._calibSamples.length,
      capturedAt: Date.now(),
    };
    this._calibSamples = [];
    this._enabled = true;
    console.log('[Cue VoicePrint] calibrated on', this._template.frameCount, 'frames.');
    return true;
  }

  /**
   * At runtime: returns true if `features` look like the calibrated speaker.
   * Always returns true if voice-print is disabled or no template exists.
   */
  matches(features) {
    if (!this._enabled || !this._template) return true;
    if (!features || !features.isSpeech) return true; // silence is everyone's
    const v = this._extractVector(features);
    if (!v) return true;
    let total = 0;
    for (let i = 0; i < 8; i++) {
      const z = (v[i] - this._template.mean[i]) / this._template.stdev[i];
      total += z * z;
    }
    return total < (this._matchThreshold * 8); // sum-of-squared-z bound
  }

  /**
   * Persist template to chrome.storage.local. Caller restores by passing
   * the saved object to load(). Survives restarts.
   */
  serialize() {
    if (!this._template) return null;
    return {
      template: this._template,
      threshold: this._matchThreshold,
      version: 1,
    };
  }

  /**
   * Restore a previously serialized voice print. Returns true on success.
   */
  load(saved) {
    if (!saved || !saved.template || saved.version !== 1) return false;
    this._template = saved.template;
    this._matchThreshold = saved.threshold || 7.0;
    this._enabled = true;
    return true;
  }

  /**
   * Discard the template — user wants to recalibrate.
   */
  reset() {
    this._template = null;
    this._enabled = false;
    this._calibSamples = [];
    this._calibrating = false;
  }

  /**
   * Internal: extract the 8-dim feature vector from one signal/audio
   * features object. Returns null if any required feature is missing.
   */
  _extractVector(f) {
    if (typeof f.zcr !== 'number') return null;
    if (typeof f.spectralCentroid !== 'number') return null;
    const be = f.bandEnergy || [0,0,0,0];
    return [
      f.zcr,
      f.spectralCentroid,
      f.spectralFlatness || 0,
      f.spectralRolloff || 0,
      be[0] || 0, be[1] || 0, be[2] || 0, be[3] || 0,
    ];
  }
}

// Belt-and-suspenders global exposure (matches existing Cue patterns).
if (typeof globalThis !== 'undefined') globalThis.CueVoicePrint = CueVoicePrint;
if (typeof window !== 'undefined')     window.CueVoicePrint     = CueVoicePrint;
if (typeof self !== 'undefined')       self.CueVoicePrint       = CueVoicePrint;


/**
 * Cue — Speaker Counter (v1.0)
 *
 * Counts distinct OTHER voices in a session by clustering the same 8-dim
 * spectral features used by CueVoicePrint. Runs only on frames the
 * voice-print already rejected (i.e. confidently not the calibrated user),
 * so it never miscounts the user as a second voice.
 *
 * Thesis: zero-config awareness. The user never opens settings. Cue just
 * tells them "I can hear 2 voices" or "3 voices" once it's confident.
 *
 * Design:
 *   - Each cluster = running mean[8] + frame count + last-seen timestamp.
 *   - Match a frame to a cluster if Euclidean distance in normalized
 *     feature space falls under MATCH_DIST. Update the centroid (online
 *     mean) on match.
 *   - Spawn a new cluster only if NO existing cluster matches AND we've
 *     accumulated MIN_NEW_FRAMES of consistent unmatched frames inside a
 *     NEW_WINDOW_MS window. This kills phantom voices from spectral
 *     noise / brief room sounds.
 *   - A cluster only "counts" once it has CONFIRM_FRAMES frames, so
 *     transient blips don't bump the displayed count.
 *   - Clusters that haven't been heard from in STALE_MS get pruned.
 *
 * Counted speakers does NOT include the user. Total displayed = 1 + N.
 */
class CueSpeakerCounter {
  constructor() {
    this._clusters = [];        // [{centroid[8], count, lastSeenAt, confirmedAt}]
    this._pending = null;       // {sumVec[8], frames, firstAt}
    this._lastResetAt = Date.now();
    // Tunables
    this.MATCH_DIST = 0.85;      // normalized distance threshold for "same speaker"
    this.MIN_NEW_FRAMES = 25;    // frames of unmatched audio before spawning a new cluster
    this.NEW_WINDOW_MS = 8000;   // those frames must accumulate within this window
    this.CONFIRM_FRAMES = 60;    // cluster must reach this size to count toward total
    this.STALE_MS = 90 * 1000;   // forget clusters not heard from in this long
    // Per-feature normalization. Each scale value is roughly the inter-speaker
    // variation we expect in adult voices, so a normalized distance of ~1 is
    // "could plausibly be the same person" and ~3+ is "definitely different".
    // Tightened in v1.0.1 — original scales were 5-10x too generous and
    // collapsed every voice into the first cluster.
    this._scale = [0.04, 600, 0.1, 1500, 0.015, 0.015, 0.015, 0.015];
  }

  /** Reset all clusters at session boundary. */
  reset() {
    this._clusters = [];
    this._pending = null;
    this._lastResetAt = Date.now();
  }

  /** Total distinct voices currently CONFIRMED (excludes user). */
  get otherVoiceCount() {
    return this._clusters.filter(c => c.count >= this.CONFIRM_FRAMES).length;
  }

  /** Speakers including user (always >= 1). */
  get totalSpeakerCount() {
    return 1 + this.otherVoiceCount;
  }

  /**
   * Feed one frame that the voice-print REJECTED (i.e. not the user).
   * Returns true if the confirmed-count changed (caller may want to
   * broadcast / update UI).
   */
  observeRejectedFrame(features) {
    const v = this._extract(features);
    if (!v) return false;
    const now = Date.now();
    this._pruneStale(now);
    const before = this.otherVoiceCount;

    const match = this._nearestCluster(v);
    // Expire stale pending evidence regardless of branch.
    if (this._pending && (now - this._pending.firstAt > this.NEW_WINDOW_MS)) {
      this._pending = null;
    }
    if (match && match.dist < this.MATCH_DIST) {
      // Online mean update for the first CONFIRM_FRAMES; EMA after that.
      // The EMA cap (alpha=0.02) prevents an established cluster's centroid
      // from drifting indefinitely toward whatever recent frames look like —
      // critical when two speakers' clusters are close together, otherwise
      // cluster A would swallow cluster B over time.
      const c = match.cluster;
      c.count += 1;
      const alpha = c.count <= this.CONFIRM_FRAMES ? (1 / c.count) : 0.02;
      for (let i = 0; i < 8; i++) {
        c.centroid[i] += alpha * (v[i] - c.centroid[i]);
      }
      c.lastSeenAt = now;
      if (c.count >= this.CONFIRM_FRAMES && !c.confirmedAt) c.confirmedAt = now;
      // NOTE: do NOT reset pending here. A run of borderline frames that
      // sometimes match the nearest cluster and sometimes don't is the
      // exact signature of a second speaker fighting for the same cluster.
      // Letting pending accumulate alongside matches is what lets us spawn
      // a new cluster eventually instead of being trapped in the first one.
    } else {
      // No existing cluster matches. Accumulate evidence before spawning.
      if (!this._pending) {
        this._pending = { sumVec: v.slice(), frames: 1, firstAt: now };
      } else {
        for (let i = 0; i < 8; i++) this._pending.sumVec[i] += v[i];
        this._pending.frames += 1;
        if (this._pending.frames >= this.MIN_NEW_FRAMES) {
          const centroid = this._pending.sumVec.map(x => x / this._pending.frames);
          this._clusters.push({
            centroid,
            count: this._pending.frames,
            lastSeenAt: now,
            confirmedAt: this._pending.frames >= this.CONFIRM_FRAMES ? now : null,
          });
          this._pending = null;
        }
      }
    }

    return this.otherVoiceCount !== before;
  }

  _pruneStale(now) {
    this._clusters = this._clusters.filter(c => now - c.lastSeenAt < this.STALE_MS);
  }

  _nearestCluster(v) {
    let best = null;
    for (const c of this._clusters) {
      const d = this._normDist(v, c.centroid);
      if (!best || d < best.dist) best = { cluster: c, dist: d };
    }
    return best;
  }

  _normDist(a, b) {
    let s = 0;
    for (let i = 0; i < 8; i++) {
      const d = (a[i] - b[i]) / this._scale[i];
      s += d * d;
    }
    return Math.sqrt(s / 8);
  }

  _extract(f) {
    if (!f || typeof f.zcr !== 'number' || typeof f.spectralCentroid !== 'number') return null;
    const be = f.bandEnergy || [0,0,0,0];
    return [
      f.zcr,
      f.spectralCentroid,
      f.spectralFlatness || 0,
      f.spectralRolloff || 0,
      be[0] || 0, be[1] || 0, be[2] || 0, be[3] || 0,
    ];
  }
}

if (typeof globalThis !== 'undefined') globalThis.CueSpeakerCounter = CueSpeakerCounter;
if (typeof window !== 'undefined')     window.CueSpeakerCounter     = CueSpeakerCounter;
if (typeof self !== 'undefined')       self.CueSpeakerCounter       = CueSpeakerCounter;
