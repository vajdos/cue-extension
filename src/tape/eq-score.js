/**
 * Cue — EQ Score Calculator
 *
 * Computes an Emotional Intelligence score (0-100) from session signal data.
 *
 * EQ Score Components:
 *   - Tension Stability (35%): How well you kept tension from spiking
 *   - Strategic Pausing (35%): Did you take pauses? How often?
 *   - Energy Regulation (30%): Consistent energy, not manic swings
 *
 * Higher = better self-regulation during the call.
 */

const CueEQScore = (function () {

  /**
   * Compute EQ score from an array of signal frames.
   *
   * @param {Array} frames - Array of { tension, pace, energy, isSpeech, timestamp }
   * @param {Array} nudgeHistory - Array of nudge events from the session
   * @returns {Object} - { total, tensionStability, strategicPausing, energyRegulation, details }
   */
  function compute(frames, nudgeHistory = []) {
    if (!frames || frames.length < 5) {
      return {
        total: 50,
        tensionStability: 50,
        strategicPausing: 50,
        energyRegulation: 50,
        details: { message: 'Not enough data for scoring' }
      };
    }

    // Only analyze frames where speech is detected
    const speechFrames = frames.filter(f => f.isSpeech);
    const silenceFrames = frames.filter(f => !f.isSpeech);

    // ---- 1. Tension Stability (35%) ----
    // Measures how stable tension was — fewer/lower spikes = better
    const tensionStability = computeTensionStability(speechFrames, frames);

    // ---- 2. Strategic Pausing (35%) ----
    // Measures natural pause frequency and distribution
    const strategicPausing = computeStrategicPausing(frames, nudgeHistory);

    // ---- 3. Energy Regulation (30%) ----
    // Measures energy consistency — low variance = better
    const energyRegulation = computeEnergyRegulation(speechFrames);

    // Weighted total
    const total = Math.round(
      tensionStability * 0.35 +
      strategicPausing * 0.35 +
      energyRegulation * 0.30
    );

    return {
      total: Math.max(0, Math.min(100, total)),
      tensionStability: Math.round(tensionStability),
      strategicPausing: Math.round(strategicPausing),
      energyRegulation: Math.round(energyRegulation),
      details: {
        speechFrameCount: speechFrames.length,
        totalFrameCount: frames.length,
        speechRatio: speechFrames.length / frames.length,
        nudgeCount: nudgeHistory.length
      }
    };
  }

  /**
   * Tension Stability Score (0-100)
   * 100 = perfectly stable, low tension throughout
   * 0 = constant high tension spikes
   */
  function computeTensionStability(speechFrames, allFrames) {
    if (speechFrames.length < 3) return 50;

    const tensions = speechFrames.map(f => f.tension);

    // Mean tension (lower = better)
    const meanTension = tensions.reduce((a, b) => a + b, 0) / tensions.length;

    // Tension variance (lower = more stable)
    const variance = tensions.reduce((sum, t) => sum + Math.pow(t - meanTension, 2), 0) / tensions.length;
    const stdDev = Math.sqrt(variance);

    // Count tension spikes (frames > 75)
    const spikeCount = tensions.filter(t => t > 75).length;
    const spikeRatio = spikeCount / tensions.length;

    // Score: penalize high mean, high variance, and frequent spikes
    let score = 100;
    score -= meanTension * 0.4;           // High mean tension reduces score
    score -= stdDev * 0.6;                // High variability reduces score
    score -= spikeRatio * 30;             // Frequent spikes reduce score

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Strategic Pausing Score (0-100)
   * 100 = natural pause rhythm, good listen-to-speak ratio
   * 0 = constant unbroken speech, no pauses
   */
  function computeStrategicPausing(frames, nudgeHistory) {
    if (frames.length < 5) return 50;

    // Count pause segments (consecutive silence frames)
    let pauseCount = 0;
    let inPause = false;
    let longestSpeechRun = 0;
    let currentSpeechRun = 0;
    let speechRuns = [];

    for (const frame of frames) {
      if (frame.isSpeech) {
        currentSpeechRun++;
        if (inPause) {
          inPause = false;
        }
      } else {
        if (currentSpeechRun > 0) {
          speechRuns.push(currentSpeechRun);
          if (currentSpeechRun > longestSpeechRun) {
            longestSpeechRun = currentSpeechRun;
          }
          currentSpeechRun = 0;
        }
        if (!inPause) {
          pauseCount++;
          inPause = true;
        }
      }
    }
    // Don't forget last speech run
    if (currentSpeechRun > 0) {
      speechRuns.push(currentSpeechRun);
      if (currentSpeechRun > longestSpeechRun) {
        longestSpeechRun = currentSpeechRun;
      }
    }

    const totalFrames = frames.length;
    const speechFrameCount = frames.filter(f => f.isSpeech).length;
    const speechRatio = speechFrameCount / totalFrames;

    // Ideal speech ratio: 50-70%
    // Too much speech = not listening, too little = not engaging
    let ratioScore;
    if (speechRatio >= 0.4 && speechRatio <= 0.7) {
      ratioScore = 100;
    } else if (speechRatio > 0.7) {
      ratioScore = Math.max(0, 100 - (speechRatio - 0.7) * 200);
    } else {
      ratioScore = Math.max(0, 100 - (0.4 - speechRatio) * 200);
    }

    // Penalize very long unbroken speech runs (>30 frames = ~30s)
    const longRunPenalty = longestSpeechRun > 30 ? Math.min(30, (longestSpeechRun - 30) * 2) : 0;

    // Bonus for having regular pauses
    const pauseFrequency = pauseCount / (totalFrames / 60); // pauses per minute
    const pauseBonus = Math.min(20, pauseFrequency * 3);

    // Penalty for long_speech nudges
    const longSpeechNudges = nudgeHistory.filter(n => n.type === 'long_speech').length;
    const nudgePenalty = longSpeechNudges * 10;

    let score = ratioScore + pauseBonus - longRunPenalty - nudgePenalty;
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Energy Regulation Score (0-100)
   * 100 = consistent, controlled energy
   * 0 = wild swings between loud and quiet
   */
  function computeEnergyRegulation(speechFrames) {
    if (speechFrames.length < 3) return 50;

    const energies = speechFrames.map(f => f.energy);

    // Mean energy
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;

    // Standard deviation (lower = more regulated)
    const variance = energies.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / energies.length;
    const stdDev = Math.sqrt(variance);

    // Frame-to-frame jitter (average absolute change between consecutive frames)
    let jitterSum = 0;
    for (let i = 1; i < energies.length; i++) {
      jitterSum += Math.abs(energies[i] - energies[i - 1]);
    }
    const avgJitter = jitterSum / (energies.length - 1);

    // Score: penalize high variance and high jitter
    let score = 100;
    score -= stdDev * 1.2;           // High variability reduces score
    score -= avgJitter * 1.5;        // Rapid changes reduce score

    // Bonus for keeping energy in a healthy mid-range (30-70)
    const inRangeCount = energies.filter(e => e >= 20 && e <= 70).length;
    const inRangeRatio = inRangeCount / energies.length;
    score += inRangeRatio * 15;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Find "The Moment You Missed" — the highest tension spike with no pause within 10 seconds.
   *
   * @param {Array} frames - Signal frames
   * @returns {Object|null} - { timestamp, tension, pace, energy, secondsIntoCall }
   */
  function findMissedMoment(frames) {
    if (!frames || frames.length < 10) return null;

    let worstMoment = null;
    let worstScore = 0;

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (!frame.isSpeech) continue;

      // Look for high tension with no pause nearby
      const tensionScore = frame.tension;
      if (tensionScore < 60) continue;

      // Check if there's a pause within +/- 10 frames (~10 seconds)
      let hasPauseNearby = false;
      for (let j = Math.max(0, i - 10); j < Math.min(frames.length, i + 10); j++) {
        if (!frames[j].isSpeech) {
          hasPauseNearby = true;
          break;
        }
      }

      // Score: higher tension + no pause = worse moment
      const momentScore = tensionScore + (hasPauseNearby ? 0 : 20) + (frame.pace * 0.3);

      if (momentScore > worstScore) {
        worstScore = momentScore;
        worstMoment = {
          frameIndex: i,
          timestamp: frame.timestamp,
          tension: Math.round(frame.tension),
          pace: Math.round(frame.pace),
          energy: Math.round(frame.energy),
          secondsIntoCall: i, // frames are ~1/sec
          hadPauseNearby: hasPauseNearby
        };
      }
    }

    return worstMoment;
  }

  /**
   * v1.1.3 — Find the BEST moment of the call. The mirror of findMissedMoment.
   * Every session has at least one moment of strong listening behavior — Cue's
   * job is to surface it so the user feels recognized for what they did right.
   *
   * Three patterns scored, highest wins:
   *  A) Strategic pause AFTER speech — calm tension + low pace + recent silence
   *  B) Sustained calm regulation during speech — low tension + measured pace
   *  C) Question prosody followed by silence — they asked a question and gave space
   *
   * @param {Array} frames - sequence of {tension, pace, energy, isSpeech, timestamp}
   * @returns {Object|null} - { secondsIntoCall, kind, why, tension, pace, energy }
   */
  function findBestMoment(frames) {
    if (!frames || frames.length < 10) return null;

    let bestMoment = null;
    let bestScore = 0;

    for (let i = 5; i < frames.length - 2; i++) {
      const frame = frames[i];

      // Pattern A: Strategic pause after speaking (silence following speech with calm prior tension)
      if (!frame.isSpeech && frames[i-1] && frames[i-1].isSpeech) {
        const priorWindow = frames.slice(Math.max(0, i-5), i);
        const calmPrior = priorWindow.every(f => f.tension < 60 && f.pace < 65);
        // pause holds for at least 2 frames (~2s)
        const heldPause = (i+1 < frames.length) && !frames[i+1].isSpeech;
        if (calmPrior && heldPause) {
          const score = 80 + (60 - (priorWindow.reduce((a,f) => a+f.tension, 0) / priorWindow.length)) * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestMoment = {
              frameIndex: i,
              timestamp: frame.timestamp,
              kind: 'strategic_pause',
              why: 'You finished speaking and gave them space — a deliberate silence after your turn.',
              secondsIntoCall: i,
              tension: Math.round(priorWindow[priorWindow.length-1].tension),
              pace: Math.round(priorWindow[priorWindow.length-1].pace),
              energy: Math.round(priorWindow[priorWindow.length-1].energy),
            };
          }
        }
      }

      // Pattern B: Sustained calm regulation (5+ consecutive speech frames at low tension and pace)
      if (frame.isSpeech) {
        const window = frames.slice(i, Math.min(frames.length, i+5));
        if (window.length >= 5 && window.every(f => f.isSpeech && f.tension < 50 && f.pace < 60)) {
          const avgTension = window.reduce((a,f) => a+f.tension, 0) / window.length;
          const score = 70 + (50 - avgTension);
          if (score > bestScore) {
            bestScore = score;
            bestMoment = {
              frameIndex: i,
              timestamp: frame.timestamp,
              kind: 'calm_stretch',
              why: 'You held a calm tone and steady pace for 5+ seconds — your voice was welcoming.',
              secondsIntoCall: i,
              tension: Math.round(avgTension),
              pace: Math.round(window.reduce((a,f) => a+f.pace, 0) / window.length),
              energy: Math.round(window.reduce((a,f) => a+f.energy, 0) / window.length),
            };
          }
        }
      }
    }

    // Fallback: if nothing exceptional, just point to the LOWEST-tension speech moment
    if (!bestMoment) {
      let lowest = Infinity;
      let lowestIdx = -1;
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].isSpeech && frames[i].tension < lowest) {
          lowest = frames[i].tension;
          lowestIdx = i;
        }
      }
      if (lowestIdx >= 0 && lowest < 75) {
        bestMoment = {
          frameIndex: lowestIdx,
          timestamp: frames[lowestIdx].timestamp,
          kind: 'calm_moment',
          why: 'Your calmest speaking moment of this call.',
          secondsIntoCall: lowestIdx,
          tension: Math.round(lowest),
          pace: Math.round(frames[lowestIdx].pace),
          energy: Math.round(frames[lowestIdx].energy),
        };
      }
    }

    return bestMoment;
  }

  /**
   * Generate a micro-skill recommendation based on the session's dominant issue.
   *
   * @param {Object} eqScore - Output from compute()
   * @param {Array} nudgeHistory - Nudge events
   * @returns {Object} - { skill, description, tip }
   */
  function getMicroSkill(eqScore, nudgeHistory = []) {
    // Count nudge types
    const typeCounts = { pace: 0, tension: 0, long_speech: 0, escalation: 0 };
    for (const nudge of nudgeHistory) {
      typeCounts[nudge.type] = (typeCounts[nudge.type] || 0) + 1;
    }

    // Find dominant issue
    const dominantType = Object.keys(typeCounts).reduce((a, b) =>
      typeCounts[a] > typeCounts[b] ? a : b
    );

    // Also check component scores
    const lowestComponent = Math.min(
      eqScore.tensionStability,
      eqScore.strategicPausing,
      eqScore.energyRegulation
    );

    let skill;

    if (typeCounts.escalation > 0) {
      skill = {
        skill: 'Box Breathing',
        description: 'Your tension, pace, and energy all spiked together. This is an escalation pattern.',
        tip: 'Before your next call, practice 4-4-4-4 box breathing: inhale 4s, hold 4s, exhale 4s, hold 4s. Do 3 rounds. When you feel intensity rising in the call, take one slow breath before continuing.'
      };
    } else if (eqScore.strategicPausing < 50 || typeCounts.long_speech > 1) {
      skill = {
        skill: 'The Power Pause',
        description: 'You spoke for extended stretches without giving space. Strategic pauses build authority and invite collaboration.',
        tip: 'After every key point, pause for 2-3 seconds. It feels long, but it signals confidence and gives others room to process. Try counting "one-Mississippi" silently.'
      };
    } else if (typeCounts.pace > typeCounts.tension) {
      skill = {
        skill: 'Pace Anchoring',
        description: 'Your speaking pace frequently exceeded your baseline. Fast talking can signal anxiety and reduce clarity.',
        tip: 'Pick one word per sentence to deliberately slow down on — your key word. Elongate it slightly. This naturally anchors your pace without feeling robotic.'
      };
    } else if (eqScore.tensionStability < 50 || typeCounts.tension > 0) {
      skill = {
        skill: 'Vocal Grounding',
        description: 'Your voice showed tension spikes — pitch rose and your tone tightened. This often happens when defending a point.',
        tip: 'Drop your shoulders and unclench your jaw before speaking. Start your response one note lower than where the other person finished. Lower pitch signals calm authority.'
      };
    } else if (eqScore.energyRegulation < 50) {
      skill = {
        skill: 'Energy Leveling',
        description: 'Your energy varied significantly throughout the call — big swings between quiet and loud.',
        tip: 'Imagine a volume dial from 3-7 (not 1-10). Keep your energy within that range. Match the energy of the room before gradually raising or lowering it.'
      };
    } else {
      skill = {
        skill: 'Keep It Up',
        description: 'Strong self-regulation across the board. Your biggest opportunity is consistency.',
        tip: 'Before your next call, set a simple intention: "I will pause after my two most important points." One micro-goal per call builds lasting habits.'
      };
    }

    return skill;
  }

  return {
    compute,
    findMissedMoment,
    findBestMoment,
    getMicroSkill
  };
})();
