/**
 * Cue — Progress Page
 *
 * Shows EQ score trends, nudge frequency, skill progression,
 * streak tracking, and adaptive coaching path.
 */

(function () {
  'use strict';

  async function init() {
    try {
      const sessions = await CueDB.getAllSessions();

      if (!sessions || sessions.length < 2) {
        document.getElementById('pg-loading').style.display = 'none';
        document.getElementById('pg-insufficient').style.display = 'block';
        return;
      }

      // Sort oldest first for trend charts
      const sorted = [...sessions].sort((a, b) => a.startTime - b.startTime);

      document.getElementById('pg-loading').style.display = 'none';
      document.getElementById('pg-content').style.display = 'block';

      renderHero(sorted);
      renderScoreChart(sorted);
      renderNudgeChart(sorted);
      renderSkills(sorted);
      renderCoaching(sorted);
      renderSessionTable(sorted);

    } catch (err) {
      console.error('[Progress] Failed:', err);
      document.getElementById('pg-loading').style.display = 'none';
      document.getElementById('pg-insufficient').style.display = 'block';
    }
  }

  // ============================================================
  // HERO: Streak + Summary Stats
  // ============================================================

  function renderHero(sessions) {
    // Compute streak (consecutive sessions where score improved or held)
    let streak = 0;
    for (let i = sessions.length - 1; i > 0; i--) {
      if (sessions[i].eqScore >= sessions[i - 1].eqScore) {
        streak++;
      } else {
        break;
      }
    }

    document.getElementById('pg-streak').textContent = streak;
    if (streak === 0) {
      document.getElementById('pg-streak-sub').textContent = 'keep going — improvement is coming';
    } else if (streak === 1) {
      document.getElementById('pg-streak-sub').textContent = 'call with improvement';
    } else {
      document.getElementById('pg-streak-sub').textContent = 'consecutive improving calls';
    }

    // Summary stats
    document.getElementById('pg-total-calls').textContent = sessions.length;

    const scores = sessions.map(s => s.eqScore).filter(s => s != null);
    if (scores.length > 0) {
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const best = Math.round(Math.max(...scores));
      document.getElementById('pg-avg-score').textContent = avg;
      document.getElementById('pg-best-score').textContent = best;
    }

    const totalNudges = sessions.reduce((sum, s) => sum + (s.nudgeCount || 0), 0);
    document.getElementById('pg-total-nudges').textContent = totalNudges;
  }

  // ============================================================
  // EQ SCORE TREND CHART
  // ============================================================

  function renderScoreChart(sessions) {
    const canvas = document.getElementById('pg-score-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.parentElement.clientWidth || 800;
    const displayHeight = 280;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.scale(dpr, dpr);

    const pad = { top: 30, right: 20, bottom: 50, left: 45 };
    const cw = displayWidth - pad.left - pad.right;
    const ch = displayHeight - pad.top - pad.bottom;

    const scores = sessions.map(s => s.eqScore || 0);
    const dates = sessions.map(s => new Date(s.startTime));

    // Background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(pad.left, pad.top, cw, ch);

    // Grid
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y <= 100; y += 25) {
      const yPos = pad.top + ch - (y / 100) * ch;
      ctx.beginPath();
      ctx.moveTo(pad.left, yPos);
      ctx.lineTo(pad.left + cw, yPos);
      ctx.stroke();
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(y, pad.left - 8, yPos + 3);
    }

    // X-axis labels (dates)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9ca3af';
    const labelStep = Math.max(1, Math.floor(sessions.length / 6));
    for (let i = 0; i < sessions.length; i += labelStep) {
      const x = pad.left + (i / (sessions.length - 1)) * cw;
      const d = dates[i];
      ctx.fillText(
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        x, displayHeight - 15
      );
    }

    if (scores.length < 2) return;

    // Area fill
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + ch);
    for (let i = 0; i < scores.length; i++) {
      const x = pad.left + (i / (scores.length - 1)) * cw;
      const y = pad.top + ch - (scores[i] / 100) * ch;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.left + cw, pad.top + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
    grad.addColorStop(0, 'rgba(45, 212, 160, 0.15)');
    grad.addColorStop(1, 'rgba(45, 212, 160, 0.01)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = '#2DD4A0';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < scores.length; i++) {
      const x = pad.left + (i / (scores.length - 1)) * cw;
      const y = pad.top + ch - (scores[i] / 100) * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Dots
    for (let i = 0; i < scores.length; i++) {
      const x = pad.left + (i / (scores.length - 1)) * cw;
      const y = pad.top + ch - (scores[i] / 100) * ch;

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#2DD4A0';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Score label on dot
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(scores[i], x, y - 10);
    }
  }

  // ============================================================
  // NUDGE FREQUENCY CHART
  // ============================================================

  function renderNudgeChart(sessions) {
    const canvas = document.getElementById('pg-nudge-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = canvas.parentElement.clientWidth || 800;
    const displayHeight = 200;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 20, bottom: 40, left: 45 };
    const cw = displayWidth - pad.left - pad.right;
    const ch = displayHeight - pad.top - pad.bottom;

    const nudges = sessions.map(s => s.nudgeCount || 0);
    const maxNudge = Math.max(...nudges, 5);

    // Trend description
    const descEl = document.getElementById('pg-nudge-trend-desc');
    if (nudges.length >= 3) {
      const firstHalf = nudges.slice(0, Math.floor(nudges.length / 2));
      const secondHalf = nudges.slice(Math.floor(nudges.length / 2));
      const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      if (avgSecond < avgFirst * 0.8) {
        descEl.textContent = 'Your nudges are decreasing — you\'re building better habits.';
      } else if (avgSecond > avgFirst * 1.2) {
        descEl.textContent = 'Nudges are increasing — try focusing on one skill at a time.';
      } else {
        descEl.textContent = 'Nudge frequency is steady. Consistency is good — keep practicing.';
      }
    }

    // Background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(pad.left, pad.top, cw, ch);

    // Bar chart
    const barWidth = Math.min(40, (cw / nudges.length) * 0.6);
    const gap = (cw - barWidth * nudges.length) / (nudges.length + 1);

    for (let i = 0; i < nudges.length; i++) {
      const x = pad.left + gap + i * (barWidth + gap);
      const barH = (nudges[i] / maxNudge) * ch;
      const y = pad.top + ch - barH;

      // Bar
      const barGrad = ctx.createLinearGradient(x, y, x, pad.top + ch);
      barGrad.addColorStop(0, '#F59E0B');
      barGrad.addColorStop(1, '#FDE68A');
      ctx.fillStyle = barGrad;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, barWidth, barH, [4, 4, 0, 0]);
      } else {
        ctx.rect(x, y, barWidth, barH);
      }
      ctx.fill();

      // Value on top
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(nudges[i], x + barWidth / 2, y - 6);

      // Date below
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px "Segoe UI", sans-serif';
      const d = new Date(sessions[i].startTime);
      ctx.fillText(
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        x + barWidth / 2, displayHeight - 10
      );
    }
  }

  // ============================================================
  // SKILL PROGRESSION
  // ============================================================

  function renderSkills(sessions) {
    // Get first and latest breakdown
    const first = sessions[0];
    const latest = sessions[sessions.length - 1];

    const skills = [
      { key: 'tensionStability', prefix: 'tension', label: 'Tension Stability' },
      { key: 'strategicPausing', prefix: 'pausing', label: 'Strategic Pausing' },
      { key: 'energyRegulation', prefix: 'energy', label: 'Energy Regulation' }
    ];

    for (const skill of skills) {
      const firstVal = first.eqBreakdown ? first.eqBreakdown[skill.key] : null;
      const latestVal = latest.eqBreakdown ? latest.eqBreakdown[skill.key] : null;

      if (firstVal == null || latestVal == null) continue;

      const delta = latestVal - firstVal;
      const deltaEl = document.getElementById(`pg-${skill.prefix}-delta`);
      if (delta > 0) {
        deltaEl.textContent = '+' + delta;
        deltaEl.className = 'pg-skill-delta positive';
      } else if (delta < 0) {
        deltaEl.textContent = String(delta);
        deltaEl.className = 'pg-skill-delta negative';
      } else {
        deltaEl.textContent = '0';
        deltaEl.className = 'pg-skill-delta neutral';
      }

      document.getElementById(`pg-${skill.prefix}-first`).textContent = 'First: ' + firstVal;
      document.getElementById(`pg-${skill.prefix}-latest`).textContent = 'Latest: ' + latestVal;

      // Animate bar to latest value
      setTimeout(() => {
        document.getElementById(`pg-${skill.prefix}-bar`).style.width = latestVal + '%';
      }, 400);
    }
  }

  // ============================================================
  // ADAPTIVE COACHING PATH
  // ============================================================

  function renderCoaching(sessions) {
    const container = document.getElementById('pg-coaching');
    const latest = sessions[sessions.length - 1];

    // Determine coaching progression based on which skills need work
    const breakdown = latest.eqBreakdown || {};
    const scores = [
      { skill: 'The Power Pause', area: 'strategicPausing', score: breakdown.strategicPausing || 50, desc: 'Master strategic pausing — give space after key points to let ideas land.' },
      { skill: 'Pace Anchoring', area: 'tensionStability', score: breakdown.tensionStability || 50, desc: 'Control your speaking pace — slow down on your key words for emphasis.' },
      { skill: 'Vocal Grounding', area: 'tensionStability', score: breakdown.tensionStability || 50, desc: 'Keep your voice grounded — lower pitch signals calm authority.' },
      { skill: 'Energy Leveling', area: 'energyRegulation', score: breakdown.energyRegulation || 50, desc: 'Regulate your energy — stay in the 3-7 range, not 1-10.' },
      { skill: 'Box Breathing', area: 'tensionStability', score: breakdown.tensionStability || 50, desc: 'Use 4-4-4-4 breathing to reset during high-intensity moments.' },
      { skill: 'Active Listening', area: 'strategicPausing', score: breakdown.strategicPausing || 50, desc: 'Listen to understand, not to respond — pause before your reply.' }
    ];

    // Sort: lowest score skills first (most needed)
    scores.sort((a, b) => a.score - b.score);

    // First item = current focus, completed = score > 70, locked = future
    let hasFoundCurrent = false;
    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      const card = document.createElement('div');
      card.className = 'pg-coach-card';

      let status;
      if (s.score >= 70 && hasFoundCurrent) {
        status = 'completed';
        card.classList.add('completed');
      } else if (s.score >= 70) {
        status = 'completed';
        card.classList.add('completed');
      } else if (!hasFoundCurrent) {
        status = 'current';
        card.classList.add('current');
        hasFoundCurrent = true;
      } else {
        status = 'up next';
        card.classList.add('locked');
      }

      card.innerHTML = `
        <div class="pg-coach-status">${status === 'completed' ? 'Completed' : status === 'current' ? 'Current Focus' : 'Up Next'}</div>
        <div class="pg-coach-name">${s.skill}</div>
        <div class="pg-coach-desc">${s.desc}</div>
      `;

      container.appendChild(card);
    }
  }

  // ============================================================
  // SESSION TABLE
  // ============================================================

  function renderSessionTable(sessions) {
    const table = document.getElementById('pg-session-table');

    // Header
    const header = document.createElement('div');
    header.className = 'pg-session-row header';
    header.innerHTML = `
      <span>Date</span>
      <span>Duration</span>
      <span>Score</span>
      <span>Nudges</span>
      <span>Change</span>
    `;
    table.appendChild(header);

    // Rows (newest first)
    const reversed = [...sessions].reverse();
    for (let i = 0; i < reversed.length; i++) {
      const s = reversed[i];
      const row = document.createElement('div');
      row.className = 'pg-session-row';

      const date = new Date(s.startTime);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      const durationMin = s.duration ? Math.round(s.duration / 60000) : 0;
      const durationStr = durationMin > 0 ? durationMin + ' min' : '<1 min';

      const score = s.eqScore != null ? Math.round(s.eqScore) : '--';
      const scoreClass = score >= 75 ? 'great' : score >= 50 ? 'good' : 'fair';

      // Delta vs previous
      let deltaStr = '--';
      let deltaClass = 'flat';
      if (i < reversed.length - 1 && reversed[i + 1].eqScore != null && s.eqScore != null) {
        const d = Math.round(s.eqScore - reversed[i + 1].eqScore);
        if (d > 0) { deltaStr = '+' + d; deltaClass = 'up'; }
        else if (d < 0) { deltaStr = String(d); deltaClass = 'down'; }
        else { deltaStr = '0'; deltaClass = 'flat'; }
      }

      row.innerHTML = `
        <span class="pg-session-date">${dateStr} ${timeStr}</span>
        <span class="pg-session-duration">${durationStr}</span>
        <span class="pg-session-score ${typeof score === 'number' ? scoreClass : ''}">${score}</span>
        <span class="pg-session-nudges">${s.nudgeCount || 0}</span>
        <span class="pg-session-delta ${deltaClass}">${deltaStr}</span>
      `;

      row.addEventListener('click', () => {
        const tapeUrl = chrome.runtime.getURL('tape/tape.html') + '?session=' + s.id;
        window.open(tapeUrl, '_blank');
      });

      table.appendChild(row);
    }
  }

  // ============================================================
  // ============================================================
  // INTERVENTION SUCCESS METRIC (v1.0 moat visibility)
  // ============================================================

  async function renderInterventionSuccess() {
    if (typeof CueInterventionLog === 'undefined') return;
    try {
      const metric = await CueInterventionLog.computeSuccessMetric();
      const all = await CueInterventionLog.getAll();

      const rateEl = document.getElementById('pg-success-rate');
      const subEl = document.getElementById('pg-success-sub');
      const pauseRateEl = document.getElementById('pg-pause-rate');
      const pauseSubEl = document.getElementById('pg-pause-sub');
      const askRateEl = document.getElementById('pg-ask-rate');
      const askSubEl = document.getElementById('pg-ask-sub');

      if (!metric || metric.total === 0) {
        if (rateEl) rateEl.textContent = '—';
        if (subEl) subEl.textContent = 'no interventions yet';
        return;
      }

      const pct = Math.round(metric.rate * 100);
      if (rateEl) rateEl.textContent = pct + '%';
      if (subEl) subEl.textContent = metric.changed + '/' + metric.total + ' interventions';

      const pauseTotal = all.filter(x => x.decision === 'PAUSE' && x.outcome.measured).length;
      const pauseChanged = metric.breakdown?.PAUSE || 0;
      const pausePct = pauseTotal > 0 ? Math.round((pauseChanged / pauseTotal) * 100) : null;
      if (pauseRateEl) pauseRateEl.textContent = pausePct !== null ? pausePct + '%' : '—';
      if (pauseSubEl) pauseSubEl.textContent = pauseTotal > 0 ? pauseChanged + '/' + pauseTotal + ' succeeded' : 'none yet';

      const askTotal = all.filter(x => x.decision === 'ASK_QUESTION' && x.outcome.measured).length;
      const askChanged = metric.breakdown?.ASK_QUESTION || 0;
      const askPct = askTotal > 0 ? Math.round((askChanged / askTotal) * 100) : null;
      if (askRateEl) askRateEl.textContent = askPct !== null ? askPct + '%' : '—';
      if (askSubEl) askSubEl.textContent = askTotal > 0 ? askChanged + '/' + askTotal + ' succeeded' : 'none yet';
    } catch (e) {
      console.warn('[Progress] Intervention metric failed:', e);
    }
  }

  // Expose on window so init() can call it
  window.__renderInterventionSuccess = renderInterventionSuccess;

  // Hook into init flow — we call this after sessions render
  const origInit = init;
  init = async function () {
    await origInit();
    await renderInterventionSuccess();
  };

  // ============================================================
  // START
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
