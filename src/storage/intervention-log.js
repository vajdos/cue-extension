/**
 * Cue — Intervention Log
 *
 * The core moat dataset. Every non-CONTINUE decision is recorded with
 * full signal state before, the decision, and downstream outcomes.
 *
 * Schema (per record):
 *   {
 *     id:          'int-<timestamp>',
 *     sessionId:   string,
 *     timestamp:   Date.now(),
 *     decision:    'PAUSE' | 'ASK_QUESTION',
 *     signalState: { speakingRatio, pace, tension, energy, questionCount, ... },
 *     meta:        { reason, ... },
 *     delivered:   boolean (was the haptic / nudge actually shown),
 *     outcome: {
 *       measured:           boolean,
 *       behavior_changed:   boolean | null,  // did user modify behavior in next 30s
 *       post_speaking_ratio: number | null,
 *       post_question_count: number | null,
 *       time_to_response_sec: number | null,
 *     }
 *   }
 *
 * Storage: chrome.storage.local under key 'cueInterventions', capped at 500 entries.
 * This lives in chrome.storage (not IndexedDB) because the offscreen context
 * needs fast read-write access and the dataset is small per user.
 *
 * The OUTCOME is measured asynchronously 30 seconds after delivery, by the
 * caller. This log is append-only at first; the outcome fields are patched
 * in later when the observation window closes.
 */

const CueInterventionLog = (function () {

  const STORAGE_KEY = 'cueInterventions';
  const MAX_ENTRIES = 500;
  const OUTCOME_WINDOW_SEC = 30;

  // v1.1.41 — guard chrome.storage access. The intervention-log module is
  // listed in web_accessible_resources and content_scripts, and can be
  // loaded by HTML surfaces (panel.html, offscreen.html) at script-tag
  // time. In some load orderings the chrome.* APIs aren't yet defined,
  // producing a "Cannot read properties of undefined (reading 'local')"
  // when _write is called before the extension context fully initializes.
  // The guard makes the module silently no-op in that case; callers see
  // an empty-array read and a swallowed write, which is the right
  // behavior — there's no other useful place to persist.
  function _storageAvailable() {
    return typeof chrome !== 'undefined'
      && chrome.storage
      && chrome.storage.local
      && typeof chrome.storage.local.get === 'function';
  }

  async function _read() {
    if (!_storageAvailable()) return [];
    try {
      const res = await chrome.storage.local.get([STORAGE_KEY]);
      return Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
    } catch (e) { return []; }
  }

  async function _write(list) {
    if (!_storageAvailable()) return;
    try {
      // Cap to prevent unbounded growth
      const trimmed = list.length > MAX_ENTRIES ? list.slice(-MAX_ENTRIES) : list;
      await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
    } catch (e) { console.warn('[Log] Write failed:', e); }
  }

  /**
   * Append a new intervention record. Returns the record id.
   */
  async function record(sessionId, decision, signalState, meta = {}) {
    const now = Date.now();
    const id = 'int-' + now + '-' + Math.random().toString(36).slice(2, 6);
    const entry = {
      id,
      sessionId,
      timestamp: now,
      decision,
      signalState,
      meta,
      delivered: false,
      outcome: {
        measured: false,
        behavior_changed: null,
        post_speaking_ratio: null,
        post_question_count: null,
        time_to_response_sec: null,
      },
    };

    const list = await _read();
    list.push(entry);
    await _write(list);
    return id;
  }

  /**
   * Mark a delivered intervention (UI was actually shown).
   */
  async function markDelivered(id) {
    const list = await _read();
    const e = list.find(x => x.id === id);
    if (e) {
      e.delivered = true;
      await _write(list);
    }
  }

  /**
   * Called ~30s after an intervention. Compares post-intervention signal state
   * to pre-intervention state and determines whether behavior changed.
   *
   * Heuristics:
   *   - For PAUSE: behavior_changed if post_speaking_ratio < pre_speaking_ratio by >0.10
   *   - For ASK_QUESTION: behavior_changed if questionCount increased
   */
  async function recordOutcome(id, postSignal) {
    const list = await _read();
    const e = list.find(x => x.id === id);
    if (!e) return;

    const pre = e.signalState;
    const outcome = e.outcome;
    outcome.measured = true;
    outcome.post_speaking_ratio = postSignal.speakingRatio;
    outcome.post_question_count = postSignal.questionCount;
    outcome.time_to_response_sec = (Date.now() - e.timestamp) / 1000;

    if (e.decision === 'PAUSE') {
      outcome.behavior_changed = (pre.speakingRatio - postSignal.speakingRatio) > 0.10;
    } else if (e.decision === 'ASK_QUESTION') {
      outcome.behavior_changed = postSignal.questionCount > pre.questionCount;
    } else {
      outcome.behavior_changed = null;
    }

    await _write(list);
    console.log('[Log] Outcome recorded for', id,
      'behavior_changed=', outcome.behavior_changed);
  }

  async function getAll() { return await _read(); }

  async function getBySession(sessionId) {
    const list = await _read();
    return list.filter(x => x.sessionId === sessionId);
  }

  /**
   * Compute the success metric (spec §11): behavior change per meeting.
   */
  async function computeSuccessMetric() {
    const list = await _read();
    const measured = list.filter(x => x.outcome.measured);
    if (measured.length === 0) return { rate: null, total: 0, changed: 0 };
    const changed = measured.filter(x => x.outcome.behavior_changed === true).length;
    return {
      rate: changed / measured.length,
      total: measured.length,
      changed,
      breakdown: {
        PAUSE: measured.filter(x => x.decision === 'PAUSE' && x.outcome.behavior_changed).length,
        ASK_QUESTION: measured.filter(x => x.decision === 'ASK_QUESTION' && x.outcome.behavior_changed).length,
      }
    };
  }

  async function clear() {
    await chrome.storage.local.remove([STORAGE_KEY]);
  }

  return {
    record,
    markDelivered,
    recordOutcome,
    getAll,
    getBySession,
    computeSuccessMetric,
    clear,
    OUTCOME_WINDOW_SEC,
  };
})();
