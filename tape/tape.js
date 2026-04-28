/**
 * Cue — Integration Tape Page Script
 *
 * Loads session data from IndexedDB, computes EQ score,
 * and renders the full Integration Tape with Canvas charts.
 */

(function () {
  'use strict';

  // ============================================================
  // INITIALIZATION
  // ============================================================

  let _isPro = false;
  let _sessionCount = 0;
  let _isTrial = false;

  async function init() {
    try {
      // Check pro status + Taste of Pro trial
      try {
        const result = await chrome.storage.local.get(['cuePro', 'cueSessionCount']);
        _isPro = result.cuePro === true;
        _sessionCount = result.cueSessionCount || 0;
      } catch (e) {}

      // Taste of Pro: first 3 calls get full Pro experience
      _isTrial = !_isPro && _sessionCount < 3;
      const effectivePro = _isPro || _isTrial;

      // Get session ID from URL params, or use latest
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session');

      let tape;
      if (sessionId) {
        tape = await CueIntegrationTape.generate(sessionId);
      } else {
        tape = await CueIntegrationTape.generateLatest();
      }

      if (!tape) {
        // Differentiate: specific session requested but missing,
        // vs. no sessions ever recorded.
        let totalSessionCount = 0;
        try {
          const all = await CueDB.getAllSessions();
          totalSessionCount = (all || []).length;
        } catch (e) {}

        if (sessionId && totalSessionCount > 0) {
          showEmpty('session_not_found', sessionId);
        } else if (totalSessionCount === 0) {
          showEmpty('no_sessions');
        } else {
          showEmpty('empty_session');
        }
        return;
      }

      renderTape(tape);

      // Show trial banner if in trial period
      if (_isTrial) {
        showTrialBanner();
      }

      // Apply pro gates after rendering (only for expired free users)
      if (!effectivePro) {
        applyFreeGates();
      }

    } catch (err) {
      console.error('[Tape] Failed to load:', err);
      showEmpty();
    }
  }

  /**
   * Show a subtle banner at the top of the tape during the trial period.
   */
  function showTrialBanner() {
    const remaining = 3 - _sessionCount;
    const banner = document.createElement('div');
    banner.style.cssText = `
      text-align: center;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      color: #1AA37D;
      background: rgba(45, 212, 160, 0.06);
      border-radius: 10px;
      margin-bottom: 16px;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    `;
    banner.textContent = 'Pro trial: ' + remaining + ' of 3 free Pro sessions remaining';

    // Insert at the top of tape-content
    const tapeContent = document.getElementById('tape-content');
    if (tapeContent && tapeContent.firstChild) {
      tapeContent.insertBefore(banner, tapeContent.firstChild);
    }
  }

  /**
   * Lock Pro-only sections for free users.
   * Blurs the content and overlays an upgrade prompt.
   */
  function applyFreeGates() {
    const gatedSections = [
      'tape-arc',      // Emotional Arc chart
      'tape-moment',   // Moment You Missed
      'tape-skill'     // Micro-Skill
    ];

    for (const id of gatedSections) {
      const section = document.getElementById(id);
      if (!section) continue;
      // Also try by class name
      const el = section.style ? section : document.querySelector('.' + id);
      if (!el) continue;

      el.style.position = 'relative';
      el.style.overflow = 'hidden';

      // Blur the content
      const children = el.children;
      for (let i = 0; i < children.length; i++) {
        children[i].style.filter = 'blur(6px)';
        children[i].style.pointerEvents = 'none';
        children[i].style.userSelect = 'none';
      }

      // Overlay with upgrade prompt
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.7);
        border-radius: 16px;
        z-index: 10;
      `;

      const lock = document.createElement('div');
      lock.style.cssText = 'font-size: 28px; margin-bottom: 8px;';
      lock.textContent = '\u{1F512}';

      const text = document.createElement('div');
      text.style.cssText = 'font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 4px;';
      text.textContent = _sessionCount >= 3 ? 'Your first 3 calls included full analysis.' : 'Pro Feature';

      const sub = document.createElement('div');
      sub.style.cssText = 'font-size: 12px; color: #6b7280; margin-bottom: 12px;';
      sub.textContent = _sessionCount >= 3
        ? 'Keep unlocking insights with Pro.'
        : 'Upgrade to unlock full analysis';

      const btn = document.createElement('button');
      btn.style.cssText = `
        font-family: inherit; font-size: 13px; font-weight: 600;
        color: white; background: linear-gradient(135deg, #2DD4A0, #1AA37D);
        border: none; border-radius: 100px; padding: 8px 20px;
        cursor: pointer; transition: transform 0.1s ease;
      `;
      btn.textContent = 'Upgrade to Pro';
      btn.addEventListener('click', () => {
        window.open('https://cue-pwa.vercel.app/pricing.html', '_blank');
      });

      overlay.appendChild(lock);
      overlay.appendChild(text);
      overlay.appendChild(sub);
      overlay.appendChild(btn);
      el.appendChild(overlay);
    }

    // Also gate the comparison section
    const compEl = document.getElementById('tape-comparison');
    if (compEl && compEl.style.display !== 'none') {
      compEl.innerHTML = '<span style="font-size:13px; color:#1AA37D; cursor:pointer;" onclick="window.open(\'https://cue-pwa.vercel.app/pricing.html\',\'_blank\')">Upgrade to Pro to compare vs. last call</span>';
    }
  }

  function showEmpty(reason, sessionId) {
    document.getElementById('tape-loading').style.display = 'none';
    document.getElementById('tape-empty').style.display = 'block';

    const titleEl = document.getElementById('tape-empty-title');
    const hintEl = document.getElementById('tape-empty-hint');

    if (reason === 'session_not_found' && titleEl && hintEl) {
      titleEl.textContent = 'Session not found';
      hintEl.textContent = 'The session id "' + (sessionId || '') + '" is not in your local history. It may have been pruned (Cue keeps the most recent 20 sessions).';
    } else if (reason === 'empty_session' && titleEl && hintEl) {
      titleEl.textContent = 'Session was too short';
      hintEl.textContent = 'The call ended before enough audio was captured to compute an EQ score. Try a longer call.';
    } else if (titleEl && hintEl) {
      titleEl.textContent = 'No session data yet';
      hintEl.textContent = 'Complete a call with Cue active to see your Integration Tape.';
    }

    // Wire action buttons
    const panelBtn = document.getElementById('tape-open-panel');
    if (panelBtn) {
      panelBtn.onclick = () => {
        try {
          // Open the side panel for the current window. If the API is
          // available, this will slide it in. Fallback: open as a tab.
          if (chrome && chrome.sidePanel && chrome.sidePanel.open) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) {
                chrome.sidePanel.open({ windowId: tabs[0].windowId });
              }
            });
          } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/panel.html') });
          }
        } catch (e) {
          chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/panel.html') });
        }
      };
    }

    const progressBtn = document.getElementById('tape-open-progress');
    if (progressBtn) {
      progressBtn.onclick = () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('tape/progress.html') });
      };
    }
  }

  // ============================================================
  // RENDERING
  // ============================================================

  function renderTape(tape) {
    // Hide loading, show content
    document.getElementById('tape-loading').style.display = 'none';
    document.getElementById('tape-content').style.display = 'block';

    // Session info
    document.getElementById('tape-date').textContent = tape.date;
    document.getElementById('tape-time').textContent = tape.time;
    document.getElementById('tape-duration').textContent = tape.durationMin + ' min';

    // EQ Score
    document.getElementById('tape-eq-score').textContent = tape.eqScore.total;
    drawEQRing(tape.eqScore.total);

    // Comparison
    if (tape.comparison && tape.comparison.delta !== null) {
      const compEl = document.getElementById('tape-comparison');
      const deltaEl = document.getElementById('tape-delta');
      compEl.style.display = 'block';

      const delta = tape.comparison.delta;
      if (delta > 0) {
        deltaEl.textContent = '+' + delta;
        deltaEl.className = 'tape-delta positive';
      } else if (delta < 0) {
        deltaEl.textContent = String(delta);
        deltaEl.className = 'tape-delta negative';
      } else {
        deltaEl.textContent = '0';
        deltaEl.className = 'tape-delta neutral';
      }
    }

    // Breakdown bars (animate after a short delay)
    setTimeout(() => {
      setBar('bar-tension-stability', 'score-tension-stability', tape.eqScore.tensionStability);
      setBar('bar-strategic-pausing', 'score-strategic-pausing', tape.eqScore.strategicPausing);
      setBar('bar-energy-regulation', 'score-energy-regulation', tape.eqScore.energyRegulation);
    }, 300);

    // Emotional Arc chart
    drawEmotionalArc(tape.emotionalArc);

    // Moment You Missed
    if (tape.missedMoment) {
      const momentSection = document.getElementById('tape-moment');
      momentSection.style.display = 'block';

      const mins = Math.floor(tape.missedMoment.secondsIntoCall / 60);
      const secs = tape.missedMoment.secondsIntoCall % 60;
      document.getElementById('tape-moment-time').textContent =
        mins + ':' + String(secs).padStart(2, '0');

      document.getElementById('tape-moment-t').textContent = tape.missedMoment.tension;
      document.getElementById('tape-moment-p').textContent = tape.missedMoment.pace;
      document.getElementById('tape-moment-e').textContent = tape.missedMoment.energy;

      const desc = tape.missedMoment.hadPauseNearby
        ? 'Your tension peaked here. You did pause nearby, but the spike was still significant.'
        : 'Your tension peaked here with no pause within 10 seconds. This was a moment to breathe and recalibrate.';
      document.getElementById('tape-moment-desc').textContent = desc;
    }

    // Nudge summary
    const totalNudges = Object.values(tape.nudgeBreakdown).reduce((a, b) => a + b, 0);
    document.getElementById('nudge-total').textContent = totalNudges;
    document.getElementById('nudge-pace').textContent = tape.nudgeBreakdown.pace;
    document.getElementById('nudge-tension').textContent = tape.nudgeBreakdown.tension;
    document.getElementById('nudge-longspeech').textContent = tape.nudgeBreakdown.long_speech;
    document.getElementById('nudge-escalation').textContent = tape.nudgeBreakdown.escalation;

    // Micro-skill
    document.getElementById('tape-skill-name').textContent = tape.microSkill.skill;
    document.getElementById('tape-skill-desc').textContent = tape.microSkill.description;
    document.getElementById('tape-skill-tip').textContent = tape.microSkill.tip;

    // Stats
    document.getElementById('tape-speech-ratio').textContent = tape.speechRatio + '%';
    document.getElementById('tape-frame-count').textContent = tape.frameCount;
  }

  function setBar(barId, scoreId, value) {
    const bar = document.getElementById(barId);
    const score = document.getElementById(scoreId);
    if (bar) bar.style.width = value + '%';
    if (score) score.textContent = value;
  }

  // ============================================================
  // CANVAS: EQ SCORE RING
  // ============================================================

  function drawEQRing(score) {
    const canvas = document.getElementById('tape-eq-ring');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // High-DPI support
    canvas.width = 200 * dpr;
    canvas.height = 200 * dpr;
    canvas.style.width = '200px';
    canvas.style.height = '200px';
    ctx.scale(dpr, dpr);

    const cx = 100;
    const cy = 100;
    const radius = 85;
    const lineWidth = 10;
    const startAngle = -Math.PI / 2; // top
    const fullAngle = 2 * Math.PI;

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, fullAngle);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Score ring — animate
    const targetAngle = (score / 100) * fullAngle;
    let currentAngle = 0;

    function animate() {
      currentAngle += (targetAngle - currentAngle) * 0.08;

      // Clear and redraw background
      ctx.clearRect(0, 0, 200, 200);

      // Background ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, fullAngle);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Score ring with gradient
      if (currentAngle > 0.01) {
        const gradient = ctx.createLinearGradient(0, 0, 200, 200);
        if (score >= 70) {
          gradient.addColorStop(0, '#2DD4A0');
          gradient.addColorStop(1, '#22B88A');
        } else if (score >= 40) {
          gradient.addColorStop(0, '#FDE68A');
          gradient.addColorStop(1, '#F59E0B');
        } else {
          gradient.addColorStop(0, '#FCA5A5');
          gradient.addColorStop(1, '#EF4444');
        }

        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, startAngle + currentAngle);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      if (Math.abs(currentAngle - targetAngle) > 0.01) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }

  // ============================================================
  // CANVAS: EMOTIONAL ARC CHART
  // ============================================================

  function drawEmotionalArc(arc) {
    const canvas = document.getElementById('tape-arc-chart');
    if (!canvas || !arc || arc.timestamps.length < 2) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const displayWidth = canvas.parentElement.clientWidth || 800;
    const displayHeight = 250;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 20, bottom: 40, left: 40 };
    const chartWidth = displayWidth - padding.left - padding.right;
    const chartHeight = displayHeight - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

    // Grid lines
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y <= 100; y += 25) {
      const yPos = padding.top + chartHeight - (y / 100) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(padding.left + chartWidth, yPos);
      ctx.stroke();

      // Y-axis labels
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(y, padding.left - 8, yPos + 3);
    }

    // X-axis labels (time)
    const totalSeconds = arc.timestamps[arc.timestamps.length - 1];
    const timeLabels = 5;
    ctx.textAlign = 'center';
    for (let i = 0; i <= timeLabels; i++) {
      const sec = Math.round((totalSeconds / timeLabels) * i);
      const mins = Math.floor(sec / 60);
      const secs = sec % 60;
      const xPos = padding.left + (i / timeLabels) * chartWidth;
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(mins + ':' + String(secs).padStart(2, '0'), xPos, displayHeight - 10);
    }

    // Draw speech regions (subtle background)
    for (let i = 0; i < arc.speech.length; i++) {
      if (arc.speech[i]) {
        const x = padding.left + (i / (arc.timestamps.length - 1)) * chartWidth;
        const w = chartWidth / (arc.timestamps.length - 1);
        ctx.fillStyle = 'rgba(45, 212, 160, 0.05)';
        ctx.fillRect(x, padding.top, w, chartHeight);
      }
    }

    // Draw signal lines
    const signals = [
      { data: arc.tension, color: '#EF4444', alpha: 0.8 },
      { data: arc.pace, color: '#F59E0B', alpha: 0.8 },
      { data: arc.energy, color: '#3B82F6', alpha: 0.6 }
    ];

    for (const signal of signals) {
      ctx.beginPath();
      ctx.strokeStyle = signal.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = signal.alpha;

      for (let i = 0; i < signal.data.length; i++) {
        const x = padding.left + (i / (signal.data.length - 1)) * chartWidth;
        const y = padding.top + chartHeight - (signal.data[i] / 100) * chartHeight;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          // Smooth curves using quadratic bezier
          const prevX = padding.left + ((i - 1) / (signal.data.length - 1)) * chartWidth;
          const prevY = padding.top + chartHeight - (signal.data[i - 1] / 100) * chartHeight;
          const midX = (prevX + x) / 2;
          ctx.quadraticCurveTo(prevX, prevY, midX, (prevY + y) / 2);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw area fill (subtle)
      ctx.globalAlpha = 0.05;
      const lastX = padding.left + chartWidth;
      const lastY = padding.top + chartHeight - (signal.data[signal.data.length - 1] / 100) * chartHeight;
      ctx.lineTo(lastX, lastY);
      ctx.lineTo(lastX, padding.top + chartHeight);
      ctx.lineTo(padding.left, padding.top + chartHeight);
      ctx.closePath();
      ctx.fillStyle = signal.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ============================================================
  // START
  // ============================================================

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
