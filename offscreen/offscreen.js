/**
 * Cue — Offscreen Audio Capture
 *
 * Runs in a hidden "offscreen document" — the canonical Chrome MV3 pattern
 * for extension audio capture. The side panel sends start/stop messages via
 * the service worker; this document actually calls getUserMedia and runs
 * the full DSP pipeline. Features + nudges flow back up via messages.
 *
 * Why offscreen instead of side panel directly:
 *   - Some Chrome versions refuse getUserMedia from side panel contexts
 *   - Offscreen documents with `USER_MEDIA` reason are the blessed path
 *   - This survives side panel close/open cycles
 */

(function () {
  'use strict';

  let audioManager = null;
  let signalModel = null;
  let nudgeEngine = null;
  let coachingEngine = null;
  let decisionEngine = null;
  let latencyMonitor = null;
  let isActive = false;
  let wasCalibrating = true;  // used to detect the calibration→done edge
  let currentSessionId = null;
  let pendingOutcomes = [];
  let lastQuestionCount = 0;
  let askQuestionPrompt = null;
  let pausePrompt = null;

  // Dual-stream (source = 'both') state
  let tabAudioManager = null;       // secondary audio manager for tab audio
  let interruptionDetector = null;

  // Throttle outgoing messages to ~10/sec for UI updates
  let lastBroadcast = 0;
  const BROADCAST_MIN_INTERVAL = 100; // ms

  // =============================================================
  // MESSAGE HANDLER
  // =============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only respond to offscreen-targeted messages
    if (message.target !== 'offscreen') return;

    switch (message.type) {
      case 'offscreen-ping':
        sendResponse({ ok: true, alive: true });
        return;

      case 'offscreen-start':
        startAudio(message.options || {}).then(
          (result) => sendResponse(result),
          (err) => sendResponse({ ok: false, error: err.message, errorName: err.name })
        );
        return true; // async response

      case 'offscreen-stop':
        stopAudio();
        sendResponse({ ok: true });
        return;

      case 'offscreen-diagnostics':
        runDiagnostics().then(
          (result) => sendResponse(result),
          (err) => sendResponse({ ok: false, error: err.message })
        );
        return true; // async
    }
  });

  // =============================================================
  // START / STOP
  // =============================================================

  async function startAudio(options) {
    try {
      if (isActive) {
        return { ok: true, note: 'already running' };
      }

      console.log('[Offscreen] Starting audio capture...');

      const isPro = options.isPro || false;

      // Apply adaptation (learned deltas from session history) — subtle and transparent
      try {
        const adaptStorage = await chrome.storage.local.get(['cueAdaptation', 'cueSettings']);
        const adaptationEnabled = adaptStorage.cueSettings?.adaptationEnabled !== false; // default true
        if (adaptationEnabled && adaptStorage.cueAdaptation) {
          const d = adaptStorage.cueAdaptation;
          if (typeof d.paceDelta === 'number')       CUE_THRESHOLDS.PACE_THRESHOLD += d.paceDelta;
          if (typeof d.tensionDelta === 'number')    CUE_THRESHOLDS.TENSION_THRESHOLD += d.tensionDelta;
          if (typeof d.longSpeechDelta === 'number') CUE_THRESHOLDS.LONG_SPEECH_SEC += d.longSpeechDelta;
          console.log('[Offscreen] Adaptation applied:', d);
        }
      } catch (e) { /* non-fatal */ }

      // Apply conversation-profile threshold overrides if provided
      if (options.profileOverrides) {
        const p = options.profileOverrides;
        if (typeof p.pace === 'number')       CUE_THRESHOLDS.PACE_THRESHOLD = p.pace;
        if (typeof p.tension === 'number')    CUE_THRESHOLDS.TENSION_THRESHOLD = p.tension;
        if (typeof p.longSpeech === 'number') CUE_THRESHOLDS.LONG_SPEECH_SEC = p.longSpeech;
        if (typeof p.cooldown === 'number')   CUE_THRESHOLDS.COOLDOWN_SEC = p.cooldown;
        console.log('[Offscreen] Profile overrides applied:', p);
      }

      currentSessionId = 'sess-' + Date.now();
      pendingOutcomes = [];
      lastQuestionCount = 0;
      askQuestionPrompt = null;
      pausePrompt = null;

      signalModel = new CueSignalModel();
      nudgeEngine = new CueNudgeEngine(onNudge, { isPro });
      coachingEngine = new CueCoachingEngine(onCoach, {
        intensity: options.coachingIntensity || 'gentle',
      });
      decisionEngine = new CueDecisionEngine(onDecision, {
        // Tuned for real-call context — practice sessions will still hit the
        // ratio quickly since there's no other speaker. For solo practice,
        // the ASK_QUESTION decision is the more useful signal.
        speakingRatioThreshold: 0.85,   // was 0.75 — too aggressive in practice
        questionSilenceSec: 60,
        cooldownSec: 15,                 // was 5 — give the nudge time to breathe
        gracePeriodSec: 15,              // was 10
        interruptionCooldownSec: 20,     // was 8
      });
      latencyMonitor = new CueLatencyMonitor({
        onHealthChange: (healthy, latency) => {
          broadcast({ type: 'latency-health', healthy, latency });
        }
      });
      audioManager = new CueAudioManager(onFeatures);

      // Dual-stream mode: user mic + remote tab audio, running concurrently
      // for real interruption detection.
      if (options.source === 'both' && options.streamId) {
        console.log('[Offscreen] Dual-stream: capturing BOTH mic + tab audio.');

        // Start mic first
        await audioManager.start();

        // Start tab audio in parallel
        const tabStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: options.streamId,
            },
          },
          video: false,
        });
        try {
          const ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(tabStream);
          src.connect(ctx.destination);
        } catch (e) { console.warn('[Offscreen] Passthrough failed:', e); }

        tabAudioManager = new CueAudioManager((remoteFeatures) => {
          if (interruptionDetector) {
            interruptionDetector.updateRemote(remoteFeatures.isSpeech);
          }
        });
        await tabAudioManager.start(tabStream);

        interruptionDetector = new CueInterruptionDetector((evt) => {
          broadcast({
            type: 'interruption-detected',
            count: evt.count,
            overlapMs: evt.overlapMs,
            timestamp: evt.timestamp,
          });
        });

        isActive = true;
        wasCalibrating = true;
        console.log('[Offscreen] Dual-stream active.');
        return { ok: true, started: true, source: 'both' };
      }

      if (options.source === 'tab' && options.streamId) {
        console.log('[Offscreen] Capturing TAB audio. URL:', options.tabUrl || '(unknown)');
        const tabStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: options.streamId,
            },
          },
          video: false,
        });

        // Route the tab audio through AudioContext.destination so the user
        // still hears the call (tabCapture mutes the tab locally by default).
        try {
          const ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(tabStream);
          src.connect(ctx.destination);
        } catch (e) {
          console.warn('[Offscreen] Passthrough audio failed:', e);
        }

        await audioManager.start(tabStream);
      } else {
        console.log('[Offscreen] Capturing MIC audio.');
        await audioManager.start();
      }

      isActive = true;
      wasCalibrating = true;
      console.log('[Offscreen] Audio capture started.');

      return { ok: true, started: true };
    } catch (err) {
      console.error('[Offscreen] startAudio failed:', err);
      // Tear down anything partial
      stopAudio();
      return {
        ok: false,
        error: err.message || String(err),
        errorName: err.name || 'UnknownError',
        stack: err.stack ? err.stack.slice(0, 500) : null,
      };
    }
  }

  function stopAudio() {
    if (audioManager) {
      try { audioManager.stop(); } catch (e) {}
      audioManager = null;
    }
    if (tabAudioManager) {
      try { tabAudioManager.stop(); } catch (e) {}
      tabAudioManager = null;
    }
    if (interruptionDetector) {
      interruptionDetector.reset();
      interruptionDetector = null;
    }
    signalModel = null;
    nudgeEngine = null;
    if (coachingEngine) { coachingEngine.reset(); coachingEngine = null; }
    if (decisionEngine) { decisionEngine.reset(); decisionEngine = null; }
    if (latencyMonitor) { latencyMonitor.reset(); latencyMonitor = null; }
    currentSessionId = null;
    pendingOutcomes = [];
    lastQuestionCount = 0;
    askQuestionPrompt = null;
    pausePrompt = null;
    isActive = false;
    console.log('[Offscreen] Audio capture stopped.');
  }

  // =============================================================
  // FEATURE PIPELINE
  // =============================================================

  function onFeatures(features) {
    if (!signalModel || !nudgeEngine) return;

    // Dual-stream: feed user mic VAD state into interruption detector
    if (interruptionDetector) {
      interruptionDetector.updateUser(features.isSpeech);
    }

    if (latencyMonitor && features._audioTimestamp) {
      latencyMonitor.mark(features._audioTimestamp);
    }

    const signal = signalModel.process(features);

    // Calibration transition is now handled by the coaching engine
    // (which fires a 'welcome' coach event ~3s after calibration completes)
    if (wasCalibrating && !signal.isCalibrating) {
      wasCalibrating = false;
      console.log('[Offscreen] Calibration complete. Coaching engine will welcome shortly.');
    }

    if (!latencyMonitor || latencyMonitor.isHealthy) {
      nudgeEngine.process(signal);
      if (coachingEngine) coachingEngine.process(signal);
      if (decisionEngine) decisionEngine.process(signal);
    }

    // Edge-detect PAUSE compliance: if the user dropped speakingRatio by >0.10
    // from the moment the pill fired, within 20s, count as success.
    if (pausePrompt && signal.speakingRatio !== undefined) {
      const drop = pausePrompt.initialRatio - signal.speakingRatio;
      if (drop >= 0.10) {
        const latencyMs = Date.now() - pausePrompt.firedAt;
        broadcast({
          type: 'pause-success',
          latencyMs,
          initialRatio: pausePrompt.initialRatio,
          currentRatio: signal.speakingRatio,
          timestamp: Date.now(),
        });
        if (pausePrompt.recordId) {
          CueInterventionLog.recordOutcome(pausePrompt.recordId, {
            speakingRatio: signal.speakingRatio,
            questionCount: signal.questionCount || 0,
          }).catch(() => {});
        }
        pausePrompt = null;
      }
    }

    // Edge-detect new question: signal.questionCount increased this tick.
    // Fires an immediate "question detected" event for UI feedback so the
    // user knows Cue heard the prosodic question pattern.
    const qc = signal.questionCount || 0;
    if (qc > lastQuestionCount) {
      lastQuestionCount = qc;
      broadcast({
        type: 'question-detected',
        totalCount: qc,
        timestamp: Date.now(),
        evidence: signal.lastQuestionEvidence || null,
      });

      // If we had an open ASK_QUESTION prompt and the user asked within the
      // response window, announce success and close the prompt.
      if (askQuestionPrompt && Date.now() - askQuestionPrompt.firedAt < 20000) {
        broadcast({
          type: 'ask-question-success',
          latencyMs: Date.now() - askQuestionPrompt.firedAt,
          timestamp: Date.now(),
        });
        // Mark intervention outcome as success immediately (don't wait 30s)
        if (askQuestionPrompt.recordId) {
          CueInterventionLog.recordOutcome(askQuestionPrompt.recordId, {
            speakingRatio: signal.speakingRatio || 0,
            questionCount: qc,
          }).catch(() => {});
        }
        askQuestionPrompt = null;
      }
    }

    // Check any pending outcome measurements
    checkPendingOutcomes(signal);

    // Throttled broadcast to side panel
    const now = Date.now();
    if (now - lastBroadcast >= BROADCAST_MIN_INTERVAL) {
      broadcast({
        type: 'signal',
        tension: Math.round(signal.tension),
        pace: Math.round(signal.pace),
        energy: Math.round(signal.energy),
        isCalibrating: signal.isCalibrating,
        calibrationProgress: signal.calibrationProgress,
        isSpeech: signal.isSpeech,
        continuousSpeechSec: signal.continuousSpeechSec,
        rms: features.rms,
        latency: latencyMonitor ? Math.round(latencyMonitor.latencyMs) : null,
      });
      lastBroadcast = now;
    }
  }

  function onNudge(nudgeEvent) {
    console.log('[Offscreen] Nudge fired:', nudgeEvent.type);
    broadcast({
      type: 'nudge',
      nudgeType: nudgeEvent.type,
      scores: nudgeEvent.scores,
      nudgeNumber: nudgeEvent.nudgeNumber,
      timestamp: nudgeEvent.timestamp,
    });
  }

  async function onDecision(decisionEvent) {
    // Only log and broadcast non-CONTINUE decisions
    if (decisionEvent.decision === 'CONTINUE') return;

    try {
      const recordId = await CueInterventionLog.record(
        currentSessionId,
        decisionEvent.decision,
        decisionEvent.signalState,
        decisionEvent.meta
      );

      // Queue outcome measurement in 30s
      pendingOutcomes.push({
        id: recordId,
        startSnapshot: decisionEvent.signalState,
        measureAt: Date.now() + (CueInterventionLog.OUTCOME_WINDOW_SEC * 1000),
      });

      // If this is ASK_QUESTION, track it so the question-detection edge
      // can announce success immediately when a question is asked.
      if (decisionEvent.decision === 'ASK_QUESTION') {
        askQuestionPrompt = {
          recordId,
          firedAt: Date.now(),
        };
        setTimeout(() => {
          if (askQuestionPrompt && askQuestionPrompt.recordId === recordId) {
            askQuestionPrompt = null;
          }
        }, 20000);
      }

      // If this is PAUSE, track baseline speakingRatio so we can detect
      // compliance when ratio drops by >0.10 within 20s.
      if (decisionEvent.decision === 'PAUSE') {
        pausePrompt = {
          recordId,
          firedAt: Date.now(),
          initialRatio: decisionEvent.signalState.speakingRatio || 0,
        };
        setTimeout(() => {
          if (pausePrompt && pausePrompt.recordId === recordId) {
            pausePrompt = null;
          }
        }, 20000);
      }

      // Mark delivered (fire-and-forget)
      CueInterventionLog.markDelivered(recordId);

      // Broadcast to side panel UI (decision pill + haptic signal)
      broadcast({
        type: 'decision',
        decision: decisionEvent.decision,
        reason: decisionEvent.meta?.reason,
        signalState: decisionEvent.signalState,
        timestamp: decisionEvent.timestamp,
        recordId,
      });
    } catch (e) {
      console.warn('[Offscreen] Decision logging failed:', e);
    }
  }

  function checkPendingOutcomes(currentSignalState) {
    const now = Date.now();
    const ready = pendingOutcomes.filter(p => p.measureAt <= now);
    for (const p of ready) {
      CueInterventionLog.recordOutcome(p.id, {
        speakingRatio: currentSignalState.speakingRatio || 0,
        questionCount: currentSignalState.questionCount || 0,
      }).catch(() => {});
    }
    pendingOutcomes = pendingOutcomes.filter(p => p.measureAt > now);
  }

  function onCoach(coachEvent) {
    // Positive / gentle coaching feedback — goes to the small bubble in the panel,
    // NOT to the big nudge card. Tone field tells the UI how to render it.
    broadcast({
      type: 'coach',
      coachType: coachEvent.type,
      text: coachEvent.text,
      tone: coachEvent.tone, // 'welcome' | 'positive' | 'corrective' | 'listening'
      scores: coachEvent.scores,
      timestamp: coachEvent.timestamp,
      isWelcome: !!coachEvent.isWelcome,
    });
  }

  function broadcast(msg) {
    // Send message to whoever is listening (side panel, service worker)
    chrome.runtime.sendMessage({ target: 'cue-ui', ...msg }).catch(() => {
      // No listeners — that's fine (side panel may be closed)
    });
  }

  // =============================================================
  // DIAGNOSTICS — runs through every possible failure mode
  // and reports the real error
  // =============================================================

  async function runDiagnostics() {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      context: 'offscreen',
      checks: {},
    };

    // Check 1: mediaDevices API presence
    try {
      report.checks.mediaDevicesExists = !!navigator.mediaDevices;
      report.checks.getUserMediaExists = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    } catch (e) {
      report.checks.mediaDevicesExists = false;
      report.checks.mediaDevicesError = e.message;
    }

    // Check 2: enumerate devices (no permission needed to enumerate existence)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      report.checks.audioInputCount = audioInputs.length;
      report.checks.audioInputLabels = audioInputs.map(d => d.label || '(label hidden — no permission)');
    } catch (e) {
      report.checks.enumerateError = e.message;
    }

    // Check 3: permissions.query
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: 'microphone' });
        report.checks.permissionState = p.state;
      }
    } catch (e) {
      report.checks.permissionQueryError = e.message;
    }

    // Check 4: try getUserMedia and capture the error
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      report.checks.getUserMediaSuccess = true;
      // Immediately release so we don't hold the mic
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {
      report.checks.getUserMediaSuccess = false;
      report.checks.getUserMediaError = {
        name: e.name,
        message: e.message,
      };
    }

    // Check 5: AudioContext
    try {
      const ctx = new AudioContext();
      report.checks.audioContextState = ctx.state;
      report.checks.audioContextSampleRate = ctx.sampleRate;
      ctx.close();
    } catch (e) {
      report.checks.audioContextError = e.message;
    }

    return { ok: true, report };
  }

  console.log('[Offscreen] Document ready. Waiting for messages.');
  // Announce we're ready
  chrome.runtime.sendMessage({ target: 'cue-ui', type: 'offscreen-ready' }).catch(() => {});

})();
