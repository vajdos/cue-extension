/**
 * Cue — IndexedDB Storage Layer
 *
 * Stores session data and signal frames locally in the browser.
 * Zero data leaves the device.
 *
 * Object stores:
 *   - sessions: { id, startTime, endTime, duration, eqScore, nudgeCount, nudgeHistory, baseline }
 *   - signalFrames: { id, sessionId, timestamp, tension, pace, energy, isSpeech }
 */

const CueDB = (function () {
  const DB_NAME = 'CueDB';
  const DB_VERSION = 1;

  let _db = null;

  /**
   * Open (or create) the database.
   */
  function open() {
    return new Promise((resolve, reject) => {
      if (_db) {
        resolve(_db);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('startTime', 'startTime', { unique: false });
        }

        // Signal frames store (1 per second during calls)
        if (!db.objectStoreNames.contains('signalFrames')) {
          const frameStore = db.createObjectStore('signalFrames', { keyPath: 'id', autoIncrement: true });
          frameStore.createIndex('sessionId', 'sessionId', { unique: false });
          frameStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        console.log('[CueDB] Database schema created.');
      };

      request.onsuccess = (event) => {
        _db = event.target.result;
        console.log('[CueDB] Database opened.');
        resolve(_db);
      };

      request.onerror = (event) => {
        console.error('[CueDB] Failed to open database:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Save a new session record.
   */
  async function saveSession(session) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put(session);
      tx.oncomplete = () => {
        console.log('[CueDB] Session saved:', session.id);
        resolve();
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get a session by ID.
   */
  async function getSession(sessionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').get(sessionId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get all sessions, sorted by startTime descending.
   */
  async function getAllSessions() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly');
      const request = tx.objectStore('sessions').getAll();
      request.onsuccess = () => {
        const sessions = request.result || [];
        sessions.sort((a, b) => b.startTime - a.startTime);
        resolve(sessions);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get the most recent session.
   */
  async function getLatestSession() {
    const sessions = await getAllSessions();
    return sessions.length > 0 ? sessions[0] : null;
  }

  /**
   * Get the previous session (second most recent).
   */
  async function getPreviousSession() {
    const sessions = await getAllSessions();
    return sessions.length > 1 ? sessions[1] : null;
  }

  /**
   * Store a signal frame (called ~1/sec during active call).
   */
  async function addFrame(frame) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('signalFrames', 'readwrite');
      tx.objectStore('signalFrames').add(frame);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Store multiple frames at once (batch insert).
   */
  async function addFrames(frames) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('signalFrames', 'readwrite');
      const store = tx.objectStore('signalFrames');
      for (const frame of frames) {
        store.add(frame);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get all frames for a session.
   */
  async function getFrames(sessionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('signalFrames', 'readonly');
      const index = tx.objectStore('signalFrames').index('sessionId');
      const request = index.getAll(sessionId);
      request.onsuccess = () => {
        const frames = request.result || [];
        frames.sort((a, b) => a.timestamp - b.timestamp);
        resolve(frames);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete all frames for a session (cleanup).
   */
  async function deleteFrames(sessionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('signalFrames', 'readwrite');
      const index = tx.objectStore('signalFrames').index('sessionId');
      const request = index.openCursor(sessionId);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete old sessions (keep only the last N).
   */
  async function pruneOldSessions(keepCount = 20) {
    const sessions = await getAllSessions();
    if (sessions.length <= keepCount) return;

    const toDelete = sessions.slice(keepCount);
    for (const session of toDelete) {
      await deleteFrames(session.id);
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').delete(session.id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      });
    }
    console.log('[CueDB] Pruned', toDelete.length, 'old sessions.');
  }

  return {
    open,
    saveSession,
    getSession,
    getAllSessions,
    getLatestSession,
    getPreviousSession,
    addFrame,
    addFrames,
    getFrames,
    deleteFrames,
    pruneOldSessions
  };
})();
