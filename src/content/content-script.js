/**
 * Cue — Content Script
 *
 * Injected into supported video call pages (Teams Web).
 * Orchestrates the full pipeline:
 *   1. Injects floating overlay (Shadow DOM)
 *   2. Starts audio capture on user click
 *   3. Routes features through signal model (calibration + scoring)
 *   4. Feeds scores into nudge engine (threshold detection)
 *   5. Displays nudges (text card + edge glow + breathing pacer)
 */

(function () {
  'use strict';

  console.log('[Cue] Content script loaded on:', window.location.href);

  // -- State --
  let shadowRoot = null;
  let nudgeRoot = null;  // separate shadow root for nudge overlay (full-screen)
  let audioManager = null;
  let signalModel = null;
  let nudgeEngine = null;
  let latencyMonitor = null;
  let isActive = false;
  let nudgePack = 'gentle'; // default nudge text pack
  let nudgeChannels = ['visual']; // which channels to deliver nudges on
  let userSettings = null; // loaded from chrome.storage

  // -- Session tracking for Integration Tape --
  let _sessionId = null;
  let _sessionStartTime = null;
  let _frameBuffer = [];          // batch frames before writing to IndexedDB
  let _frameStoreInterval = null; // store frames every ~1 second
  let _lastFrameStoreTime = 0;
  let _latestSignal = null;       // most recent signal for frame storage

  // ============================================================
  // OVERLAY INJECTION
  // ============================================================

  function injectOverlay() {
    if (document.getElementById('cue-host') || document.getElementById('cue-nudge-host')) {
      console.log('[Cue] Overlay already injected, skipping.');
      return;
    }

    const host = document.createElement('div');
    host.id = 'cue-host';
    host.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      z-index: 2147483647;
      pointer-events: none;
    `;
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = getOverlayStyles();
    shadowRoot.appendChild(style);

    const widget = document.createElement('div');
    widget.id = 'cue-widget';
    widget.innerHTML = getOverlayHTML();
    shadowRoot.appendChild(widget);

    // Create a SEPARATE full-screen host for nudge card + glow
    // (position:fixed inside a small shadow host gets clipped)
    const nudgeHost = document.createElement('div');
    nudgeHost.id = 'cue-nudge-host';
    nudgeHost.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      pointer-events: none;
    `;
    document.body.appendChild(nudgeHost);

    nudgeRoot = nudgeHost.attachShadow({ mode: 'open' });

    const nudgeStyle = document.createElement('style');
    nudgeStyle.textContent = getNudgeStyles();
    nudgeRoot.appendChild(nudgeStyle);

    const nudgeCard = document.createElement('div');
    nudgeCard.id = 'cue-nudge-card';
    nudgeCard.className = 'cue-nudge-card';
    nudgeCard.innerHTML = '<div class="cue-nudge-text" id="cue-nudge-text"></div>';
    nudgeRoot.appendChild(nudgeCard);

    const glow = document.createElement('div');
    glow.id = 'cue-glow';
    nudgeRoot.appendChild(glow);

    console.log('[Cue] Overlay injected successfully.');
  }

  function getOverlayStyles() {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      /* ---- Widget ---- */
      #cue-widget {
        pointer-events: auto;
        width: 170px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.78);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.4);
        box-shadow:
          0 2px 16px rgba(0, 0, 0, 0.06),
          0 0.5px 1px rgba(0, 0, 0, 0.04);
        opacity: 0.35;
        transition: opacity 0.4s ease;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        user-select: none;
        cursor: grab;
        position: relative;
      }

      #cue-widget:hover {
        opacity: 1;
      }

      #cue-widget.active {
        opacity: 0.35;
      }

      #cue-widget.active:hover {
        opacity: 1;
      }

      #cue-widget.alert {
        opacity: 1;
      }

      /* ---- Header ---- */
      .cue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }

      .cue-header-left {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .cue-logo {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ccc;
        flex-shrink: 0;
        transition: background 0.3s ease, box-shadow 0.3s ease;
      }

      .cue-logo.live {
        background: #2DD4A0;
        box-shadow: 0 0 6px rgba(45, 212, 160, 0.5);
      }

      .cue-title {
        font-size: 10px;
        font-weight: 600;
        color: #1a1a1a;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      /* ---- Signal Bars ---- */
      .cue-bars {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .cue-bar-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .cue-bar-label {
        font-size: 8px;
        font-weight: 600;
        color: #999;
        width: 42px;
        text-align: right;
        flex-shrink: 0;
        letter-spacing: 0.3px;
      }

      .cue-bar-track {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: rgba(0, 0, 0, 0.06);
        overflow: hidden;
      }

      .cue-bar-fill {
        height: 100%;
        border-radius: 2px;
        width: 0%;
        transition: width 150ms ease-out, background 0.3s ease;
      }

      .cue-bar-fill.tension { background: linear-gradient(90deg, #FCA5A5, #EF4444); }
      .cue-bar-fill.pace    { background: linear-gradient(90deg, #FDE68A, #F59E0B); }
      .cue-bar-fill.energy  { background: linear-gradient(90deg, #93C5FD, #3B82F6); }

      /* ---- Status ---- */
      .cue-status {
        margin-top: 8px;
        font-size: 9px;
        color: #aaa;
        text-align: center;
        min-height: 14px;
        transition: color 0.3s ease;
      }

      @keyframes calibrate-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .cue-status.calibrating {
        color: #F59E0B;
        animation: calibrate-pulse 1.5s ease-in-out infinite;
      }

      /* ---- Start/Stop Button ---- */
      .cue-start-btn {
        display: block;
        width: 100%;
        margin-top: 8px;
        padding: 5px 0;
        border: none;
        border-radius: 8px;
        background: #2DD4A0;
        color: white;
        font-size: 10px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        letter-spacing: 0.3px;
        transition: background 0.2s ease, transform 0.1s ease;
      }

      .cue-start-btn:hover { background: #22B88A; }
      .cue-start-btn:active { transform: scale(0.97); }
      .cue-start-btn.stop { background: #EF4444; }
      .cue-start-btn.stop:hover { background: #DC2626; }

      /* ---- Breathing Pacer (escalation only) ---- */
      .cue-pacer {
        position: absolute;
        bottom: calc(100% + 60px);
        left: 50%;
        transform: translateX(-50%);
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(45, 212, 160, 0.15);
        border: 2px solid rgba(45, 212, 160, 0.4);
        opacity: 0;
        transition: opacity 0.5s ease;
        pointer-events: none;
      }

      .cue-pacer.active {
        opacity: 1;
        animation: breathe 8s ease-in-out infinite;
      }

      .cue-pacer-label {
        position: absolute;
        bottom: calc(100% + 48px);
        left: 50%;
        transform: translateX(-50%);
        font-size: 8px;
        color: #2DD4A0;
        letter-spacing: 1px;
        text-transform: lowercase;
        opacity: 0;
        transition: opacity 0.5s ease;
        pointer-events: none;
      }

      .cue-pacer-label.active {
        opacity: 0.7;
      }

      @keyframes breathe {
        0%, 100% {
          transform: translateX(-50%) scale(1);
          background: rgba(45, 212, 160, 0.15);
          border-color: rgba(45, 212, 160, 0.4);
        }
        50% {
          transform: translateX(-50%) scale(1.6);
          background: rgba(45, 212, 160, 0.3);
          border-color: rgba(45, 212, 160, 0.7);
        }
      }

    `;
  }

  function getNudgeStyles() {
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      /* ---- Nudge Card (center of viewport) ---- */
      .cue-nudge-card {
        position: absolute;
        top: 45%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.95);
        padding: 32px 64px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.97);
        backdrop-filter: blur(30px);
        -webkit-backdrop-filter: blur(30px);
        border: 1px solid rgba(255, 255, 255, 0.6);
        box-shadow: 0 12px 60px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08);
        text-align: center;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        opacity: 0;
        transition: opacity 0.25s ease, transform 0.25s ease;
        pointer-events: none;
        white-space: nowrap;
      }

      .cue-nudge-card.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      .cue-nudge-card.dismissing {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.95);
      }

      .cue-nudge-text {
        font-size: 32px;
        font-weight: 700;
        letter-spacing: 2px;
        color: #1a1a1a;
      }

      .cue-nudge-text.pace { color: #D97706; }
      .cue-nudge-text.tension { color: #DC2626; }
      .cue-nudge-text.long_speech { color: #D97706; }
      .cue-nudge-text.escalation { color: #DC2626; }

      /* ---- Edge Glow ---- */
      #cue-glow {
        position: absolute;
        top: 0;
        right: 0;
        width: 4px;
        height: 100%;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.5s ease, width 0.3s ease;
      }

      #cue-glow.active {
        opacity: 0.6;
        width: 8px;
      }

      #cue-glow.intense {
        opacity: 1;
        width: 12px;
      }

      #cue-glow.pace    { background: linear-gradient(180deg, transparent, #F59E0B, transparent); }
      #cue-glow.tension { background: linear-gradient(180deg, transparent, #EF4444, transparent); }
      #cue-glow.escalation {
        background: linear-gradient(180deg, transparent, #EF4444, transparent);
        animation: glow-pulse 1.5s ease-in-out infinite;
      }
      #cue-glow.long_speech { background: linear-gradient(180deg, transparent, #F59E0B, transparent); }

      @keyframes glow-pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }
    `;
  }

  function getOverlayHTML() {
    return `
      <div class="cue-pacer" id="cue-pacer"></div>
      <div class="cue-pacer-label" id="cue-pacer-label">breathe</div>
      <div class="cue-header">
        <div class="cue-header-left">
          <div class="cue-logo" id="cue-logo"></div>
          <span class="cue-title">Cue</span>
        </div>
      </div>
      <div class="cue-bars">
        <div class="cue-bar-row">
          <span class="cue-bar-label">Tension</span>
          <div class="cue-bar-track">
            <div class="cue-bar-fill tension" id="cue-tension-bar"></div>
          </div>
        </div>
        <div class="cue-bar-row">
          <span class="cue-bar-label">Pace</span>
          <div class="cue-bar-track">
            <div class="cue-bar-fill pace" id="cue-pace-bar"></div>
          </div>
        </div>
        <div class="cue-bar-row">
          <span class="cue-bar-label">Energy</span>
          <div class="cue-bar-track">
            <div class="cue-bar-fill energy" id="cue-energy-bar"></div>
          </div>
        </div>
      </div>
      <div class="cue-status" id="cue-status">Click to start</div>
      <button class="cue-start-btn" id="cue-start-btn">Start Cue</button>
    `;
  }

  // ============================================================
  // AUDIO PIPELINE
  // ============================================================

  async function startAudio() {
    const statusEl = shadowRoot.getElementById('cue-status');
    const btnEl = shadowRoot.getElementById('cue-start-btn');
    const logoEl = shadowRoot.getElementById('cue-logo');

    try {
      statusEl.textContent = 'Starting...';
      statusEl.className = 'cue-status';

      // Load user settings from chrome.storage
      try {
        const stored = await chrome.storage.local.get(['cueSettings', 'cuePro', 'cueSessionCount']);
        userSettings = stored.cueSettings || {};
        nudgePack = userSettings.nudgePack || 'gentle';
        nudgeChannels = userSettings.nudgeChannels || ['visual'];

        // Apply custom thresholds if configured
        if (userSettings.paceThreshold) CUE_THRESHOLDS.PACE_THRESHOLD = userSettings.paceThreshold;
        if (userSettings.tensionThreshold) CUE_THRESHOLDS.TENSION_THRESHOLD = userSettings.tensionThreshold;
        if (userSettings.longSpeechSec) CUE_THRESHOLDS.LONG_SPEECH_SEC = userSettings.longSpeechSec;
        if (userSettings.gracePeriodSec) CUE_THRESHOLDS.GRACE_PERIOD_SEC = userSettings.gracePeriodSec;
        if (userSettings.cooldownSec) CUE_THRESHOLDS.COOLDOWN_SEC = userSettings.cooldownSec;

        console.log('[Cue] Settings loaded:', { nudgePack, nudgeChannels, pace: CUE_THRESHOLDS.PACE_THRESHOLD, tension: CUE_THRESHOLDS.TENSION_THRESHOLD });
      } catch (e) {
        console.log('[Cue] Using default settings');
      }

      // Check pro status + Taste of Pro trial
      let isPro = false;
      let sessionCount = 0;
      try {
        const result = await chrome.storage.local.get(['cuePro', 'cueSessionCount']);
        isPro = result.cuePro === true;
        sessionCount = result.cueSessionCount || 0;
      } catch (e) {}

      // Taste of Pro: first 3 calls get full Pro experience
      const effectivePro = isPro || sessionCount < 3;

      if (!isPro && sessionCount < 3) {
        console.log('[Cue] Taste of Pro active — session ' + (sessionCount + 1) + ' of 3 free Pro sessions');
      }

      // Initialize signal model, nudge engine, and latency monitor
      signalModel = new CueSignalModel();
      nudgeEngine = new CueNudgeEngine(onNudge, { isPro: effectivePro });
      latencyMonitor = new CueLatencyMonitor({
        onHealthChange: (healthy, latency) => {
          updateLatencyIndicator(healthy, latency);
        }
      });

      // CueAudioManager loaded via manifest content_scripts (runs before this file)
      audioManager = new CueAudioManager(onFeatures);
      await audioManager.start();

      isActive = true;
      logoEl.classList.add('live');
      btnEl.textContent = 'Stop';
      btnEl.classList.add('stop');
      statusEl.textContent = 'Calibrating...';
      statusEl.className = 'cue-status calibrating';
      shadowRoot.getElementById('cue-widget').classList.add('active');

      // Start session tracking for Integration Tape
      startSession();

    } catch (err) {
      console.error('[Cue] Failed to start audio:', err);
      statusEl.textContent = err.name === 'NotAllowedError'
        ? 'Mic access needed'
        : 'Error: ' + err.message;
      statusEl.className = 'cue-status';
    }
  }

  function stopAudio() {
    // End session BEFORE clearing nudgeEngine (we need its history)
    endSession();

    if (audioManager) {
      audioManager.stop();
      audioManager = null;
    }
    signalModel = null;
    nudgeEngine = null;
    if (latencyMonitor) { latencyMonitor.reset(); latencyMonitor = null; }
    isActive = false;

    const statusEl = shadowRoot.getElementById('cue-status');
    const btnEl = shadowRoot.getElementById('cue-start-btn');
    const logoEl = shadowRoot.getElementById('cue-logo');

    logoEl.classList.remove('live');
    btnEl.textContent = 'Start Cue';
    btnEl.classList.remove('stop');
    statusEl.textContent = 'Click to start';
    statusEl.className = 'cue-status';
    shadowRoot.getElementById('cue-widget').classList.remove('active');

    updateBars(0, 0, 0);
    hideNudge();
    hideGlow();
    hidePacer();
  }

  // ============================================================
  // FEATURE PROCESSING PIPELINE
  // ============================================================

  /**
   * Called every ~128ms with raw features from the audio pipeline.
   * Routes through: features → signal model → nudge engine → display
   */
  // Debug counter — log every 50th frame (~6 seconds) to avoid console spam
  let _debugFrameCount = 0;

  function onFeatures(features) {
    if (!signalModel || !nudgeEngine) return;

    // Debug logging (every ~6 seconds)
    _debugFrameCount++;
    if (_debugFrameCount % 50 === 1) {
      console.log('[Cue Debug] Raw features:', {
        rms: features.rms.toFixed(5),
        zcr: Math.round(features.zcr),
        centroid: Math.round(features.spectralCentroid),
        isSpeech: features.isSpeech
      });
    }

    // Step 0: Track pipeline latency
    if (latencyMonitor && features._audioTimestamp) {
      latencyMonitor.mark(features._audioTimestamp);
    }

    // Step 1: Signal model transforms raw features into 0-100 scores
    const signal = signalModel.process(features);

    // Debug: log calibration progress
    if (signal.isCalibrating && _debugFrameCount % 50 === 1) {
      console.log('[Cue Debug] Calibration:', Math.round(signal.calibrationProgress * 100) + '%',
        'speechTime:', signalModel._speechTimeSec.toFixed(1) + 's');
    }

    // Store latest signal for frame recording (Integration Tape)
    _latestSignal = signal;

    // Step 2: Nudge engine checks thresholds (only if pipeline is healthy)
    if (!latencyMonitor || latencyMonitor.isHealthy) {
      nudgeEngine.process(signal);
    }

    // Step 3: Update display
    requestAnimationFrame(() => {
      updateBars(signal.tension, signal.pace, signal.energy);
      updateStatus(signal);
    });
  }

  // ============================================================
  // BAR DISPLAY
  // ============================================================

  function updateBars(tension, pace, energy) {
    if (!shadowRoot) return;

    const tensionBar = shadowRoot.getElementById('cue-tension-bar');
    const paceBar = shadowRoot.getElementById('cue-pace-bar');
    const energyBar = shadowRoot.getElementById('cue-energy-bar');

    if (tensionBar) tensionBar.style.width = tension + '%';
    if (paceBar) paceBar.style.width = pace + '%';
    if (energyBar) energyBar.style.width = energy + '%';

    // Widget goes full opacity when signals are elevated
    const widget = shadowRoot.getElementById('cue-widget');
    const maxSignal = Math.max(tension, pace, energy);
    if (isActive && maxSignal > CUE_THRESHOLDS.ALERT_OPACITY_THRESHOLD) {
      widget.classList.add('alert');
    } else {
      widget.classList.remove('alert');
    }
  }

  function updateStatus(signal) {
    const statusEl = shadowRoot.getElementById('cue-status');
    if (!statusEl) return;

    if (signal.isCalibrating) {
      const pct = Math.round(signal.calibrationProgress * 100);
      statusEl.textContent = `Calibrating... ${pct}%`;
      statusEl.className = 'cue-status calibrating';
    } else if (signal.isSpeech) {
      statusEl.textContent = 'Speaking...';
      statusEl.className = 'cue-status';
    } else {
      statusEl.textContent = 'Listening...';
      statusEl.className = 'cue-status';
    }
  }

  // ============================================================
  // NUDGE DISPLAY
  // ============================================================

  let nudgeDismissTimer = null;
  let glowDismissTimer = null;
  let pacerTimer = null;

  /**
   * Called by the nudge engine when a threshold is crossed.
   */
  function onNudge(nudgeEvent) {
    console.log('[Cue] Nudge received:', nudgeEvent.type, nudgeEvent.scores);

    // Get nudge text from active pack
    const text = CUE_THRESHOLDS.NUDGE_PACKS[nudgePack][nudgeEvent.type];

    // Visual channel: text card + glow (always enabled by default)
    if (nudgeChannels.includes('visual')) {
      if (text) {
        showNudgeCard(text, nudgeEvent.type);
      }
      showGlow(nudgeEvent.type);
    }

    // Show breathing pacer for escalation events (always, regardless of channel)
    if (nudgeEvent.type === 'escalation') {
      showPacer();
    }

    // Relay nudge to service worker for cross-device delivery
    // (system notifications, Apple Watch haptics, phone push)
    try {
      chrome.runtime.sendMessage({
        type: 'nudgeFired',
        nudgeType: nudgeEvent.type,
        text: text || nudgeEvent.type,
        scores: nudgeEvent.scores,
        nudgeNumber: nudgeEvent.nudgeNumber,
        timestamp: nudgeEvent.timestamp
      }).catch(() => {
        // Service worker may be sleeping — non-critical
      });
    } catch (e) {
      // Extension context may be invalid
    }
  }

  /**
   * Update the latency indicator when pipeline health changes.
   */
  function updateLatencyIndicator(healthy, latency) {
    if (!shadowRoot) return;
    const statusEl = shadowRoot.getElementById('cue-status');
    if (!statusEl) return;

    if (!healthy) {
      statusEl.textContent = '! Lag detected — nudges paused';
      statusEl.className = 'cue-status';
      statusEl.style.color = '#E94560';
      console.warn('[Cue] Pipeline unhealthy:', Math.round(latency) + 'ms — nudges paused');
    } else {
      statusEl.style.color = '';
      console.log('[Cue] Pipeline recovered — nudges resumed');
    }
  }

  // Track nudge count for escalating subtlety
  let _visualNudgeCount = 0;

  function showNudgeCard(text, type) {
    const card = nudgeRoot.getElementById('cue-nudge-card');
    const textEl = nudgeRoot.getElementById('cue-nudge-text');
    if (!card || !textEl) return;

    if (nudgeDismissTimer) clearTimeout(nudgeDismissTimer);

    _visualNudgeCount++;

    textEl.textContent = text;
    textEl.className = 'cue-nudge-text ' + type;

    // First nudge: big, center screen, long linger (8 seconds)
    // Subsequent nudges: same position but shorter linger (5 seconds)
    const isFirst = _visualNudgeCount === 1;
    const lingerSec = isFirst ? 8 : 5;

    card.className = 'cue-nudge-card visible';

    console.log('[Cue] Showing nudge #' + _visualNudgeCount + ':', text, '(linger: ' + lingerSec + 's)');

    nudgeDismissTimer = setTimeout(() => {
      card.className = 'cue-nudge-card dismissing';
      setTimeout(() => {
        card.className = 'cue-nudge-card';
      }, 400);
    }, lingerSec * 1000);
  }

  function hideNudge() {
    if (nudgeDismissTimer) clearTimeout(nudgeDismissTimer);
    if (!nudgeRoot) return;
    const card = nudgeRoot.getElementById('cue-nudge-card');
    if (card) card.className = 'cue-nudge-card';
  }

  function showGlow(type) {
    if (!nudgeRoot) return;
    const glow = nudgeRoot.getElementById('cue-glow');
    if (!glow) return;

    if (glowDismissTimer) clearTimeout(glowDismissTimer);

    glow.className = 'active ' + type;
    if (type === 'escalation') {
      glow.classList.add('intense');
    }

    glowDismissTimer = setTimeout(() => {
      glow.className = '';
    }, CUE_THRESHOLDS.GLOW_FADE_SEC * 1000 + CUE_THRESHOLDS.NUDGE_DISPLAY_SEC * 1000);
  }

  function hideGlow() {
    if (glowDismissTimer) clearTimeout(glowDismissTimer);
    if (!nudgeRoot) return;
    const glow = nudgeRoot.getElementById('cue-glow');
    if (glow) glow.className = '';
  }

  function showPacer() {
    const pacer = shadowRoot.getElementById('cue-pacer');
    const label = shadowRoot.getElementById('cue-pacer-label');
    if (!pacer || !label) return;

    if (pacerTimer) clearTimeout(pacerTimer);

    pacer.classList.add('active');
    label.classList.add('active');

    // Run for 3 cycles (24 seconds) then fade out
    pacerTimer = setTimeout(() => {
      pacer.classList.remove('active');
      label.classList.remove('active');
    }, 24000);
  }

  function hidePacer() {
    if (pacerTimer) clearTimeout(pacerTimer);
    const pacer = shadowRoot.getElementById('cue-pacer');
    const label = shadowRoot.getElementById('cue-pacer-label');
    if (pacer) pacer.classList.remove('active');
    if (label) label.classList.remove('active');
  }

  // ============================================================
  // SESSION TRACKING + FRAME STORAGE (Integration Tape)
  // ============================================================

  function startSession() {
    _sessionId = 'cue-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    _sessionStartTime = Date.now();
    _frameBuffer = [];
    _lastFrameStoreTime = 0;
    _latestSignal = null;

    // Initialize IndexedDB
    CueDB.open().then(() => {
      console.log('[Cue] Session started:', _sessionId);
    }).catch(err => {
      console.error('[Cue] Failed to open CueDB:', err);
    });

    // Store one frame per second
    _frameStoreInterval = setInterval(() => {
      if (_latestSignal && _sessionId) {
        const frame = {
          sessionId: _sessionId,
          timestamp: Date.now(),
          tension: Math.round(_latestSignal.tension),
          pace: Math.round(_latestSignal.pace),
          energy: Math.round(_latestSignal.energy),
          isSpeech: _latestSignal.isSpeech
        };
        _frameBuffer.push(frame);

        // Flush buffer every 10 frames to reduce IndexedDB writes
        if (_frameBuffer.length >= 10) {
          flushFrames();
        }
      }
    }, 1000);
  }

  function flushFrames() {
    if (_frameBuffer.length === 0) return;

    const framesToStore = [..._frameBuffer];
    _frameBuffer = [];

    CueDB.addFrames(framesToStore).catch(err => {
      console.error('[Cue] Failed to store frames:', err);
    });
  }

  async function endSession() {
    if (!_sessionId || !_sessionStartTime) return;

    // Stop frame storage
    if (_frameStoreInterval) {
      clearInterval(_frameStoreInterval);
      _frameStoreInterval = null;
    }

    // Flush remaining frames
    flushFrames();

    // Compute EQ score
    const frames = await CueDB.getFrames(_sessionId);
    const nudgeHistory = nudgeEngine ? nudgeEngine.nudgeHistory : [];
    const eqScore = CueEQScore.compute(frames, nudgeHistory);

    // Save session record
    const session = {
      id: _sessionId,
      startTime: _sessionStartTime,
      endTime: Date.now(),
      duration: Date.now() - _sessionStartTime,
      eqScore: eqScore.total,
      eqBreakdown: {
        tensionStability: eqScore.tensionStability,
        strategicPausing: eqScore.strategicPausing,
        energyRegulation: eqScore.energyRegulation
      },
      nudgeCount: nudgeHistory.length,
      nudgeHistory: nudgeHistory,
      frameCount: frames.length
    };

    try {
      await CueDB.saveSession(session);
      console.log('[Cue] Session saved:', _sessionId, 'EQ Score:', eqScore.total);

      // Increment Taste of Pro session counter
      try {
        const countResult = await chrome.storage.local.get('cueSessionCount');
        const currentCount = countResult.cueSessionCount || 0;
        await chrome.storage.local.set({ cueSessionCount: currentCount + 1 });
        console.log('[Cue] Session count incremented to:', currentCount + 1);
      } catch (e) {
        console.error('[Cue] Failed to update session count:', e);
      }

      // Prune old sessions (keep last 20)
      await CueDB.pruneOldSessions(20);

      // Notify service worker to open Integration Tape
      chrome.runtime.sendMessage({
        type: 'sessionEnd',
        sessionId: _sessionId,
        eqScore: eqScore.total
      }).catch(() => {
        // Service worker may not be ready — open tape directly
        openTape(_sessionId);
      });

    } catch (err) {
      console.error('[Cue] Failed to save session:', err);
    }

    // Reset
    _sessionId = null;
    _sessionStartTime = null;
    _latestSignal = null;
  }

  function openTape(sessionId) {
    const tapeUrl = chrome.runtime.getURL('tape/tape.html') + '?session=' + sessionId;
    window.open(tapeUrl, '_blank');
  }

  // ============================================================
  // EVENT WIRING
  // ============================================================

  function wireEvents() {
    const btn = shadowRoot.getElementById('cue-start-btn');
    btn.addEventListener('click', () => {
      if (isActive) {
        stopAudio();
      } else {
        startAudio();
      }
    });

    // Make widget draggable
    makeDraggable();
  }

  // ============================================================
  // DRAGGABLE WIDGET
  // ============================================================

  function makeDraggable() {
    const host = document.getElementById('cue-host');
    const widget = shadowRoot.getElementById('cue-widget');
    if (!host || !widget) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;
    let hasMoved = false;

    // Load saved position
    try {
      chrome.storage.local.get('cueWidgetPos', (result) => {
        if (result.cueWidgetPos) {
          const pos = result.cueWidgetPos;
          // Validate position is still on screen
          const maxX = window.innerWidth - 50;
          const maxY = window.innerHeight - 50;
          host.style.left = Math.min(pos.left, maxX) + 'px';
          host.style.top = Math.min(pos.top, maxY) + 'px';
          console.log('[Cue] Widget position restored:', pos);
        }
      });
    } catch (e) { /* storage not available, use default position */ }

    widget.addEventListener('mousedown', (e) => {
      // Don't drag if clicking the button
      if (e.target.tagName === 'BUTTON') return;

      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseInt(host.style.left) || 20;
      origTop = parseInt(host.style.top) || 20;

      widget.style.cursor = 'grabbing';
      widget.style.opacity = '1';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Only count as a "move" if dragged more than 5px (prevents accidental drags)
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
      }

      let newLeft = origLeft + dx;
      let newTop = origTop + dy;

      // Keep on screen
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - 60));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - 60));

      host.style.left = newLeft + 'px';
      host.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      widget.style.cursor = 'default';

      if (hasMoved) {
        // Save position
        const pos = {
          left: parseInt(host.style.left) || 20,
          top: parseInt(host.style.top) || 20
        };
        try {
          chrome.storage.local.set({ cueWidgetPos: pos });
          console.log('[Cue] Widget position saved:', pos);
        } catch (e) { /* storage not available */ }
      }
    });
  }

  // ============================================================
  // AUTO-START: Immediate + Call Detection
  // ============================================================

  let _callDetectionObserver = null;
  let _isInCall = false;
  let _autoStartAttempted = false;

  /**
   * Auto-start Cue as soon as the page loads on a supported site.
   * No manual "Start Cue" click needed.
   * If mic permission was previously granted, it starts silently.
   * If not, Chrome will prompt — user clicks allow once, then it's remembered.
   */
  function autoStart() {
    if (_autoStartAttempted || isActive) return;
    _autoStartAttempted = true;

    // Short delay to let the page settle
    setTimeout(() => {
      if (!isActive) {
        console.log('[Cue] Auto-starting on supported call page...');
        startAudio();
      }
    }, 2000);
  }

  /**
   * Watch for call UI elements across Teams, Google Meet, and Zoom.
   * Used to auto-STOP Cue when the user leaves a call.
   * Also serves as a backup auto-start if the immediate auto-start
   * failed (e.g., mic permission wasn't pre-granted).
   */
  function startCallDetection() {
    if (_callDetectionObserver) return;

    // Check immediately
    checkCallState();

    // Then observe DOM changes
    _callDetectionObserver = new MutationObserver(debounce(() => {
      checkCallState();
    }, 2000));

    _callDetectionObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-tid', 'data-is-muted']
    });

    console.log('[Cue] Call detection active — watching for meeting UI.');
  }

  function checkCallState() {
    // Call indicators across all supported platforms
    const callIndicators = [
      // --- Teams ---
      '[aria-label*="Leave"]',
      '[aria-label*="Hang up"]',
      '[aria-label*="leave call"]',
      '[data-tid="hangup-btn"]',
      '[data-tid="leave-btn"]',
      'button[aria-label*="End call"]',

      // --- Google Meet ---
      '[aria-label*="Leave call"]',
      '[aria-label*="leave the call"]',
      '[data-is-muted]',                    // Mute button only exists in a call
      'button[aria-label*="Turn off microphone"]',
      'button[aria-label*="Turn on microphone"]',
      '[data-call-id]',

      // --- Zoom Web ---
      '[aria-label*="Leave Meeting"]',
      '[aria-label*="End Meeting"]',
      '.join-audio-by-voip',
      'button[aria-label*="Mute"]',
      '.meeting-app'
    ];

    let inCall = false;
    for (const selector of callIndicators) {
      try {
        if (document.querySelector(selector)) {
          inCall = true;
          break;
        }
      } catch (e) { /* invalid selector, skip */ }
    }

    if (inCall && !_isInCall) {
      _isInCall = true;
      console.log('[Cue] In-call UI detected.');
      // Backup auto-start if initial auto-start didn't fire
      if (!isActive) {
        console.log('[Cue] Call detected — starting Cue...');
        startAudio();
      }
    } else if (!inCall && _isInCall && isActive) {
      // Call just ended — auto-stop Cue
      console.log('[Cue] Call ended. Auto-stopping...');
      _isInCall = false;
      stopAudio();
    }
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ============================================================
  // INITIALIZE
  // ============================================================

  function init() {
    injectOverlay();
    wireEvents();

    // Auto-start immediately on any supported call page
    autoStart();

    // Also watch for call UI changes (backup start + auto-stop)
    startCallDetection();
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();
