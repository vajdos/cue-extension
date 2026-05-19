/**
 * Cue — Side Panel (Always-On)
 *
 * Runs the full Cue pipeline in a Chrome side panel context.
 * Captures mic continuously when user clicks Start.
 * Delivers nudges as both in-panel visual cards AND system notifications
 * (so they're visible even when the user is on another tab).
 */

(function () {
  'use strict';

  // =============================================================
  // STATE
  // =============================================================

  // Audio capture now runs in the offscreen document. Panel only handles UI.
  let isActive = false;
  let currentSource = 'mic';      // 'mic' or 'tab'
  let currentProfile = 'default'; // key into CUE_THRESHOLDS.PROFILES
  let sessionStartTime = null;
  let sessionClockInterval = null;
  let nudgePack = 'gentle';
  let nudgeChannels = ['visual', 'notification'];

  // Running stats for session summary
  let paceSum = 0, tensionSum = 0, frameCount = 0;

  // =============================================================
  // DOM
  // =============================================================

  const el = {
    logo: document.getElementById('p-logo'),
    statusSection: document.querySelector('.p-status'),
    statusDot: document.getElementById('p-status-dot'),
    statusText: document.getElementById('p-status-text'),
    startBtn: document.getElementById('p-start-btn'),
    sessionClock: document.getElementById('p-session-clock'),
    tensionBar: document.getElementById('p-tension-bar'),
    paceBar: document.getElementById('p-pace-bar'),
    energyBar: document.getElementById('p-energy-bar'),
    pauseBar: document.getElementById('p-pause-bar'),
    tensionValue: document.getElementById('p-tension-value'),
    paceValue: document.getElementById('p-pace-value'),
    energyValue: document.getElementById('p-energy-value'),
    pauseValue: document.getElementById('p-pause-value'),
    tensionHint: document.getElementById('p-tension-hint'),
    paceHint: document.getElementById('p-pace-hint'),
    energyHint: document.getElementById('p-energy-hint'),
    pauseHint: document.getElementById('p-pause-hint'),
    cueSays: document.getElementById('p-cue-says'),
    nudgeCard: document.getElementById('p-nudge-card'),
    nudgeType: document.getElementById('p-nudge-type'),
    nudgeText: document.getElementById('p-nudge-text'),
    stats: document.getElementById('p-stats'),
    statNudges: document.getElementById('p-stat-nudges'),
    statAvgPace: document.getElementById('p-stat-avg-pace'),
    statAvgTension: document.getElementById('p-stat-avg-tension'),
    version: document.getElementById('p-version'),
    settingsBtn: document.getElementById('p-settings-btn'),
    progressBtn: document.getElementById('p-progress-btn'),
    verifyBtn: document.getElementById('p-verify-btn'),
  };

  // =============================================================
  // INITIALIZATION
  // =============================================================

  async function init() {
    // Version
    const manifest = chrome.runtime.getManifest();
    el.version.textContent = 'v' + manifest.version;

    // v1.1.16 — First-run magic-moment onboarding. Fires ONCE on first
    // panel open. Three short cards build intuition before the user even
    // hits Start, so the value reveals in <60 seconds without setup
    // friction. Wispr Flow's first-run is "polished text in 3 seconds";
    // ours is "see how Cue measures listening, before you ever speak".
    try { await maybeShowFirstRunOnboarding(); } catch (e) {}

    // Load settings + Pro state
    try {
      // v1.1.3 — also load cueName so we can personalize Cue Says + nudges
      const stored = await chrome.storage.local.get(['cueSettings', 'cuePro', 'cueName']);
      if (stored.cueName && typeof stored.cueName === 'string' && stored.cueName.trim()) {
        _userName = stored.cueName.trim().split(/\s+/)[0];  // first name only
      }
      if (stored.cueSettings) {
        nudgePack = stored.cueSettings.nudgePack || 'gentle';
        nudgeChannels = stored.cueSettings.nudgeChannels || ['visual', 'notification'];
      }
      // Pro state controls which section shows
      const proSection = document.getElementById('p-pro');
      const proActive = document.getElementById('p-pro-active');
      if (stored.cuePro === true) {
        if (proSection) proSection.style.display = 'none';
        if (proActive) proActive.style.display = 'flex';
      } else {
        if (proSection) proSection.style.display = 'block';
        if (proActive) proActive.style.display = 'none';
      }
    } catch (e) { /* default */ }

    // Wire buttons
    el.startBtn.addEventListener('click', toggle);

    // Source picker (Me / Them)
    const srcMe = document.getElementById('p-source-me');
    const srcThem = document.getElementById('p-source-them');
    const srcBoth = document.getElementById('p-source-both');
    const srcHint = document.getElementById('p-source-hint');
    function selectSource(source) {
      currentSource = source;
      if (srcMe) srcMe.classList.toggle('active', source === 'mic');
      if (srcThem) srcThem.classList.toggle('active', source === 'tab');
      if (srcBoth) srcBoth.classList.toggle('active', source === 'both');
      if (srcHint) srcHint.style.display = (source === 'tab' || source === 'both') ? 'block' : 'none';
      const labels = { mic: 'Start Listening', tab: 'Start Listening (Them)', both: 'Start Listening (Both)' };
      el.startBtn.textContent = labels[source] || 'Start Listening';
    }
    if (srcMe) srcMe.addEventListener('click', () => selectSource('mic'));
    if (srcThem) srcThem.addEventListener('click', () => selectSource('tab'));
    if (srcBoth) srcBoth.addEventListener('click', () => selectSource('both'));

    // Profile picker
    const profSel = document.getElementById('p-profile-select');
    if (profSel) {
      profSel.addEventListener('change', (e) => {
        currentProfile = e.target.value || 'default';
      });
    }

    // Pro progressive disclosure
    const proSee = document.getElementById('p-pro-see');
    const proClose = document.getElementById('p-pro-close');
    const proCollapsed = document.getElementById('p-pro-collapsed');
    const proExpanded = document.getElementById('p-pro-expanded');
    if (proSee && proExpanded && proCollapsed) {
      proSee.addEventListener('click', () => {
        proCollapsed.style.display = 'none';
        proExpanded.style.display = 'block';
      });
    }
    if (proClose && proExpanded && proCollapsed) {
      proClose.addEventListener('click', () => {
        proExpanded.style.display = 'none';
        proCollapsed.style.display = 'flex';
      });
    }
    el.settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/settings/settings.html') });
    });
    el.progressBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('tape/progress.html') });
    });
    el.verifyBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('verify/verify.html') });
    });

    // Check mic permission state proactively
    await checkMicPermission();

    console.log('[Cue Panel] Ready. Click Start to begin listening.');
  }

  async function checkMicPermission() {
    // Extension contexts sometimes return "denied" from permissions.query
    // even when nothing is actually blocked, because extension origins default
    // that way. We only LOG here — we do NOT show the error UI proactively.
    // The real signal is whether getUserMedia rejects when Start is clicked.
    try {
      if (!navigator.permissions || !navigator.permissions.query) return;
      const perm = await navigator.permissions.query({ name: 'microphone' });
      console.log('[Cue Panel] Mic permission state (informational):', perm.state);
      perm.onchange = () => {
        console.log('[Cue Panel] Mic permission changed to:', perm.state);
        if (perm.state === 'granted') clearMicFixHelp();
      };
    } catch (e) {
      console.log('[Cue Panel] permission.query unavailable:', e.message);
    }
  }

  // =============================================================
  // TOGGLE START/STOP
  // =============================================================

  async function toggle() {
    if (isActive) {
      await stop();
    } else {
      await start();
    }
  }

  async function start() {
    try {
      clearMicFixHelp();
      clearSessionSummary();
      // Reset counters for the new session
      paceSum = 0; tensionSum = 0; frameCount = 0; nudgeCountUI = 0;
      totalQuestionsDetected = 0;
      el.statNudges.textContent = '0';
      el.statAvgPace.textContent = '—';
      el.statAvgTension.textContent = '—';
      setStatus('Starting mic (offscreen)...', 'calibrating');
      el.startBtn.disabled = true;

      // Load settings first (we're already past the click, gesture doesn't matter
      // since we delegate getUserMedia to the offscreen document).
      const stored = await chrome.storage.local.get(['cueSettings', 'cuePro', 'cueSessionCount']);
      if (stored.cueSettings) {
        nudgePack = stored.cueSettings.nudgePack || 'gentle';
        nudgeChannels = stored.cueSettings.nudgeChannels || ['visual', 'notification'];
        _toneFlavor = stored.cueSettings.toneFlavor || 'neutral';   // v1.1.7
      }
      const isPro = stored.cuePro === true;
      const sessionCount = stored.cueSessionCount || 0;
      const effectivePro = isPro || sessionCount < 3;

      // v1.1.8 — session counter pill (loss-aversion conversion driver)
      // Mirrors Wispr's word-counter hook: visible progress toward a cap.
      // Free trial: shows "X of 3 free Pro sessions". Trial done: shows urgency.
      // Pro: hides entirely.
      const counterEl = document.getElementById('p-session-counter');
      if (counterEl) {
        if (isPro) {
          counterEl.style.display = 'none';
        } else if (sessionCount < 3) {
          const remaining = 3 - sessionCount;
          counterEl.textContent = `Free trial · ${remaining} of 3 Pro sessions left`;
          counterEl.style.display = '';
          counterEl.style.color = '#248A3D';
        } else {
          counterEl.textContent = `Trial complete · lock in $69/yr to keep your replicant`;
          counterEl.style.display = '';
          counterEl.style.color = '#E94560';
          counterEl.style.fontWeight = '600';
        }
      }

      // Read coaching intensity (default: gentle)
      const coachingIntensity = (stored.cueSettings && stored.cueSettings.coachingIntensity) || 'gentle';

      // Apply conversation profile BEFORE offscreen start so its thresholds get picked up
      const profile = CUE_THRESHOLDS.PROFILES?.[currentProfile] || CUE_THRESHOLDS.PROFILES?.default;
      if (profile) {
        CUE_THRESHOLDS.PACE_THRESHOLD = profile.pace;
        CUE_THRESHOLDS.TENSION_THRESHOLD = profile.tension;
        CUE_THRESHOLDS.LONG_SPEECH_SEC = profile.longSpeech;
        CUE_THRESHOLDS.COOLDOWN_SEC = profile.cooldown;
        nudgePack = profile.nudgePack || nudgePack;
        console.log('[Cue Panel] Profile applied:', currentProfile, profile);
      }

      // Delegate to service worker which manages the offscreen document
      const result = await chrome.runtime.sendMessage({
        type: 'cue-start-audio',
        options: {
          isPro: effectivePro,
          coachingIntensity,
          source: currentSource,
          profile: currentProfile,
          // Mirror the threshold overrides so the offscreen doc picks them up
          profileOverrides: profile ? {
            pace: profile.pace,
            tension: profile.tension,
            longSpeech: profile.longSpeech,
            cooldown: profile.cooldown,
          } : null,
        }
      });

      if (!result || !result.ok) {
        const errName = (result && result.errorName) || 'UnknownError';
        const errMsg = (result && result.error) || 'no response from service worker';
        console.error('[Cue Panel] Offscreen start failed:', errName, errMsg);
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          showMicFixHelp();
        } else if (errName === 'NotFoundError' || errName === 'OverconstrainedError') {
          setStatus('No microphone detected. Check Windows Sound settings → Input.', 'error');
        } else if (errName === 'NotReadableError') {
          setStatus('Mic is in use by another app. Close Zoom/Teams/other mic apps.', 'error');
        } else {
          setStatus(`Start failed — ${errName}: ${errMsg.slice(0,60)}`, 'error');
          showDiagnosticOffer(errName + ': ' + errMsg);
        }
        el.startBtn.textContent = 'Start Listening';
        el.startBtn.classList.remove('stop');
        el.startBtn.disabled = false;
        return;
      }

      console.log('[Cue Panel] Offscreen audio started successfully.');

      isActive = true;
      sessionStartTime = Date.now();
      paceSum = 0; tensionSum = 0; frameCount = 0;

      el.startBtn.textContent = 'Stop Listening';
      el.startBtn.classList.add('stop');
      el.startBtn.disabled = false;
      el.logo.classList.add('live');
      el.stats.style.display = 'block';

      // v1.1.35 — Tier 1 mic meter visible while session is active.
      const t1 = document.getElementById('p-mic-meter-tier1');
      if (t1) t1.style.display = 'block';

      setStatus('Calibrating...', 'calibrating');

      // Start session clock
      if (sessionClockInterval) clearInterval(sessionClockInterval);
      sessionClockInterval = setInterval(updateSessionClock, 1000);

      // Notify service worker so it can mark the badge
      try {
        chrome.runtime.sendMessage({ type: 'panelSessionStart' }).catch(() => {});
      } catch (e) {}

      console.log('[Cue Panel] Session started.');
      // v1.1.14 — Wispr-style audio confirmation on session start. Brief
      // ascending two-note tone (G4 → C5, ~250ms total). Confirms Cue is
      // listening WITHOUT requiring the user to look at the panel or wait
      // for the OS notification. Mirrors Wispr Flow's startup chime.
      playStartTone();
    } catch (err) {
      console.error('[Cue Panel] Start failed (unexpected):', err);
      setStatus('Start failed: ' + err.message, 'error');
      showDiagnosticOffer(err.message);
      el.startBtn.textContent = 'Start Listening';
      el.startBtn.classList.remove('stop');
      el.startBtn.disabled = false;
    }
  }

  // =============================================================
  // DIAGNOSTIC OFFER (shown when errors occur)
  // =============================================================

  function showDiagnosticOffer(contextLabel) {
    const existing = document.getElementById('p-diag-btn');
    if (existing) return;
    const btn = document.createElement('button');
    btn.id = 'p-diag-btn';
    btn.className = 'p-btn';
    btn.style.cssText = 'margin-top:8px;background:#1D1D1F;color:#FFF;';
    btn.textContent = 'Run Diagnostics';
    btn.addEventListener('click', runAndShowDiagnostics);
    el.startBtn.parentElement.appendChild(btn);
  }

  async function runAndShowDiagnostics() {
    setStatus('Running diagnostics...', 'calibrating');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'cue-diagnostics' });
      console.log('[Cue Panel] Diagnostics result:', result);
      if (!result || !result.ok) {
        setStatus('Diagnostics failed: ' + (result?.error || 'no response'), 'error');
        return;
      }
      showDiagnosticsReport(result.report);
    } catch (e) {
      setStatus('Diagnostics error: ' + e.message, 'error');
    }
  }

  function showDiagnosticsReport(report) {
    const existing = document.getElementById('p-diag-report');
    if (existing) existing.remove();

    const box = document.createElement('div');
    box.id = 'p-diag-report';
    box.style.cssText = 'margin-top:14px;padding:14px;background:#FFF;border:1px solid rgba(0,0,0,.1);border-radius:10px;font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;max-height:380px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;';

    const c = report.checks || {};
    const lines = [];
    lines.push('CUE DIAGNOSTICS  ' + report.timestamp);
    lines.push('');
    lines.push('Chrome: ' + (report.userAgent || '?').match(/Chrome\/[\d.]+/)?.[0]);
    lines.push('Context: ' + (report.context || '?'));
    lines.push('');
    lines.push('--- API AVAILABILITY ---');
    lines.push('mediaDevices:      ' + (c.mediaDevicesExists ? 'YES' : 'NO'));
    lines.push('getUserMedia:      ' + (c.getUserMediaExists ? 'YES' : 'NO'));
    lines.push('');
    lines.push('--- DEVICES ---');
    lines.push('audio inputs:      ' + (c.audioInputCount ?? '?'));
    if (c.audioInputLabels) {
      c.audioInputLabels.forEach((l, i) => lines.push('  [' + i + '] ' + l));
    }
    lines.push('');
    lines.push('--- PERMISSIONS ---');
    lines.push('state:             ' + (c.permissionState || '?'));
    lines.push('');
    lines.push('--- GETUSERMEDIA ---');
    lines.push('success:           ' + (c.getUserMediaSuccess ? 'YES' : 'NO'));
    if (c.getUserMediaError) {
      lines.push('error name:        ' + c.getUserMediaError.name);
      lines.push('error message:     ' + c.getUserMediaError.message);
    }
    lines.push('');
    lines.push('--- AUDIOCONTEXT ---');
    lines.push('state:             ' + (c.audioContextState || '?'));
    lines.push('sample rate:       ' + (c.audioContextSampleRate || '?'));

    box.textContent = lines.join('\n');
    el.startBtn.parentElement.appendChild(box);

    // Also offer to copy the report
    const copy = document.createElement('button');
    copy.className = 'p-btn';
    copy.style.cssText = 'margin-top:8px;background:#F5F5F7;color:#1D1D1F;';
    copy.textContent = 'Copy diagnostic report';
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
        copy.textContent = 'Copied!';
        setTimeout(() => { copy.textContent = 'Copy diagnostic report'; }, 2000);
      });
    });
    el.startBtn.parentElement.appendChild(copy);

    setStatus('Diagnostics complete — see report below.', '');
  }

  function showMicFixHelp() {
    setStatus('Mic access denied — click Fix to open Chrome settings', 'error');

    // Replace the Start button with a Fix button until user dismisses
    const existingFix = document.getElementById('p-fix-mic');
    if (existingFix) return;

    const fix = document.createElement('button');
    fix.id = 'p-fix-mic';
    fix.className = 'p-btn';
    fix.style.cssText = 'margin-top:8px;background:#3B82F6;color:#FFF;';
    fix.textContent = 'Open Chrome mic settings';
    fix.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://settings/content/microphone' });
    });
    el.startBtn.parentElement.appendChild(fix);

    const win = document.createElement('button');
    win.id = 'p-fix-win';
    win.className = 'p-btn';
    win.style.cssText = 'margin-top:8px;background:#F5F5F7;color:#1D1D1F;';
    win.textContent = 'Or open Windows mic settings';
    win.addEventListener('click', () => {
      // Opens Windows privacy mic settings via the ms-settings URI
      chrome.tabs.create({ url: 'ms-settings:privacy-microphone' });
    });
    el.startBtn.parentElement.appendChild(win);

    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:11px;color:rgba(29,29,31,.55);margin-top:10px;line-height:1.5;';
    hint.innerHTML = 'After granting permission in either settings page, come back and click <strong>Start Listening</strong>.';
    el.startBtn.parentElement.appendChild(hint);
  }

  function clearMicFixHelp() {
    ['p-fix-mic', 'p-fix-win'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    const hints = document.querySelectorAll('.p-control p');
    hints.forEach(h => h.remove());
  }

  async function stop() {
    try {
      await chrome.runtime.sendMessage({ type: 'cue-stop-audio' });
    } catch (e) {
      console.warn('[Cue Panel] stop message failed:', e);
    }

    if (sessionClockInterval) {
      clearInterval(sessionClockInterval);
      sessionClockInterval = null;
    }

    // Capture final stats BEFORE resetting
    const finalDurationMs = sessionStartTime ? (Date.now() - sessionStartTime) : 0;
    const finalMin = Math.floor(finalDurationMs / 60000);
    const finalSec = Math.floor((finalDurationMs % 60000) / 1000);
    const finalNudges = nudgeCountUI;
    const finalAvgPace = frameCount > 0 ? Math.round(paceSum / frameCount) : null;
    const finalAvgTension = frameCount > 0 ? Math.round(tensionSum / frameCount) : null;

    isActive = false;
    sessionStartTime = null;

    el.startBtn.textContent = 'Start Listening';
    el.startBtn.classList.remove('stop');
    el.logo.classList.remove('live');

    // v1.1.35 — hide Tier 1 mic meter when session ends.
    const t1 = document.getElementById('p-mic-meter-tier1');
    if (t1) t1.style.display = 'none';

    // Freeze the session clock on the final duration (don't reset to —)
    el.sessionClock.textContent = `${String(finalMin).padStart(2,'0')}:${String(finalSec).padStart(2,'0')}`;

    // Reset live bars — but keep stats visible with final numbers
    el.tensionBar.style.width = '0%';
    el.paceBar.style.width = '0%';
    el.energyBar.style.width = '0%';
    el.tensionValue.textContent = '—';
    el.paceValue.textContent = '—';
    el.energyValue.textContent = '—';
    if (el.pauseBar)   el.pauseBar.style.width = '0%';
    if (el.pauseValue) el.pauseValue.textContent = '—';
    if (el.tensionHint) el.tensionHint.textContent = '';
    if (el.paceHint)    el.paceHint.textContent = '';
    if (el.energyHint)  el.energyHint.textContent = '';
    if (el.pauseHint)   el.pauseHint.textContent = '';
    // v1.1.10 — write blank space, don't toggle display (avoids sidebar reflow)
    const _cueSaysTextEl = document.getElementById('p-cue-says-text');
    if (_cueSaysTextEl) _cueSaysTextEl.textContent = ' ';
    _pauseScore = 50;
    _lastSpeechAt = 0;
    _lastCueSaysUpdate = 0;

    // Show session-complete summary in the status row
    hideNudge();
    showSessionSummary(finalDurationMs, finalNudges, finalAvgPace, finalAvgTension);

    // Keep stat display showing the final values (do NOT zero nudgeCountUI
    // until the user starts a NEW session — handled in start()).

    try {
      chrome.runtime.sendMessage({ type: 'panelSessionEnd' }).catch(() => {});
    } catch (e) {}

    // Persist session summary + recompute adaptation (for "continuously improving")
    persistSessionAndAdapt({
      id: 'sess-' + Date.now(),
      endTime: new Date().toISOString(),
      durationMs: finalDurationMs,
      nudgeCount: finalNudges,
      avgPace: finalAvgPace,
      avgTension: finalAvgTension,
      timestamp: Date.now(),
      profile: currentProfile,
      source: currentSource,
    }).catch(() => {});

    console.log('[Cue Panel] Session stopped.');
  }

  async function persistSessionAndAdapt(summary) {
    try {
      const stored = await chrome.storage.local.get(['cueSessionHistory', 'cueSettings']);
      const history = Array.isArray(stored.cueSessionHistory) ? stored.cueSessionHistory : [];
      history.push(summary);
      if (history.length > 20) history.splice(0, history.length - 20);

      // v1.1.8 — POSITIVE FEEDBACK LOOP — celebrate wins via system notification.
      // Triggers on: (a) lower nudge count than user's median, (b) longest streak day yet,
      // (c) first-ever session. Stays silent on bad sessions to avoid shaming.
      try {
        const sessionsSoFar = history.length;
        const pastNudges = history.slice(0, -1).map(s => s.nudgeCount || 0);
        const median = pastNudges.length
          ? pastNudges.slice().sort((a,b) => a-b)[Math.floor(pastNudges.length / 2)]
          : null;
        let celebrate = null;
        if (sessionsSoFar === 1) {
          celebrate = { title: 'Cue ran your first session', msg: 'Your replicant has begun training. Run a few more for it to converge on your norms.' };
        } else if (median !== null && (summary.nudgeCount || 0) < median * 0.7) {
          celebrate = { title: 'Strong call', msg: `Fewer nudges than your typical (${summary.nudgeCount} vs your norm of ${median}). Replicant is recognizing your patterns.` };
        } else if (sessionsSoFar > 0 && sessionsSoFar % 10 === 0) {
          celebrate = { title: `${sessionsSoFar} sessions with Cue`, msg: `Your replicant is fully calibrated to you. Cue is yours.` };
        }
        if (celebrate && chrome.notifications && chrome.notifications.create) {
          chrome.notifications.create('cue-win-' + Date.now(), {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
            title: celebrate.title,
            message: celebrate.msg,
            priority: 1,
            silent: false,
          }).catch(() => {});
        }
      } catch (e) { /* never block session save on celebration */ }

      let adaptation = { paceDelta: 0, tensionDelta: 0, longSpeechDelta: 0, reason: 'engine not loaded' };
      if (typeof CueAdaptationEngine === 'function') {
        const engine = new CueAdaptationEngine();
        adaptation = engine.computeAdjustment(history, {
          pace: CUE_THRESHOLDS.PACE_THRESHOLD || 65,
          tension: CUE_THRESHOLDS.TENSION_THRESHOLD || 70,
          longSpeech: CUE_THRESHOLDS.LONG_SPEECH_SEC || 30,
        });
      }

      const adaptationEnabled = stored.cueSettings?.adaptationEnabled !== false;
      await chrome.storage.local.set({
        cueSessionHistory: history,
        cueAdaptation: adaptationEnabled ? adaptation : { paceDelta: 0, tensionDelta: 0, longSpeechDelta: 0, reason: 'disabled' },
      });
      console.log('[Cue Panel] Session persisted. Adaptation:', adaptation);
    } catch (e) {
      console.warn('[Cue Panel] Session persistence failed:', e);
    }
  }

  // =============================================================
  // MESSAGES FROM OFFSCREEN DOCUMENT
  // =============================================================

  chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== 'cue-ui') return;

    if (message.type === 'signal') {
      handleSignalUpdate(message);
    } else if (message.type === 'nudge') {
      handleNudgeFromOffscreen(message);
    } else if (message.type === 'coach') {
      handleCoachFromOffscreen(message);
    } else if (message.type === 'decision') {
      handleDecisionFromOffscreen(message);
    } else if (message.type === 'question-detected') {
      handleQuestionDetected(message);
    } else if (message.type === 'ask-question-success') {
      handleAskQuestionSuccess(message);
    } else if (message.type === 'pause-success') {
      handlePauseSuccess(message);
    } else if (message.type === 'interruption-detected') {
      handleInterruptionDetected(message);
    } else if (message.type === 'latency-health') {
      if (!message.healthy) {
        setStatus('Lag detected — nudges paused', 'error');
      }
    } else if (message.type === 'offscreen-ready') {
      console.log('[Cue Panel] Offscreen document ready.');
    } else if (message.type === 'calibration-complete') {
      flashCalibrationComplete();
    } else if (message.type === 'hotkey-toggle-session') {
      // v1.1.4 — Alt+Shift+C global hotkey. Toggles session start/stop without
      // requiring the user to find the side panel button.
      console.log('[Cue Panel] Hotkey toggle received. isActive =', isActive);
      if (isActive) {
        try { stop(); } catch (e) { console.warn('[Cue Panel] hotkey stop failed:', e); }
      } else {
        try { start(); } catch (e) { console.warn('[Cue Panel] hotkey start failed:', e); }
      }
    } else if (message.type === 'cue-debug') {
      // v1.1.0 REPLICANT — bubble offscreen-context debug logs into the side
      // panel console so we can diagnose without opening offscreen DevTools.
      console.log('[Cue Debug ←', message.from + ']', message.event, '| state:', {
        sessionCount: message.sessionCount,
        isPopulationDefault: message.isPopulationDefault,
        calibrationCompleted: message.calibrationCompleted,
        speechTimeSec: message.speechTimeSec,
        calSamplesCount: message.calSamplesCount,
      });
    }
  });

  // =============================================================
  // COACHING BUBBLE — small, non-interrupting positive / gentle feedback
  // =============================================================

  function handleCoachFromOffscreen(msg) {
    console.log('[Cue Panel] Coach:', msg.tone, msg.text);

    if (msg.isWelcome) {
      // Keep using the existing full-width welcome banner for this one-shot moment
      flashWelcomeBanner(msg.text);
      return;
    }

    showCoachBubble(msg.text, msg.tone);
  }

  function flashWelcomeBanner(text) {
    const existing = document.getElementById('p-cal-complete');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'p-cal-complete';
    banner.style.cssText = 'background:linear-gradient(90deg,#2DD4A0,#1AA37D);color:#FFFFFF;border-radius:12px;padding:14px 18px;margin-bottom:14px;text-align:center;font-size:15px;font-weight:600;letter-spacing:.3px;box-shadow:0 4px 20px rgba(45,212,160,.3);animation:calComplete 2.5s ease forwards;';
    banner.textContent = text;

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(banner, signalsSection);
    }

    if (!document.getElementById('p-cal-style')) {
      const style = document.createElement('style');
      style.id = 'p-cal-style';
      style.textContent = '@keyframes calComplete { 0% { opacity:0; transform:translateY(-8px) scale(0.95); } 15% { opacity:1; transform:translateY(0) scale(1); } 85% { opacity:1; transform:translateY(0) scale(1); } 100% { opacity:0; transform:translateY(-4px) scale(0.98); } }';
      document.head.appendChild(style);
    }

    setTimeout(() => { if (banner.parentElement) banner.remove(); }, 2600);
  }

  let coachBubbleTimer = null;

  function showCoachBubble(text, tone) {
    const existing = document.getElementById('p-coach-bubble');
    if (existing) existing.remove();
    if (coachBubbleTimer) clearTimeout(coachBubbleTimer);

    const toneStyles = {
      positive:   { bg: 'rgba(45,212,160,.12)', border: 'rgba(45,212,160,.35)', ink: '#0F9D6F', icon: '\u2713' },
      corrective: { bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.35)', ink: '#B45309', icon: '\u21E7' },
      listening:  { bg: 'rgba(99,102,241,.10)', border: 'rgba(99,102,241,.30)', ink: '#4338CA', icon: '\u25CF' },
      welcome:    { bg: 'rgba(45,212,160,.12)', border: 'rgba(45,212,160,.35)', ink: '#0F9D6F', icon: '\u2713' },
    };
    const s = toneStyles[tone] || toneStyles.positive;

    const bubble = document.createElement('div');
    bubble.id = 'p-coach-bubble';
    bubble.style.cssText = `background:${s.bg};border:1px solid ${s.border};color:${s.ink};border-radius:100px;padding:8px 16px 8px 32px;margin-bottom:10px;font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:8px;position:relative;animation:coachBubble 3s ease forwards;`;
    bubble.innerHTML = `<span style="position:absolute;left:12px;font-size:11px;">${s.icon}</span>${text}`;

    // Insert above the signals section (but under the welcome banner slot)
    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(bubble, signalsSection);
    }

    if (!document.getElementById('p-coach-style')) {
      const style = document.createElement('style');
      style.id = 'p-coach-style';
      style.textContent = '@keyframes coachBubble { 0% { opacity:0; transform:translateX(-8px); } 12% { opacity:1; transform:translateX(0); } 88% { opacity:1; transform:translateX(0); } 100% { opacity:0; transform:translateX(-4px); } }';
      document.head.appendChild(style);
    }

    coachBubbleTimer = setTimeout(() => {
      if (bubble.parentElement) bubble.remove();
    }, 3100);
  }

  function flashCalibrationComplete() {
    console.log('[Cue Panel] Calibration complete — flashing banner.');

    // Full-width flash card above the signals
    const existing = document.getElementById('p-cal-complete');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'p-cal-complete';
    banner.style.cssText = 'background:linear-gradient(90deg,#2DD4A0,#1AA37D);color:#FFFFFF;border-radius:12px;padding:14px 18px;margin-bottom:14px;text-align:center;font-size:15px;font-weight:600;letter-spacing:.3px;box-shadow:0 4px 20px rgba(45,212,160,.3);animation:calComplete 2.5s ease forwards;';
    banner.textContent = 'You\u2019re calibrated \u2014 Cue is active';

    // Injection point: above the signals section
    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(banner, signalsSection);
    }

    // Also inject the animation keyframes if not already present
    if (!document.getElementById('p-cal-style')) {
      const style = document.createElement('style');
      style.id = 'p-cal-style';
      style.textContent = '@keyframes calComplete { 0% { opacity:0; transform:translateY(-8px) scale(0.95); } 15% { opacity:1; transform:translateY(0) scale(1); } 85% { opacity:1; transform:translateY(0) scale(1); } 100% { opacity:0; transform:translateY(-4px) scale(0.98); } }';
      document.head.appendChild(style);
    }

    // Remove after animation
    setTimeout(() => { if (banner.parentElement) banner.remove(); }, 2600);
  }

  function handleSignalUpdate(s) {
    // Auto-sync: if signals are arriving, the offscreen doc is running.
    // Even if this panel instance never clicked Start (e.g., user reopened
    // the panel while a previous session was still active), treat the panel
    // as active so bars + status update. Prevents the "observer only" state
    // where the old panel is dead but a new panel silently ignores signals.
    if (!isActive) {
      console.log('[Cue Panel] Signal received while inactive — auto-syncing UI to running session.');
      isActive = true;
      sessionStartTime = Date.now() - 5000; // approximate — we don't know actual start
      el.startBtn.textContent = 'Stop Listening';
      el.startBtn.classList.add('stop');
      el.logo.classList.add('live');
      el.stats.style.display = 'block';
      if (!sessionClockInterval) {
        sessionClockInterval = setInterval(updateSessionClock, 1000);
      }
    }

    // Track stats
    if (!s.isCalibrating && s.isSpeech) {
      frameCount++;
      paceSum += s.pace;
      tensionSum += s.tension;
    }

    // v1.1.35 — Drive Tier 1 mic meter (mirrored from cue-desktop v1.0.5).
    // Raw RMS in log scale so quiet speech still visibly fills the bar.
    try {
      const rms = (s.rms !== undefined) ? s.rms : 0;
      const pct = Math.max(0, Math.min(100, Math.round(60 * Math.log10(1 + rms * 200))));
      const t1Fill  = document.getElementById('p-mic-tier1-fill');
      const t1Label = document.getElementById('p-mic-tier1-label');
      const t1Pct   = document.getElementById('p-mic-tier1-pct');
      if (t1Fill) {
        t1Fill.style.width = pct + '%';
        if (t1Pct) t1Pct.textContent = pct + '%';
        if (t1Label) {
          if (s.isSpeech) {
            t1Label.textContent = 'Cue hears you';
            t1Label.style.color = '#1D1D1F';
          } else {
            t1Label.textContent = 'Listening for your voice…';
            t1Label.style.color = 'rgba(29,29,31,0.55)';
          }
        }
      }
    } catch (e) {}

    // v1.1.16 — POSITIVE pause recognition. The trust loop: when the user
    // holds a >= 6s silence AFTER having spoken for >= 5s continuously, fire
    // a positive cue. Stivers 2009 PNAS finds the natural turn-gap is ~250ms
    // — anything >2s reads as "I'm letting you in" to the other party. We
    // wait for 6s to be sure it's a real "give them space" moment, not a
    // mid-sentence breath.
    trackPositivePause(s);

    requestAnimationFrame(() => {
      updateBars(s.tension, s.pace, s.energy, s);
      // Status depending on calibration/speech state
      if (s.isCalibrating) {
        const pct = Math.round(s.calibrationProgress * 100);
        // If calibration stuck at 0% for 8+ seconds, the VAD isn't detecting
        // speech. Surface a hint so the user knows why.
        if (pct === 0 && (s.sessionAgeSec || 0) > 8) {
          setStatus('Speak up — mic not detecting voice', 'error');
        } else if (s.adaptiveVadActive) {
          setStatus(`Calibrating... ${pct}% (sensitive mode)`, 'calibrating');
        } else {
          setStatus(`Calibrating... ${pct}%`, 'calibrating');
        }
      } else if (s.isSpeech) {
        setStatus('Listening — you\'re speaking', 'listening');
      } else {
        setStatus('Listening — quiet', 'ready');
      }
      updateStats();
    });
  }

  async function handleNudgeFromOffscreen(msg) {
    console.log('[Cue Panel] Nudge from offscreen:', msg.nudgeType);
    nudgeCountUI++;
    updateStats();

    // v1.1.7 — resolve via cueResolveNudgeText so the playful pack's nested
    // flavor sub-objects work (yiddish/southern/british_dry). Falls back to
    // direct lookup if the helper isn't loaded.
    let text;
    try {
      const flavor = (typeof _toneFlavor !== 'undefined' && _toneFlavor) || 'neutral';
      if (typeof cueResolveNudgeText === 'function') {
        text = cueResolveNudgeText(nudgePack, msg.nudgeType, flavor);
      } else {
        const pack = CUE_THRESHOLDS.NUDGE_PACKS[nudgePack];
        text = pack && pack[msg.nudgeType];
      }
    } catch (e) {
      text = CUE_THRESHOLDS.NUDGE_PACKS[nudgePack] && CUE_THRESHOLDS.NUDGE_PACKS[nudgePack][msg.nudgeType];
    }

    // v1.1.7 — opt-in vernacular substitution (Pro feature). If user has
    // enabled vernacular learning, this swaps generic text for their actual
    // vocabulary patterns where confident.
    if (typeof CueVernacularEngine !== 'undefined' && CueVernacularEngine.substituteWithVernacular && text) {
      try {
        text = await CueVernacularEngine.substituteWithVernacular(text);
      } catch (e) {}
    }

    // v1.1.7 — personalize with first name on direct/warm/playful packs
    if (text && _userName && (nudgePack === 'direct' || nudgePack === 'warm' || nudgePack === 'playful')) {
      // Only prepend name 30% of the time — always feels too personal
      if (Math.random() < 0.3) text = `${_userName}, ${text.charAt(0).toLowerCase() + text.slice(1)}`;
    }

    if (nudgeChannels.includes('visual') && text) {
      showNudgeCard(msg.nudgeType, text);
    }
    if (nudgeChannels.includes('notification')) {
      showSystemNotification(msg.nudgeType, text);
    }

    // Relay to service worker for cross-device push
    try {
      chrome.runtime.sendMessage({
        type: 'nudgeFired',
        nudgeType: msg.nudgeType,
        text: text || msg.nudgeType,
        scores: msg.scores,
        nudgeNumber: msg.nudgeNumber,
        timestamp: msg.timestamp
      }).catch(() => {});
    } catch (e) {}

    // v1.1.15 — Apple Watch haptic via Web Push.
    // The PWA at /api/test-haptic sends an aes128gcm Web Push to every
    // device the user has subscribed (iPhone PWA → Apple Watch via
    // notification mirroring). We fire on the nudges that matter most
    // for the trust thesis — long_speech, escalation, pace — so the
    // Watch taps the user even when they're presenting full-screen.
    try { fireWatchHaptic(msg.nudgeType); } catch (e) {}
  }

  // v1.1.16 — POSITIVE pause recognition. State for the listening-reward loop.
  let _hadEnoughSpeech = false;        // user spoke ≥5s continuously at some point
  let _silenceStreakStart = 0;         // timestamp first silent frame after speech
  let _lastPositivePauseAt = 0;        // dedupe — once per 45s
  let _positivePauseFiredForStreak = false; // fire once per silence streak
  function trackPositivePause(s) {
    if (s.isCalibrating) return;
    const now = Date.now();
    if (s.isSpeech) {
      // Mark "enough speech" once they hold a 5s+ continuous burst.
      if ((s.continuousSpeechSec || 0) >= 5) _hadEnoughSpeech = true;
      _silenceStreakStart = 0;
      _positivePauseFiredForStreak = false;
      return;
    }
    // Silent frame
    if (!_hadEnoughSpeech) return;
    if (_silenceStreakStart === 0) _silenceStreakStart = now;
    const silenceSec = (now - _silenceStreakStart) / 1000;

    if (silenceSec >= 6 && !_positivePauseFiredForStreak &&
        (now - _lastPositivePauseAt) >= 45000) {
      _positivePauseFiredForStreak = true;
      _lastPositivePauseAt = now;
      _hadEnoughSpeech = false; // reset; require another 5s burst before next reward
      firePositivePause();
    }
  }

  function firePositivePause() {
    // Pick text from the active pack, with sane fallback.
    const positives = {
      gentle:    'Nice — let it breathe',
      direct:    'Good. Let them in.',
      warm:      'You held that beautifully',
      dry:       'Pause held',
      directive: 'Good. Let them in.',
      minimal:   null,
    };
    let text = positives[nudgePack] || positives.gentle;
    // Don't drop the user out of their tone with a generic message;
    // playful packs should match their flavor.
    if (nudgePack === 'playful') {
      const flavor = (typeof _toneFlavor !== 'undefined' && _toneFlavor) || 'neutral';
      const flavorMap = {
        neutral:    'Nice beat',
        yiddish:    'Bubbeleh, well held',
        southern:   'Well held, friend',
        british_dry:'Held it. Quite right.',
      };
      text = flavorMap[flavor] || flavorMap.neutral;
    }
    if (!text) return; // minimal pack — silent reward

    if (nudgeChannels.includes('visual')) {
      try { showPositiveToast(text); } catch (e) {}
    }
    // Don't OS-notify or watch-haptic on positive — would feel naggy.
    console.log('[Cue Panel] Positive pause recognized:', text);
  }

  // v1.1.16 — Subtle positive toast inside the side panel only. Slides up
  // from the bottom of the panel for 2.5s. NEVER injects into the active
  // tab and NEVER fires an OS notification — positive feedback should
  // feel like a soft pat on the back, not an alarm.
  let _positiveToastTimer = null;
  function showPositiveToast(text) {
    if (!text) return;
    let toast = document.getElementById('p-positive-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'p-positive-toast';
      toast.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:24px',
        'transform:translateX(-50%) translateY(20px)',
        'background:linear-gradient(180deg,#2DD4A0,#20B084)',
        'color:#fff',
        'font:600 12px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif',
        'padding:9px 16px',
        'border-radius:999px',
        'box-shadow:0 4px 16px rgba(45,212,160,.35),0 1px 3px rgba(0,0,0,.1)',
        'opacity:0',
        'transition:opacity .25s ease,transform .25s ease',
        'pointer-events:none',
        'z-index:9999',
        'white-space:nowrap',
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    // Force reflow then animate in.
    void toast.offsetWidth;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    if (_positiveToastTimer) clearTimeout(_positiveToastTimer);
    _positiveToastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2500);
  }

  // v1.1.15 — Apple Watch haptic. Fires asynchronously, dedupes to ≥10s
  // between sends per type, no-ops if user hasn't entered an email.
  let _lastHapticByType = {};
  async function fireWatchHaptic(nudgeType) {
    // Map internal nudge name → server's nudgeType keys
    const map = { pace: 'pace', tension: 'tension',
                  long_speech: 'longSpeech', escalation: 'escalation' };
    const serverType = map[nudgeType];
    if (!serverType) return;

    const now = Date.now();
    if (now - (_lastHapticByType[serverType] || 0) < 10000) return; // 10s dedupe
    _lastHapticByType[serverType] = now;

    try {
      const stored = await chrome.storage.local.get(['cueEmail', 'cueSettings']);
      // Prefer cueSettings.syncEmail (filled in from the settings page); fall
      // back to cueEmail (set elsewhere). Either signals "this user is me".
      const email = (stored.cueEmail || stored.cueSettings?.syncEmail || '')
        .toLowerCase().trim();
      // Watch haptic = enabled when user has 'haptic' in their nudgeChannels
      // (the existing settings checkbox 'Apple Watch haptic'). Default ON.
      const channels = stored.cueSettings?.nudgeChannels || [];
      const watchEnabled = channels.includes('haptic') ||
                           stored.cueSettings?.watchHaptic !== false;
      if (!email || !watchEnabled) return;

      // Fire-and-forget — failures shouldn't break the in-call experience.
      fetch('https://cue-pwa.vercel.app/api/test-haptic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, nudgeType: serverType }),
      }).then(r => r.ok ? null : console.debug('[Cue Watch] push failed:', r.status))
        .catch(e => console.debug('[Cue Watch] push error:', e?.message));
    } catch (e) { /* non-fatal */ }
  }

  // =============================================================
  // UI UPDATES
  // =============================================================

  // v1.1.2 — live state for the new "show value instantly" mechanics.
  // Mirrors Wispr Flow's "polished text appears in 3 seconds" magic by giving the
  // user real-time human-readable context for what Cue is observing.
  let _lastSignal = { tension: 50, pace: 50, energy: 50 };
  let _lastSpeechAt = 0;
  let _pauseScore = 50;            // 0-100, higher = better (you're pausing well)
  let _lastCueSaysUpdate = 0;
  const CUE_SAYS_MIN_INTERVAL = 2800;  // v1.1.3 widened from 2.2s — less chatty

  // v1.1.3 — additional bar smoothing on the PANEL side (beyond the signal model's
  // EMA). The signal model smooths at α=0.3 for responsive scoring; the displayed
  // bars want to be calmer to avoid jumpy visuals. We apply α=0.18 on top, which
  // makes the bars feel deliberate rather than nervous.
  const PANEL_BAR_ALPHA = 0.18;
  let _displayedTension = 50, _displayedPace = 50, _displayedEnergy = 50;

  // v1.1.3 — user's first name, read on init from chrome.storage.local
  // (set by onboarding). Used to personalize Cue Says + future nudges.
  let _userName = '';
  let _toneFlavor = 'neutral';   // v1.1.7 — for playful pack sub-flavors

  // v1.1.35 — Per-signal hint-band state for sustained-gate dampening.
  // Mirrors cue-desktop v1.0.5. A new band-label must hold steady for
  // HINT_SUSTAIN_MS before it replaces the displayed label. Stops the
  // per-frame text flicker near band edges.
  const _hintState = { tension: null, pace: null, energy: null };
  const HINT_SUSTAIN_MS = 3000;

  function dampedHint(type, score) {
    const want = bandLabel(score, type);
    const now = Date.now();
    let st = _hintState[type];
    if (!st) {
      st = { displayed: want, candidate: want, candidateSince: now };
      _hintState[type] = st;
      return st.displayed;
    }
    if (want === st.displayed) {
      st.candidate = want;
      st.candidateSince = now;
      return st.displayed;
    }
    if (want !== st.candidate) {
      st.candidate = want;
      st.candidateSince = now;
      return st.displayed;
    }
    if (now - st.candidateSince >= HINT_SUSTAIN_MS) {
      st.displayed = st.candidate;
    }
    return st.displayed;
  }

  function bandLabel(score, type) {
    // Returns ["calm" | "elevated" | "high" | etc., "low" | "measured" | "fast" | etc.]
    // Bands are calibrated against the user's replicant baseline (50 = your norm).
    if (type === 'tension') {
      if (score < 35) return 'calm · you\'re receptive';
      if (score < 60) return 'measured';
      if (score < 75) return 'elevated · take a breath';
      return 'high · pause and exhale';
    }
    if (type === 'pace') {
      if (score < 30) return 'slow · steady';
      if (score < 60) return 'measured';
      if (score < 75) return 'climbing · slow it down';
      return 'fast · let them speak';
    }
    if (type === 'energy') {
      if (score < 30) return 'soft · push slightly';
      if (score < 65) return 'in range';
      if (score < 80) return 'projecting';
      return 'loud · pull back';
    }
    if (type === 'pause') {
      if (score < 25) return 'no recent pause · breathe';
      if (score < 55) return 'thin pauses · lengthen';
      if (score < 80) return 'good rhythm · keep it';
      return 'strong pause behavior';
    }
    return '';
  }

  function updateCueSays(signal) {
    if (!el.cueSays) return;
    const now = Date.now();
    if (now - _lastCueSaysUpdate < CUE_SAYS_MIN_INTERVAL) return;

    let msg = null;
    // v1.1.3 — personalize with first name when available.
    // "Nathan, your voice tightened" is more arresting than "Your voice tightened".
    const youOrName = _userName ? _userName : 'You';
    const yourOrName = _userName ? `${_userName}, your` : 'Your';

    // Priority order — show the most actionable observation first
    if (!signal.isSpeech) {
      const sinceSpeechSec = _lastSpeechAt ? (now - _lastSpeechAt) / 1000 : 0;
      if (sinceSpeechSec >= 1.5 && sinceSpeechSec <= 4) msg = 'Good pause. That gave them space.';
      else if (sinceSpeechSec > 6) msg = 'Listening for cues...';
      else msg = null;
    } else if (signal.continuousSpeechSec > 25) {
      msg = `${youOrName}'ve been speaking ${Math.round(signal.continuousSpeechSec)}s without a pause.`;
    } else if (signal.tension > 75) {
      msg = `${yourOrName} voice tightened — soften your tone.`;
    } else if (signal.pace > 75) {
      msg = `${_userName ? _userName + ', pace' : 'Pace'} climbing — above your norm for ${Math.max(2, Math.round(signal.continuousSpeechSec))}s.`;
    } else if (signal.energy > 80) {
      msg = `${youOrName}'re projecting hard. Try lower volume.`;
    } else if (signal.tension < 35 && signal.pace < 60 && _pauseScore > 60) {
      msg = `Calm tone, paced well${_userName ? ', ' + _userName : ''}. Keep it.`;
    }

    // v1.1.10 — write to inner span instead of toggling display.
    // The container has fixed height; we only swap text. No reflow.
    const cueSaysText = document.getElementById('p-cue-says-text');
    if (msg) {
      if (cueSaysText) cueSaysText.textContent = msg;
      else if (el.cueSays) el.cueSays.textContent = msg;
      _lastCueSaysUpdate = now;
    }
  }

  function updateBars(tension, pace, energy, signal) {
    // v1.1.3 — panel-side smoothing layer to calm the bars. Without this the
    // signal-model output (already EMA'd at α=0.3) still feels jumpy in the UI
    // because each new value is rendered immediately.
    _displayedTension = _displayedTension + PANEL_BAR_ALPHA * (tension - _displayedTension);
    _displayedPace    = _displayedPace    + PANEL_BAR_ALPHA * (pace    - _displayedPace);
    _displayedEnergy  = _displayedEnergy  + PANEL_BAR_ALPHA * (energy  - _displayedEnergy);

    el.tensionBar.style.width = _displayedTension + '%';
    el.paceBar.style.width    = _displayedPace + '%';
    el.energyBar.style.width  = _displayedEnergy + '%';
    el.tensionValue.textContent = Math.round(_displayedTension);
    el.paceValue.textContent    = Math.round(_displayedPace);
    el.energyValue.textContent  = Math.round(_displayedEnergy);
    // Use the smoothed displayed values for downstream hint/Cue-Says logic too
    tension = _displayedTension;
    pace = _displayedPace;
    energy = _displayedEnergy;

    // v1.1.2 — live human-readable hints next to each bar
    // v1.1.35 — Sustained-gated (3s) hints — mirrors cue-desktop v1.0.5.
    if (el.tensionHint) el.tensionHint.textContent = dampedHint('tension', tension);
    if (el.paceHint)    el.paceHint.textContent    = dampedHint('pace', pace);
    if (el.energyHint)  el.energyHint.textContent  = dampedHint('energy', energy);

    // v1.1.2 — Compute Pause score. Higher = better. Based on:
    //   - Recent silence within last 4s (good)
    //   - Continuous speech > 25s without pause (bad)
    //   - Time since last detected speech segment
    if (signal) {
      _lastSignal = { tension, pace, energy };
      if (signal.isSpeech) _lastSpeechAt = Date.now();

      const cs = signal.continuousSpeechSec || 0;
      // v1.1.3 — gentler curve. Was: 0s → 70, 30s → 25, 60s → 0 (too punishing).
      // Now: 0s → 60, 30s → 50, 60s → 35, 120s → 10. Stays in the calm zone for
      // normal speech and only drops noticeably on extended monologue.
      let pauseScore = Math.max(10, Math.min(85, 60 - (cs / 60) * 25));
      // Smaller boost on fresh pause (was +25, now +12) so the bar stops jumping.
      if (!signal.isSpeech && _lastSpeechAt && (Date.now() - _lastSpeechAt) < 3500) {
        pauseScore = Math.min(95, pauseScore + 12);
      }
      // v1.1.3 — slower EMA (was 0.3, now 0.12) — pause bar moves deliberately, not nervously.
      _pauseScore = _pauseScore + 0.12 * (pauseScore - _pauseScore);
      if (el.pauseBar)   el.pauseBar.style.width = Math.round(_pauseScore) + '%';
      if (el.pauseValue) el.pauseValue.textContent = Math.round(_pauseScore);
      if (el.pauseHint)  el.pauseHint.textContent = bandLabel(_pauseScore, 'pause');

      // Update the live "Cue Says" status line
      updateCueSays({
        ...signal,
        tension, pace, energy,
      });
    }
  }

  function setStatus(text, className) {
    el.statusText.textContent = text;
    el.statusSection.className = 'p-status ' + (className || '');
  }

  function updateSessionClock() {
    if (!sessionStartTime) return;
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const min = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const sec = (elapsed % 60).toString().padStart(2, '0');
    el.sessionClock.textContent = `${min}:${sec}`;
  }

  let nudgeCountUI = 0;

  function updateStats() {
    el.statNudges.textContent = nudgeCountUI;
    if (frameCount > 0) {
      el.statAvgPace.textContent = Math.round(paceSum / frameCount);
      el.statAvgTension.textContent = Math.round(tensionSum / frameCount);
    }
  }

  let nudgeHideTimer = null;

  // =============================================================
  // QUESTION DETECTION FEEDBACK — real-time verification
  // =============================================================

  let questionFlashTimer = null;
  let totalQuestionsDetected = 0;

  function handleQuestionDetected(msg) {
    totalQuestionsDetected = msg.totalCount;
    console.log('[Cue Panel] Question detected. Total:', totalQuestionsDetected);

    // Flash a small green checkmark bubble for 2 seconds
    if (questionFlashTimer) clearTimeout(questionFlashTimer);
    const existing = document.getElementById('p-q-flash');
    if (existing) existing.remove();

    const flash = document.createElement('div');
    flash.id = 'p-q-flash';
    flash.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(45,212,160,.12);border:1px solid rgba(45,212,160,.45);color:#0F9D6F;border-radius:100px;padding:7px 14px 7px 28px;margin-bottom:10px;font-size:13px;font-weight:600;position:relative;animation:qFlash 2s ease forwards;cursor:pointer;';
    flash.title = 'Click for detection details';
    flash.innerHTML = '<span style="position:absolute;left:10px;font-size:13px;">\u2713</span>Question detected <span style="opacity:.55;font-weight:500;margin-left:4px;">#' + totalQuestionsDetected + '</span>';

    // Store evidence on the DOM element for drill-down
    if (msg.evidence) {
      flash.dataset.evidence = JSON.stringify(msg.evidence);
      flash.addEventListener('click', () => showQuestionDrillDown(msg.evidence, totalQuestionsDetected));
    }

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(flash, signalsSection);
    }

    if (!document.getElementById('p-q-flash-style')) {
      const style = document.createElement('style');
      style.id = 'p-q-flash-style';
      style.textContent = '@keyframes qFlash { 0% { opacity:0; transform:translateX(-8px); } 12% { opacity:1; transform:translateX(0); } 85% { opacity:1; transform:translateX(0); } 100% { opacity:0; transform:translateX(-4px); } }';
      document.head.appendChild(style);
    }

    questionFlashTimer = setTimeout(() => { if (flash.parentElement) flash.remove(); }, 2100);
  }

  function showQuestionDrillDown(evidence, qNum) {
    const existing = document.getElementById('p-q-drill');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'p-q-drill';
    panel.style.cssText = 'background:#FFFFFF;border:1px solid rgba(45,212,160,.35);border-radius:12px;padding:14px 16px;margin-bottom:12px;font-size:12px;color:rgba(29,29,31,.85);line-height:1.55;';

    const segsHtml = (evidence.segments || []).map((s, i) => {
      const isFinal = i === (evidence.segments.length - 1);
      const isPrev = i === (evidence.segments.length - 2);
      const label = isFinal ? ' (final)' : isPrev ? ' (prev)' : '';
      const color = isFinal ? '#0F9D6F' : 'rgba(29,29,31,.55)';
      return `<div style="color:${color}">segment ${i + 1}: ${Math.round(s)} Hz${label}</div>`;
    }).join('');

    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="font-weight:600;color:#1D1D1F;">Question #' + qNum + ' detection</span>' +
        '<button id="p-q-drill-close" style="background:none;border:none;color:rgba(29,29,31,.4);font-size:16px;cursor:pointer;padding:0;">\u00D7</button>' +
      '</div>' +
      '<div style="margin-bottom:8px;">' +
        'Centroid rise: <strong style="color:#0F9D6F;">+' + evidence.ratePercent + '%</strong>' +
        ' \u00B7 ' + evidence.prevCentroid + ' Hz \u2192 ' + evidence.finalCentroid + ' Hz' +
      '</div>' +
      '<div style="font-size:11px;color:rgba(29,29,31,.55);margin-bottom:6px;">Detection segments (0.5s each):</div>' +
      '<div style="font-family:ui-monospace,Consolas,monospace;font-size:11px;">' + segsHtml + '</div>' +
      '<div style="margin-top:10px;font-size:11px;color:rgba(29,29,31,.5);">Threshold: prev > 50 Hz AND final > prev \u00D7 1.15. Tune in Settings \u2192 Detection (coming soon).</div>';

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(panel, signalsSection);
    }

    const closeBtn = panel.querySelector('#p-q-drill-close');
    if (closeBtn) closeBtn.addEventListener('click', () => panel.remove());

    setTimeout(() => { if (panel.parentElement) panel.remove(); }, 20000);
  }

  function handleInterruptionDetected(msg) {
    console.log('[Cue Panel] Interruption detected #' + msg.count, '(', msg.overlapMs, 'ms overlap)');

    const existing = document.getElementById('p-interrupt-flash');
    if (existing) existing.remove();

    const flash = document.createElement('div');
    flash.id = 'p-interrupt-flash';
    flash.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(233,69,96,.12);border:1px solid rgba(233,69,96,.45);color:#B91C1C;border-radius:100px;padding:7px 14px 7px 28px;margin-bottom:10px;font-size:13px;font-weight:600;position:relative;animation:qFlash 3s ease forwards;';
    flash.innerHTML = '<span style="position:absolute;left:10px;font-size:13px;">!</span>Interruption detected <span style="opacity:.55;font-weight:500;margin-left:4px;">(' + msg.overlapMs + 'ms overlap)</span>';

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(flash, signalsSection);
    }
    setTimeout(() => { if (flash.parentElement) flash.remove(); }, 3100);
  }

  function handlePauseSuccess(msg) {
    console.log('[Cue Panel] PAUSE success. Latency:', msg.latencyMs + 'ms');

    const existing = document.getElementById('p-decision-pill');
    if (existing) existing.remove();

    const pill = document.createElement('div');
    pill.id = 'p-decision-pill';
    pill.style.cssText = 'background:#2DD4A0;color:#FFFFFF;border-radius:14px;padding:14px 18px;margin-bottom:14px;text-align:center;font-family:Georgia,serif;box-shadow:0 4px 20px rgba(45,212,160,.3);animation:decisionPill 5s ease forwards;';
    const latSec = (msg.latencyMs / 1000).toFixed(1);
    const ratioDrop = ((msg.initialRatio - msg.currentRatio) * 100).toFixed(0);
    pill.innerHTML = '<div style="font-size:11px;letter-spacing:2px;opacity:.85;font-family:\'Segoe UI\',sans-serif;margin-bottom:4px;">\u2713 SPACE MADE</div><div style="font-size:18px;font-weight:600;letter-spacing:-.3px;">Nice pause</div><div style="font-size:11px;opacity:.7;font-family:\'Segoe UI\',sans-serif;margin-top:4px;">speaking dropped ' + ratioDrop + '% in ' + latSec + 's</div>';

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(pill, signalsSection);
    }

    setTimeout(() => { if (pill.parentElement) pill.remove(); }, 5100);
  }

  function handleAskQuestionSuccess(msg) {
    console.log('[Cue Panel] ASK_QUESTION success. Latency:', msg.latencyMs + 'ms');

    // Replace the ASK_QUESTION pill (if still visible) with a success pill
    const existing = document.getElementById('p-decision-pill');
    if (existing) existing.remove();

    const pill = document.createElement('div');
    pill.id = 'p-decision-pill';
    pill.style.cssText = 'background:#2DD4A0;color:#FFFFFF;border-radius:14px;padding:14px 18px;margin-bottom:14px;text-align:center;font-family:Georgia,serif;box-shadow:0 4px 20px rgba(45,212,160,.3);animation:decisionPill 5s ease forwards;';
    const latSec = (msg.latencyMs / 1000).toFixed(1);
    pill.innerHTML = '<div style="font-size:11px;letter-spacing:2px;opacity:.85;font-family:\'Segoe UI\',sans-serif;margin-bottom:4px;">\u2713 QUESTION ASKED</div><div style="font-size:18px;font-weight:600;letter-spacing:-.3px;">Nice — you invited them in</div><div style="font-size:11px;opacity:.7;font-family:\'Segoe UI\',sans-serif;margin-top:4px;">(within ' + latSec + 's)</div>';

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(pill, signalsSection);
    }

    setTimeout(() => { if (pill.parentElement) pill.remove(); }, 5100);
  }

  // =============================================================
  // DECISION ENGINE UI — v1.0 PAUSE / ASK_QUESTION pill at top
  // =============================================================

  function handleDecisionFromOffscreen(msg) {
    console.log('[Cue Panel] Decision:', msg.decision, msg.reason);

    // v1.1.34 — Suppress ASK_QUESTION UI entirely (mirrors cue-desktop v1.0.4).
    // Per Nathan's repeated feedback ("tell me what to say" is the worst
    // anti-pattern), the decision-engine's directive ASK_QUESTION pill must
    // not surface in the panel. The decision is still emitted for corpus
    // pairing (signals_before/after telemetry) and the post-session
    // integration tape, but no in-session directive fires.
    if (msg.decision === 'ASK_QUESTION') {
      return;
    }

    // Show a decision pill (distinct from coaching bubble — bigger, top of panel)
    showDecisionPill(msg.decision, msg.reason);

    // Relay to service worker for cross-device haptic push
    try {
      chrome.runtime.sendMessage({
        type: 'decisionFired',
        decision: msg.decision,
        reason: msg.reason,
        signalState: msg.signalState,
        timestamp: msg.timestamp,
      }).catch(() => {});
    } catch (e) {}

    // v1.1.15 — Apple Watch haptic for PAUSE only (ASK_QUESTION suppressed above)
    if (msg.decision === 'PAUSE') {
      try { fireWatchHaptic('long_speech'); } catch (e) {}
    }
  }

  let decisionPillTimer = null;
  function showDecisionPill(decision, reason) {
    // v1.0.9: center-screen overlay is the only surface — in-panel pill suppressed
    showCenterScreenOverlay(decision, reason || '');
    return;
    // ----- legacy in-panel pill below; preserved for fast rollback -----
    const existing = document.getElementById('p-decision-pill');
    if (existing) existing.remove();
    if (decisionPillTimer) clearTimeout(decisionPillTimer);

    const styles = {
      PAUSE:        { bg: '#1D1D1F', ink: '#FFFFFF', label: 'PAUSE', sub: 'Stop. Listen.' },
      ASK_QUESTION: { bg: '#2DD4A0', ink: '#FFFFFF', label: 'ASK A QUESTION', sub: 'Invite them in.' },
    };
    const s = styles[decision];
    if (!s) return;

    const pill = document.createElement('div');
    pill.id = 'p-decision-pill';
    pill.style.cssText = `background:${s.bg};color:${s.ink};border-radius:14px;padding:14px 18px;margin-bottom:14px;text-align:center;font-family:Georgia,serif;box-shadow:0 4px 20px rgba(0,0,0,.15);animation:decisionPill 6s ease forwards;`;
    pill.innerHTML = `<div style="font-size:11px;letter-spacing:2px;opacity:.7;font-family:'Segoe UI',sans-serif;margin-bottom:4px;">${s.label}</div><div style="font-size:20px;font-weight:600;letter-spacing:-.3px;">${s.sub}</div>`;

    const signalsSection = document.querySelector('.p-signals');
    if (signalsSection && signalsSection.parentElement) {
      signalsSection.parentElement.insertBefore(pill, signalsSection);
    }

    if (!document.getElementById('p-decision-style')) {
      const style = document.createElement('style');
      style.id = 'p-decision-style';
      style.textContent = '@keyframes decisionPill { 0% { opacity:0; transform:translateY(-10px) scale(.95); } 8% { opacity:1; transform:translateY(0) scale(1); } 92% { opacity:1; transform:translateY(0) scale(1); } 100% { opacity:0; transform:translateY(-4px) scale(.98); } }';
      document.head.appendChild(style);
    }

    decisionPillTimer = setTimeout(() => { if (pill.parentElement) pill.remove(); }, 6100);
  }

  function showSessionSummary(durationMs, nudges, avgPace, avgTension) {
    // Remove any existing summary block
    clearSessionSummary();

    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    const durStr = `${mins}m ${String(secs).padStart(2,'0')}s`;

    const summary = document.createElement('div');
    summary.id = 'p-session-summary';
    summary.style.cssText = 'background:#FFFFFF;border:1px solid rgba(0,0,0,.05);border-radius:12px;padding:16px;margin-bottom:14px;';
    summary.innerHTML =
      '<div style="font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#2DD4A0;margin-bottom:10px;">Session complete</div>' +
      '<div style="font-size:13px;color:rgba(29,29,31,.75);line-height:1.7;">' +
        '<div style="display:flex;justify-content:space-between;"><span>Duration</span><span style="font-weight:600;color:#1D1D1F;">' + durStr + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;"><span>Nudges</span><span style="font-weight:600;color:#1D1D1F;">' + nudges + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;"><span>Avg pace</span><span style="font-weight:600;color:#1D1D1F;">' + (avgPace !== null ? avgPace : '—') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;"><span>Avg tension</span><span style="font-weight:600;color:#1D1D1F;">' + (avgTension !== null ? avgTension : '—') + '</span></div>' +
      '</div>';

    // Insert above the Start button
    const control = el.startBtn.parentElement;
    control.parentElement.insertBefore(summary, control);

    setStatus('Session complete — click Start to begin a new one', '');
  }

  function clearSessionSummary() {
    const existing = document.getElementById('p-session-summary');
    if (existing) existing.remove();
  }

  function showNudgeCard(type, text) {
    if (!text) return;
    // v1.0.9: center-screen overlay is the only surface — in-panel pill suppressed
    showCenterScreenOverlay(type, text);
  }

  // v1.0.8: Center-screen overlay
  // Renders the nudge as a fixed-position overlay in the middle of whatever
  // tab the user is currently looking at (Zoom, Teams, Meet, or any other page).
  // Falls back silently if the active tab is a chrome:// URL or other restricted
  // page where chrome.scripting can't inject — the in-panel UI still fires.
  async function showCenterScreenOverlay(type, text) {
    // v1.1.11 — ALWAYS fire BOTH paths so the user sees the cue regardless of
    // where their focus is:
    //   1) In-tab center overlay  → visible when user is on a Chrome tab
    //   2) OS-level notification  → visible even when user is in another app
    //      (Claude.app, Slack, Outlook, native Zoom, etc.)
    //
    // Chrome extensions cannot draw outside the Chrome window. System
    // notifications are the only way to reach the user when they're focused
    // on a non-Chrome window. Per user feedback: "I don't see them when I'm
    // in another window like I am in Claude."

    // Path 1: try the in-tab overlay
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.id && tab.url && !/^(chrome|edge|brave|about|chrome-extension|view-source):/i.test(tab.url)) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: cueRenderCenterOverlay,
          args: [String(type || 'CUE'), String(text || ''), 4500],
        }).catch(() => { /* tab might be unloaded — fine */ });
      }
    } catch (e) {
      console.debug('[Cue Panel] Center overlay injection skipped:', e && e.message);
    }

    // v1.1.12 — make the OS notification AS PROMINENT AS POSSIBLE since it's
    // the only thing visible when the user is in non-Chrome apps. Priority 2
    // (max) keeps it visible longer; requireInteraction true makes it persist
    // until dismissed instead of auto-fading. Sound plays for attention.
    try {
      if (chrome.notifications && chrome.notifications.create) {
        const niceLabel = String(type || 'CUE').replace(/_/g, ' ').replace(/\w\S*/g, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
        chrome.notifications.create('cue-' + type + '-' + Date.now(), {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
          title: 'Cue · ' + niceLabel,
          message: text || '',
          contextMessage: 'Real-time conversation coaching',
          priority: 2,                  // max priority — Windows shows it prominently
          silent: false,                // sound plays
          requireInteraction: true,     // stays visible until user dismisses
        }).catch(err => console.warn('[Cue] notification failed:', err));
      } else {
        console.warn('[Cue] chrome.notifications API not available');
      }
    } catch (e) {
      console.warn('[Cue] notification dispatch error:', e);
    }
  }

  // v1.1.7 — Self-contained function with INTENSITY GRADING. Runs INSIDE the
  // target tab. No closures, no `el`, no chrome.* outside this scope.
  // Intensity tiers (chosen by nudge type):
  //   - subtle:  thin teal pill in the lower-center, 2.5s, soft fade
  //   - medium:  centered card, 4s
  //   - strong:  big center card with breathing pulse, 6s (escalation only)
  function cueRenderCenterOverlay(type, text, ttlMs) {
    const id = 'cue-center-nudge-overlay';
    const existing = document.getElementById(id);
    if (existing) existing.remove();

    // Intensity grade per nudge type
    const intensity =
      type === 'ESCALATION' ? 'strong'
      : (type === 'PAUSE' || type === 'ASK_QUESTION' || type === 'TENSION') ? 'medium'
      : 'subtle';   // PACE, ENERGY, CONTINUOUS_SPEECH default to subtle

    const accent =
      type === 'PAUSE' ? '#FFFFFF'
      : type === 'ASK_QUESTION' ? '#2DD4A0'
      : (type === 'TENSION' || type === 'ESCALATION') ? '#EF4444'
      : type === 'PACE' ? '#F59E0B'
      : type === 'ENERGY' ? '#3B82F6'
      : type === 'CONTINUOUS_SPEECH' ? '#F59E0B'
      : '#FFFFFF';

    const bg = type === 'ASK_QUESTION' ? 'rgba(45, 212, 160, 0.96)'
      : 'rgba(20, 20, 22, 0.94)';
    const ink = type === 'ASK_QUESTION' ? '#1D1D1F' : '#FFFFFF';

    const overlay = document.createElement('div');
    overlay.id = id;

    // v1.1.7 — sizing/positioning by intensity
    const padding = intensity === 'strong' ? '36px 70px' : intensity === 'medium' ? '24px 48px' : '14px 24px';
    const top = intensity === 'subtle' ? '78%' : '50%';     // subtle = lower-center, less intrusive
    const minWidth = intensity === 'subtle' ? '160px' : '240px';
    const maxWidth = intensity === 'strong' ? '600px' : '460px';
    const bgFinal = intensity === 'subtle' ? 'rgba(20, 20, 22, 0.78)' : bg;
    const radius = intensity === 'subtle' ? '999px' : '20px';   // subtle = pill, others = rounded card
    const shadow = intensity === 'strong'
      ? '0 30px 100px rgba(0,0,0,0.5),0 8px 24px rgba(0,0,0,0.25),0 0 0 2px ' + accent + '33'
      : intensity === 'medium'
        ? '0 20px 80px rgba(0,0,0,0.45),0 4px 16px rgba(0,0,0,0.18)'
        : '0 8px 28px rgba(0,0,0,0.30)';

    overlay.style.cssText = [
      'position:fixed',
      'top:' + top,
      'left:50%',
      'transform:translate(-50%,-50%) scale(0.92)',
      'z-index:2147483647',
      'padding:' + padding,
      'background:' + bgFinal,
      'backdrop-filter:blur(24px)',
      '-webkit-backdrop-filter:blur(24px)',
      'border-radius:' + radius,
      'border:1px solid rgba(255,255,255,0.08)',
      'box-shadow:' + shadow,
      'color:' + ink,
      'font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
      'text-align:center',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 0.28s ease, transform 0.28s ease',
      'min-width:' + minWidth,
      'max-width:' + maxWidth,
    ].join(';');

    const labelText = String(type || 'CUE').replace(/_/g, ' ').toUpperCase();

    // Subtle intensity: skip the small-caps label entirely. Just the message in a pill.
    if (intensity !== 'subtle') {
      const label = document.createElement('div');
      const labelSize = intensity === 'strong' ? '13px' : '11px';
      label.style.cssText = 'font-size:' + labelSize + ';font-weight:600;letter-spacing:3px;color:' + accent + ';margin-bottom:10px;';
      label.textContent = labelText;
      overlay.appendChild(label);
    }

    const body = document.createElement('div');
    const bodyFontSize = intensity === 'strong' ? '28px' : intensity === 'medium' ? '24px' : '15px';
    const bodyFontStyle = intensity === 'subtle' ? 'normal' : 'italic';
    body.style.cssText = 'font-family:Georgia,"Times New Roman",serif;font-style:' + bodyFontStyle + ';font-size:' + bodyFontSize + ';font-weight:400;line-height:1.35;color:' + ink + ';';
    body.textContent = text || '';
    overlay.appendChild(body);

    // v1.1.7 — Strong intensity adds a breathing pulse animation (autonomic biofeedback)
    if (intensity === 'strong') {
      overlay.style.animation = 'cuePulseBreath 4s ease-in-out infinite';
      // Inject keyframes once
      if (!document.getElementById('cue-overlay-keyframes')) {
        const style = document.createElement('style');
        style.id = 'cue-overlay-keyframes';
        style.textContent = '@keyframes cuePulseBreath { 0%,100% { box-shadow: 0 30px 100px rgba(0,0,0,0.5),0 8px 24px rgba(0,0,0,0.25),0 0 0 2px ' + accent + '33; } 50% { box-shadow: 0 30px 100px rgba(0,0,0,0.5),0 8px 24px rgba(0,0,0,0.25),0 0 0 8px ' + accent + '55; } }';
        document.head.appendChild(style);
      }
    }

    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      overlay.style.transform = 'translate(-50%,-50%) scale(1)';
    });

    // v1.1.7 — duration scales with intensity
    const duration = ttlMs || (intensity === 'strong' ? 6000 : intensity === 'medium' ? 4500 : 2800);
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.transform = 'translate(-50%,-50%) scale(0.92)';
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 320);
    }, duration);
  }

  function hideNudge() {
    el.nudgeCard.className = 'p-nudge-card';
    if (nudgeHideTimer) {
      clearTimeout(nudgeHideTimer);
      nudgeHideTimer = null;
    }
  }

  function showSystemNotification(type, text) {
    if (!text) return;
    try {
      chrome.notifications.create('cue-panel-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: 'Cue — ' + type.replace('_', ' '),
        message: text,
        priority: type === 'escalation' ? 2 : 1,
        requireInteraction: false,
        silent: false,
      });
    } catch (e) {
      console.warn('[Cue Panel] Notification failed:', e);
    }
  }

  // v1.1.14 — Confirmation tone synthesis. Web Audio so we don't ship an audio file.
  // Two-note ascending chime (G4 → C5) ~250ms total when session starts.
  function playStartTone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const o1 = ctx.createOscillator(); const g1 = ctx.createGain();
      o1.type = 'sine'; o1.frequency.value = 392;
      g1.gain.setValueAtTime(0.0001, now);
      g1.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      o1.connect(g1).connect(ctx.destination);
      o1.start(now); o1.stop(now + 0.14);
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain();
      o2.type = 'sine'; o2.frequency.value = 523;
      g2.gain.setValueAtTime(0.0001, now + 0.10);
      g2.gain.exponentialRampToValueAtTime(0.18, now + 0.12);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      o2.connect(g2).connect(ctx.destination);
      o2.start(now + 0.10); o2.stop(now + 0.26);
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 400);
    } catch (e) { /* fail silent — non-blocking */ }
  }

  // =============================================================
  // v1.0.9 — DEMO KEYSTROKES (for screenshot capture + investor demos)
  //
  // Focus the side panel and press one of these letters (lowercase or upper):
  //   D → fires PAUSE (white pill)
  //   Q → fires ASK_QUESTION (teal pill)
  //   T → fires TENSION  (red, "Take a breath")
  //   P → fires PACE     (amber, "Slow it down")
  //   E → fires ENERGY   (blue, "Pull back the volume")
  //   L → fires CONTINUOUS_SPEECH (amber, "Let them speak")
  //   X → fires ESCALATION (red, "Take a breath")
  //
  // Each fires the exact same code path as a real nudge — center-screen
  // overlay on the active tab. Hidden feature; no UI to indicate it exists.
  // =============================================================

  document.addEventListener('keydown', (e) => {
    // Don't hijack keys when user is typing in any input/select
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

    const k = (e.key || '').toLowerCase();
    const demos = {
      d: ['PAUSE',              'Stop. Listen.'],
      q: ['ASK_QUESTION',       'Invite them in.'],
      t: ['TENSION',            'Take a breath.'],
      p: ['PACE',               'Slow it down.'],
      e: ['ENERGY',             'Pull back the volume.'],
      l: ['CONTINUOUS_SPEECH',  'Let them speak.'],
      x: ['ESCALATION',         'Take a breath.'],
    };
    const demo = demos[k];
    if (!demo) return;
    e.preventDefault();
    console.log('[Cue Panel] Demo nudge fired via keystroke:', k.toUpperCase(), '→', demo[0]);
    showCenterScreenOverlay(demo[0], demo[1]);
  });

  // =============================================================
  // v1.1.7 — ADVANCED TOGGLE
  // Profile picker, source picker, progress, verify — all hidden by default
  // (per user feedback: less on screen). Click "···" Advanced to reveal.
  // =============================================================

  function wireAdvancedToggle() {
    const advancedToggleBtn = document.getElementById('p-advanced-toggle');
    if (!advancedToggleBtn) return;
    advancedToggleBtn.addEventListener('click', () => {
      const sectionIds = ['p-profile-section', 'p-source-section', 'p-progress-btn', 'p-verify-btn'];
      const anyHidden = sectionIds.some(id => {
        const e = document.getElementById(id);
        return e && (e.style.display === 'none' || e.style.display === '');
      });
      sectionIds.forEach(id => {
        const e = document.getElementById(id);
        if (e) e.style.display = anyHidden ? '' : 'none';
      });
      advancedToggleBtn.classList.toggle('active', anyHidden);
    });
  }

  // =============================================================
  // STARTUP
  // =============================================================

  // v1.1.16 — First-run magic-moment onboarding. Three cards rendered as
  // a centered overlay. User clicks through; we mark cueOnboarded:true so
  // it never shows again. Designed to be skip-able (small "Skip" link)
  // so power users aren't blocked from getting straight to a session.
  async function maybeShowFirstRunOnboarding() {
    const stored = await chrome.storage.local.get(['cueOnboarded']);
    if (stored.cueOnboarded) return;

    const cards = [
      {
        title: 'Cue listens to YOU.',
        body: 'Not the call. Not the other person. Just your voice — your pace, your tension, your pause patterns. Everything stays on this device.',
        cta: 'Got it',
      },
      {
        title: 'It nudges when it matters.',
        body: 'Talking too fast under pressure? You\'ll see "Slow it down." Holding too long? "Give them space." A 6-second pause earns a quiet "Nice — let it breathe."',
        cta: 'Sounds good',
      },
      {
        title: 'Press Ctrl+Space to start.',
        body: 'From any window. The hotkey toggles a session. Your bars react to your voice, and Cue surfaces a cue right when you need it.',
        cta: 'Start using Cue',
      },
    ];

    let i = 0;
    const overlay = document.createElement('div');
    overlay.id = 'p-onboarding-overlay';
    overlay.style.cssText = [
      'position:fixed','inset:0','background:rgba(29,29,31,0.55)',
      'backdrop-filter:blur(6px)','z-index:99999',
      'display:flex','align-items:center','justify-content:center','padding:24px',
      'opacity:0','transition:opacity .25s ease',
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background:#fff','border-radius:18px','padding:24px 22px 20px',
      'max-width:320px','width:100%','box-shadow:0 12px 40px rgba(0,0,0,0.25)',
      'transform:translateY(8px) scale(0.98)','transition:transform .25s ease',
    ].join(';');

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function render() {
      const c = cards[i];
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div style="display:flex;gap:6px;">
            ${cards.map((_, idx) => `<div style="width:18px;height:3px;border-radius:2px;background:${idx <= i ? '#2DD4A0' : 'rgba(29,29,31,0.15)'};"></div>`).join('')}
          </div>
          <button id="p-ob-skip" style="background:none;border:none;font-size:11px;color:rgba(29,29,31,0.55);cursor:pointer;padding:4px;">Skip</button>
        </div>
        <h2 style="font:600 19px/1.25 -apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;color:#1D1D1F;margin:0 0 10px;letter-spacing:-0.3px;">${c.title}</h2>
        <p style="font:400 14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;color:rgba(29,29,31,0.72);margin:0 0 20px;">${c.body}</p>
        <button id="p-ob-next" style="width:100%;background:linear-gradient(180deg,#2DD4A0,#20B084);color:#fff;border:none;border-radius:10px;padding:11px 14px;font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(45,212,160,0.30);">${c.cta}</button>
      `;
      const next = document.getElementById('p-ob-next');
      const skip = document.getElementById('p-ob-skip');
      next.onclick = advance;
      skip.onclick = finish;
    }

    function advance() {
      if (i < cards.length - 1) { i++; render(); }
      else { finish(); }
    }

    async function finish() {
      overlay.style.opacity = '0';
      card.style.transform = 'translateY(8px) scale(0.98)';
      await chrome.storage.local.set({ cueOnboarded: true }).catch(() => {});
      setTimeout(() => overlay.remove(), 250);
    }

    render();
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      card.style.transform = 'translateY(0) scale(1)';
    });
  }

  // v1.1.34 — Delegated handler for any external-URL CTA inside the panel.
  // Mirrors cue-desktop v1.0.4 — converted "Become a Founding Member" from
  // <a target="_blank"> (which is reliable in extension side-panels but
  // breaks in Tauri WebView) to <button data-cue-external="..."> for
  // cross-surface consistency. chrome.tabs.create works in both contexts.
  function wireExternalCtaButtons() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest('[data-cue-external]');
      if (!btn) return;
      const url = btn.getAttribute('data-cue-external');
      if (!url) return;
      ev.preventDefault();
      try {
        if (chrome && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url });
        } else if (typeof window.open === 'function') {
          window.open(url, '_blank');
        }
      } catch (e) {
        console.warn('[Cue Panel] external CTA open failed:', e);
      }
    });
  }

  // v1.1.34 — Apple Watch haptic CTA HIDDEN.
  // The CTA pointed at /api/haptic-test which is `.disabled` on the PWA;
  // Apple Watch sync (full v2 design) is deferred until the iOS-native app
  // ships. To re-enable: remove the early return and re-point p-watch-setup
  // at the real iPhone-PWA onboarding URL.
  async function wireWatchCTA() {
    const cta = document.getElementById('p-watch-cta');
    if (cta) cta.style.display = 'none';
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); wireAdvancedToggle(); wireExternalCtaButtons(); wireWatchCTA(); });
  } else {
    init();
    wireAdvancedToggle();
    wireExternalCtaButtons();
    wireWatchCTA();
  }

})();
