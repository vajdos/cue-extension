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
    tensionValue: document.getElementById('p-tension-value'),
    paceValue: document.getElementById('p-pace-value'),
    energyValue: document.getElementById('p-energy-value'),
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

    // Load settings + Pro state
    try {
      const stored = await chrome.storage.local.get(['cueSettings', 'cuePro']);
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
      }
      const isPro = stored.cuePro === true;
      const sessionCount = stored.cueSessionCount || 0;
      const effectivePro = isPro || sessionCount < 3;

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

      el.startBtn.textContent = 'Stop';
      el.startBtn.classList.add('stop');
      el.startBtn.disabled = false;
      el.logo.classList.add('live');
      el.stats.style.display = 'block';

      setStatus('Calibrating...', 'calibrating');

      // Start session clock
      if (sessionClockInterval) clearInterval(sessionClockInterval);
      sessionClockInterval = setInterval(updateSessionClock, 1000);

      // Notify service worker so it can mark the badge
      try {
        chrome.runtime.sendMessage({ type: 'panelSessionStart' }).catch(() => {});
      } catch (e) {}

      console.log('[Cue Panel] Session started.');
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

    // Freeze the session clock on the final duration (don't reset to —)
    el.sessionClock.textContent = `${String(finalMin).padStart(2,'0')}:${String(finalSec).padStart(2,'0')}`;

    // Reset live bars — but keep stats visible with final numbers
    el.tensionBar.style.width = '0%';
    el.paceBar.style.width = '0%';
    el.energyBar.style.width = '0%';
    el.tensionValue.textContent = '—';
    el.paceValue.textContent = '—';
    el.energyValue.textContent = '—';

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
      el.startBtn.textContent = 'Stop';
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

    requestAnimationFrame(() => {
      updateBars(s.tension, s.pace, s.energy);
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

  function handleNudgeFromOffscreen(msg) {
    console.log('[Cue Panel] Nudge from offscreen:', msg.nudgeType);
    nudgeCountUI++;
    updateStats();

    const text = CUE_THRESHOLDS.NUDGE_PACKS[nudgePack][msg.nudgeType];

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
  }

  // =============================================================
  // UI UPDATES
  // =============================================================

  function updateBars(tension, pace, energy) {
    el.tensionBar.style.width = tension + '%';
    el.paceBar.style.width = pace + '%';
    el.energyBar.style.width = energy + '%';
    el.tensionValue.textContent = Math.round(tension);
    el.paceValue.textContent = Math.round(pace);
    el.energyValue.textContent = Math.round(energy);
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

    // Show a decision pill (distinct from coaching bubble — bigger, top of panel)
    showDecisionPill(msg.decision, msg.reason);

    // Relay to service worker for cross-device haptic push
    // PAUSE = 1 pulse, ASK_QUESTION = 2 pulses, CONTINUE = silent
    try {
      chrome.runtime.sendMessage({
        type: 'decisionFired',
        decision: msg.decision,
        reason: msg.reason,
        signalState: msg.signalState,
        timestamp: msg.timestamp,
      }).catch(() => {});
    } catch (e) {}
  }

  let decisionPillTimer = null;
  function showDecisionPill(decision, reason) {
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
    if (nudgeHideTimer) clearTimeout(nudgeHideTimer);

    el.nudgeType.textContent = type.replace('_', ' ');
    el.nudgeText.textContent = text;
    el.nudgeCard.className = 'p-nudge-card ' + type + ' visible';

    nudgeHideTimer = setTimeout(hideNudge, 5000);
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

  // =============================================================
  // STARTUP
  // =============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
