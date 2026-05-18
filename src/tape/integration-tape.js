/**
 * Cue — Integration Tape Data Aggregator
 *
 * Pulls session data from IndexedDB and computes everything needed
 * for the post-call Integration Tape page.
 *
 * Output: a single tape object with EQ score, emotional arc data,
 * "The Moment You Missed", micro-skill, and comparison to previous call.
 */

const CueIntegrationTape = (function () {

  /**
   * Generate a complete tape for a session.
   *
   * @param {string} sessionId - The session to analyze
   * @returns {Object} Full tape data for rendering
   */
  async function generate(sessionId) {
    try {
      const session = await CueDB.getSession(sessionId);
      if (!session) {
        console.error('[CueTape] Session not found:', sessionId);
        return null;
      }

      const frames = await CueDB.getFrames(sessionId);
      if (!frames || frames.length === 0) {
        console.error('[CueTape] No frames found for session:', sessionId);
        return null;
      }

      const nudgeHistory = session.nudgeHistory || [];

      // Compute EQ score
      const eqScore = CueEQScore.compute(frames, nudgeHistory);

      // Find "The Moment You Missed"
      const missedMoment = CueEQScore.findMissedMoment(frames);

      // v1.1.6 — Find the BEST moment for positive feedback. Every session ends
      // on a recognition note before the "what to fix" callout.
      const bestMoment = (typeof CueEQScore.findBestMoment === 'function')
        ? CueEQScore.findBestMoment(frames)
        : null;

      // Get micro-skill recommendation
      const microSkill = CueEQScore.getMicroSkill(eqScore, nudgeHistory);

      // Build emotional arc data (for the chart)
      const emotionalArc = buildEmotionalArc(frames);

      // Get previous session for comparison
      const previousSession = await CueDB.getPreviousSession();
      let comparison = null;
      if (previousSession && previousSession.id !== sessionId) {
        comparison = {
          previousScore: previousSession.eqScore || null,
          previousDate: previousSession.startTime,
          previousDuration: previousSession.duration,
          delta: previousSession.eqScore
            ? eqScore.total - previousSession.eqScore
            : null
        };
      }

      // Compute session stats
      const durationMin = Math.round((session.endTime - session.startTime) / 60000);
      const speechFrames = frames.filter(f => f.isSpeech).length;
      const speechRatio = Math.round((speechFrames / frames.length) * 100);

      // Nudge breakdown
      const nudgeBreakdown = {
        pace: nudgeHistory.filter(n => n.type === 'pace').length,
        tension: nudgeHistory.filter(n => n.type === 'tension').length,
        long_speech: nudgeHistory.filter(n => n.type === 'long_speech').length,
        escalation: nudgeHistory.filter(n => n.type === 'escalation').length
      };

      // v1.1.0 — pull source mode + replicant baseline so the tape can label
      // "Your" vs "Their" vs "Conversation" and show the user's evolving replicant.
      const sourceMode = session.source || 'mic';
      let replicant = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const stored = await chrome.storage.local.get('cueReplicantBaseline');
          if (stored.cueReplicantBaseline) replicant = stored.cueReplicantBaseline;
        }
      } catch (e) { /* fail silent — tape still renders without replicant block */ }

      const tape = {
        sessionId: session.id,
        date: new Date(session.startTime).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }),
        time: new Date(session.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit'
        }),
        durationMin,
        speechRatio,
        eqScore,
        emotionalArc,
        missedMoment,
        microSkill,
        nudgeBreakdown,
        nudgeHistory,
        comparison,
        frameCount: frames.length,
        bestMoment,  // v1.1.6 — positive recognition

        // v1.1.0 mode-aware fields
        source: sourceMode,                                                    // 'mic' | 'tab' | 'both'
        sourceLabel: sourceMode === 'tab' ? 'Their'
                  : sourceMode === 'both' ? 'Conversation'
                  : 'Your',
        sourceContext: sourceMode === 'tab'
            ? 'Cue analyzed the remote party — this score reflects their speech patterns, not yours.'
          : sourceMode === 'both'
            ? 'Cue analyzed both streams. EQ score reflects your speech; interruption metrics reflect both.'
            : null,                                                            // null = "Me" mode (default, no extra context needed)

        // v1.1.0 replicant trend snapshot
        replicant: replicant
          ? {
              sessionCount: replicant.sessionCount || 0,
              isPopulationDefault: !!replicant.isPopulationDefault,
              updatedAt: replicant.updatedAt || null,
              convergenceProgress: Math.min(1, (replicant.sessionCount || 0) / 10),  // ~10 sessions to fully converge
            }
          : null,
      };

      console.log('[CueTape] Tape generated:', tape);
      return tape;

    } catch (err) {
      console.error('[CueTape] Failed to generate tape:', err);
      return null;
    }
  }

  /**
   * Build the emotional arc — arrays of tension/pace/energy values
   * downsampled to ~60 data points for smooth chart rendering.
   */
  function buildEmotionalArc(frames) {
    const targetPoints = 60;
    const step = Math.max(1, Math.floor(frames.length / targetPoints));

    const arc = {
      timestamps: [],
      tension: [],
      pace: [],
      energy: [],
      speech: []
    };

    for (let i = 0; i < frames.length; i += step) {
      // Average frames within this step for smoothing
      const chunk = frames.slice(i, Math.min(i + step, frames.length));
      const avgTension = chunk.reduce((s, f) => s + f.tension, 0) / chunk.length;
      const avgPace = chunk.reduce((s, f) => s + f.pace, 0) / chunk.length;
      const avgEnergy = chunk.reduce((s, f) => s + f.energy, 0) / chunk.length;
      const speechCount = chunk.filter(f => f.isSpeech).length;

      arc.timestamps.push(i); // seconds into call
      arc.tension.push(Math.round(avgTension));
      arc.pace.push(Math.round(avgPace));
      arc.energy.push(Math.round(avgEnergy));
      arc.speech.push(speechCount / chunk.length > 0.5);
    }

    return arc;
  }

  /**
   * Generate tape for the most recent session.
   */
  async function generateLatest() {
    const session = await CueDB.getLatestSession();
    if (!session) {
      console.log('[CueTape] No sessions found.');
      return null;
    }
    return generate(session.id);
  }

  return {
    generate,
    generateLatest,
    buildEmotionalArc
  };
})();
