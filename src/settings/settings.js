/**
 * Cue — Settings Page
 * Manages nudge customization, thresholds, timing, and cross-device sync.
 */

(async function () {
  'use strict';

  const DEFAULTS = {
    nudgePack: 'gentle',
    nudgeChannels: ['visual'],
    coachingIntensity: 'gentle',
    soundVolume: 40,
    hapticPattern: 'tap',
    thresholds: { pace: 70, tension: 75, longSpeech: 45 },
    timing: { grace: 30, cooldown: 30 },
    syncEmail: '',
  };

  // ---- Load saved settings ----
  let settings = { ...DEFAULTS };
  try {
    const stored = await chrome.storage.local.get(['cueSettings', 'cueLastSync']);
    if (stored.cueSettings) {
      settings = { ...DEFAULTS, ...stored.cueSettings };
    }
    if (stored.cueLastSync) {
      showSyncStatus(stored.cueLastSync);
    }
  } catch (e) {}

  // ---- Populate UI from settings ----

  // Nudge pack
  const packRadio = document.querySelector(`input[name="nudgePack"][value="${settings.nudgePack}"]`);
  if (packRadio) packRadio.checked = true;

  // v1.1.7 — Tone flavor (for playful pack)
  const flavor = settings.toneFlavor || 'neutral';
  const flavorRadio = document.querySelector(`input[name="toneFlavor"][value="${flavor}"]`);
  if (flavorRadio) flavorRadio.checked = true;

  // Coaching intensity
  const ciRadio = document.querySelector(`input[name="coachingIntensity"][value="${settings.coachingIntensity || 'gentle'}"]`);
  if (ciRadio) ciRadio.checked = true;

  // Channels
  const channels = settings.nudgeChannels || ['visual'];
  if (channels.includes('notification')) document.getElementById('ch-notification').checked = true;
  if (channels.includes('sound')) {
    document.getElementById('ch-sound').checked = true;
    document.getElementById('volume-row').style.display = 'flex';
  }
  if (channels.includes('haptic')) {
    document.getElementById('ch-haptic').checked = true;
    document.getElementById('haptic-section').style.display = 'block';
  }

  // Sound volume
  document.getElementById('sound-volume').value = settings.soundVolume || 40;

  // Haptic pattern
  const hapticRadio = document.querySelector(`input[name="hapticPattern"][value="${settings.hapticPattern || 'tap'}"]`);
  if (hapticRadio) hapticRadio.checked = true;

  // Thresholds
  const t = settings.thresholds || DEFAULTS.thresholds;
  setSlider('thresh-pace', t.pace, v => v);
  setSlider('thresh-tension', t.tension, v => v);
  setSlider('thresh-speech', t.longSpeech, v => v + 's');

  // Timing
  const tm = settings.timing || DEFAULTS.timing;
  setSlider('timing-grace', tm.grace, v => v + 's');
  setSlider('timing-cooldown', tm.cooldown, v => v + 's');

  // Sync email
  document.getElementById('sync-email').value = settings.syncEmail || '';

  // If hash is #sync, scroll to sync section
  if (window.location.hash === '#sync') {
    document.getElementById('sync-section').scrollIntoView({ behavior: 'smooth' });
  }

  // ---- Event Listeners ----

  // v1.1.7 — Show/hide the playful tone-flavor selector based on chosen pack
  function refreshFlavorVisibility() {
    const playfulSelected = document.querySelector('input[name="nudgePack"]:checked')?.value === 'playful';
    const flavorCard = document.getElementById('tone-flavor-card');
    if (flavorCard) flavorCard.style.display = playfulSelected ? '' : 'none';
  }
  refreshFlavorVisibility();

  // Nudge pack change
  document.querySelectorAll('input[name="nudgePack"]').forEach(radio => {
    radio.addEventListener('change', () => { refreshFlavorVisibility(); save(); });
  });

  // v1.1.7 — Tone flavor selector (only matters when 'playful' pack is active)
  document.querySelectorAll('input[name="toneFlavor"]').forEach(radio => {
    radio.addEventListener('change', () => save());
  });

  // Channel toggles
  document.getElementById('ch-sound').addEventListener('change', (e) => {
    document.getElementById('volume-row').style.display = e.target.checked ? 'flex' : 'none';
    save();
  });

  document.getElementById('ch-haptic').addEventListener('change', (e) => {
    document.getElementById('haptic-section').style.display = e.target.checked ? 'block' : 'none';
    save();
  });

  document.getElementById('ch-notification').addEventListener('change', () => save());

  // Volume
  document.getElementById('sound-volume').addEventListener('input', () => save());

  // Haptic pattern
  document.querySelectorAll('input[name="hapticPattern"]').forEach(radio => {
    radio.addEventListener('change', () => save());
  });

  // Sliders
  ['thresh-pace', 'thresh-tension', 'thresh-speech', 'timing-grace', 'timing-cooldown'].forEach(id => {
    const el = document.getElementById(id);
    const suffix = id.startsWith('thresh-speech') || id.startsWith('timing') ? 's' : '';
    el.addEventListener('input', () => {
      document.getElementById(id + '-val').textContent = el.value + suffix;
      save();
    });
  });

  // Sync button
  document.getElementById('sync-btn').addEventListener('click', async () => {
    const email = document.getElementById('sync-email').value.trim();
    if (!email || !email.includes('@')) {
      document.getElementById('sync-email').style.borderColor = '#C93400';
      return;
    }
    document.getElementById('sync-email').style.borderColor = '';

    const btn = document.getElementById('sync-btn');
    btn.textContent = 'Syncing...';
    btn.disabled = true;

    try {
      // Save email first
      settings.syncEmail = email;
      await save();

      // Send sync request via service worker
      const response = await chrome.runtime.sendMessage({ type: 'syncNow', email });

      if (response && response.ok) {
        showSyncStatus(response.lastSync || new Date().toISOString());
        btn.textContent = 'Synced!';
        setTimeout(() => { btn.textContent = 'Sync Now'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = 'Retry';
        btn.disabled = false;
      }
    } catch (e) {
      console.error('[Cue Settings] Sync failed:', e);
      btn.textContent = 'Retry';
      btn.disabled = false;
    }
  });

  // Reset
  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!confirm('Reset all Cue settings to defaults?')) return;
    await chrome.storage.local.remove(['cueSettings']);
    window.location.reload();
  });

  // ---- Helper Functions ----

  function setSlider(id, value, formatter) {
    const el = document.getElementById(id);
    el.value = value;
    document.getElementById(id + '-val').textContent = formatter(value);
  }

  async function save() {
    const pack = document.querySelector('input[name="nudgePack"]:checked')?.value || 'gentle';
    // v1.1.7 — playful sub-flavor; ignored unless pack === 'playful'
    const flavor = document.querySelector('input[name="toneFlavor"]:checked')?.value || 'neutral';
    const intensity = document.querySelector('input[name="coachingIntensity"]:checked')?.value || 'gentle';

    const ch = ['visual'];
    if (document.getElementById('ch-notification').checked) ch.push('notification');
    if (document.getElementById('ch-sound').checked) ch.push('sound');
    if (document.getElementById('ch-haptic').checked) ch.push('haptic');

    const haptic = document.querySelector('input[name="hapticPattern"]:checked')?.value || 'tap';

    settings = {
      nudgePack: pack,
      toneFlavor: flavor,    // v1.1.7
      nudgeChannels: ch,
      coachingIntensity: intensity,
      soundVolume: parseInt(document.getElementById('sound-volume').value),
      hapticPattern: haptic,
      thresholds: {
        pace: parseInt(document.getElementById('thresh-pace').value),
        tension: parseInt(document.getElementById('thresh-tension').value),
        longSpeech: parseInt(document.getElementById('thresh-speech').value),
      },
      timing: {
        grace: parseInt(document.getElementById('timing-grace').value),
        cooldown: parseInt(document.getElementById('timing-cooldown').value),
      },
      syncEmail: document.getElementById('sync-email').value.trim(),
    };

    await chrome.storage.local.set({ cueSettings: settings });
  }

  function showSyncStatus(isoDate) {
    const el = document.getElementById('sync-status');
    el.style.display = 'flex';
    const d = new Date(isoDate);
    document.getElementById('sync-status-text').textContent =
      'Last synced: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ========================================================================
  // INTERVENTION LOG EXPORT (v1.0 moat dataset)
  // ========================================================================

  async function refreshExportStats() {
    const statEl = document.getElementById('export-count');
    if (!statEl || typeof CueInterventionLog === 'undefined') return;
    try {
      const list = await CueInterventionLog.getAll();
      const measured = list.filter(x => x.outcome.measured).length;
      const changed = list.filter(x => x.outcome.behavior_changed === true).length;
      const rate = measured > 0 ? Math.round((changed / measured) * 100) : null;
      statEl.textContent = `${list.length} intervention${list.length === 1 ? '' : 's'} recorded` +
        (measured > 0 ? ` \u00B7 ${rate}% behavior-change rate (${changed}/${measured} measured)` : '');
    } catch (e) {
      statEl.textContent = 'Log unavailable';
    }
  }

  function interventionsToCsv(list) {
    const header = [
      'id', 'sessionId', 'timestamp', 'iso_time', 'decision', 'reason',
      'pre_speakingRatio', 'pre_pace', 'pre_tension', 'pre_energy',
      'pre_questionCount', 'pre_secSinceLastQuestion', 'pre_interruptionCount',
      'delivered', 'outcome_measured', 'behavior_changed',
      'post_speakingRatio', 'post_questionCount', 'time_to_response_sec'
    ];
    const rows = list.map(e => [
      e.id, e.sessionId, e.timestamp, new Date(e.timestamp).toISOString(),
      e.decision, (e.meta && e.meta.reason) || '',
      e.signalState.speakingRatio, e.signalState.pace, e.signalState.tension, e.signalState.energy,
      e.signalState.questionCount, e.signalState.secSinceLastQuestion, e.signalState.interruptionCount,
      e.delivered, e.outcome.measured, e.outcome.behavior_changed,
      e.outcome.post_speaking_ratio, e.outcome.post_question_count, e.outcome.time_to_response_sec
    ]);
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
  }

  async function exportCsv() {
    if (typeof CueInterventionLog === 'undefined') {
      alert('Intervention log not loaded.');
      return;
    }
    const list = await CueInterventionLog.getAll();
    if (!list || list.length === 0) {
      alert('No interventions yet. Use Cue for a few sessions to build the dataset.');
      return;
    }
    const csv = interventionsToCsv(list);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cue-interventions-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function clearLog() {
    if (!confirm('Delete all intervention history? This cannot be undone.')) return;
    if (typeof CueInterventionLog !== 'undefined') {
      await CueInterventionLog.clear();
    }
    await refreshExportStats();
  }

  // Wire up buttons
  const exportBtn = document.getElementById('export-csv-btn');
  const clearBtn = document.getElementById('clear-log-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportCsv);
  if (clearBtn) clearBtn.addEventListener('click', clearLog);

  // Populate stats on load
  refreshExportStats();

})();
