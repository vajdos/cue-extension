# Provisional Patent Application — Cue

**Title:** SYSTEM AND METHOD FOR REAL-TIME ACOUSTIC MEASUREMENT OF CONVERSATIONAL LISTENING BEHAVIORS WITH PER-USER CALIBRATION AND PER-CONTEXT FEEDBACK

**Inventor:** Nathan Vajdos (Houston, Texas)

**Application Type:** Provisional Patent Application under 35 U.S.C. § 111(b)

**Filing Counsel:** [TBD — recommend a startup-IP-friendly firm or LegalZoom for initial filing]

**Priority Date:** [Date of filing]

---

## 1. Field of the Invention

This invention relates to computer-implemented systems and methods for analyzing human conversation in real time. More specifically, it relates to a system that performs on-device acoustic feature extraction during a live audio conversation; measures, in real time, a plurality of listening-quality behaviors of a designated user; calibrates measurements against a per-user baseline that evolves across multiple conversations; conditions feedback intensity and capture scope on a user-selected conversational context; and provides multimodal feedback (visual biofeedback during the conversation, plus a post-session report) to the user, without performing speech-to-text transcription and without transmitting audio off the local device.

## 2. Background of the Invention

Human conversation involves not only what speakers say, but how they say it and how they listen. A significant body of peer-reviewed research has identified specific acoustic and conversational behaviors that correlate with perceived listening quality, including but not limited to: response gap (Stivers et al., *PNAS*, 2009), within-turn pause distribution (Liu et al., *JESP*, 2025), energy mirroring across speakers (Pentland, *Honest Signals*, 2008), turn-taking and interruption count (Sacks et al., 1974), pace and articulation rate (Goldman-Eisler, 1968; Smith, Brown & Strong, 1975), fundamental-frequency variability (Curhan & Pentland, *J. Applied Psychology*, 2007), backchannel timing (Bavelas, Coates & Johnson, *JPSP*, 2000; Stivers, 2008), laughter incidence and structure (Provine, 2000; Brooks, *Talk*, 2024), question-asking patterns (Huang, Yeomans, Brooks et al., *JPSP*, 2017), and speaking-time balance (Mehl et al., *Science*, 2007).

Prior commercial systems that attempt to measure conversational dynamics from audio have meaningful limitations:

- **Enterprise sociometric systems** (e.g., systems descended from Pentland's MIT badge work, including the Humanyze product line) require dedicated wearable hardware, are deployed only in enterprise environments, and perform analysis post-hoc rather than in real time.
- **Call-center voice analytics platforms** (e.g., Behavioral Signals; Cogito) require server-side speech-to-text transcription, sentiment analysis, and emotion classification. They operate on cloud infrastructure, are not designed for the consumer market, and the recording-and-transcription posture creates regulatory exposure under two-party-consent statutes in approximately eleven U.S. states and under European GDPR Article 9.
- **Paralinguistic feature-extraction libraries** (e.g., openSMILE; the audEERING SDK) provide acoustic feature primitives but are not end-to-end consumer products; they perform measurement but do not perform per-user calibration, feedback selection, or interaction with the user during the conversation.
- **Meeting-transcription products** (e.g., Otter, Fireflies, Read.ai) transcribe and summarize conversations after they occur but do not measure listening behaviors and do not provide real-time feedback.
- **Mindfulness or breathing-pacer applications** provide real-time biofeedback but do not measure conversation-specific listening signals.

None of the above prior systems combine, in a single on-device pipeline, the elements of: (a) multi-signal real-time acoustic measurement of listening behaviors; (b) per-user calibration that evolves across sessions; (c) user-selectable conversation-context profiles that modulate both threshold sensitivity and audio-capture scope; (d) real-time visual biofeedback timed to conversational events; (e) post-session multivariate reporting; (f) explicit on-device-only operation with verifiable absence of audio transmission or transcription; and (g) speaker-fingerprint filtering to ensure measurements track only the designated user when other voices are audibly present.

## 3. Summary of the Invention

The invention is a computer-implemented system comprising:

1. An **audio-capture subsystem** that obtains digital audio frames from one or more sources, including a user's microphone and, optionally and conditionally, a second audio source representing the counterparty side of a remote conversation.
2. A **feature-extraction subsystem** running on a dedicated audio thread within the user's computing device, computing per-frame acoustic features including but not limited to root-mean-square energy, zero-crossing rate, fundamental frequency (via bounded autocorrelation), spectral centroid, spectral flatness, sub-frame amplitude envelope, voice-activity detection with near-field gating, and peak amplitude.
3. A **signal-model subsystem** that consumes the per-frame feature stream and produces a plurality of listening-behavior signal channels, including: pace, energy, tension, response-gap timing, within-turn pause distribution, interruption count, question-asking incidence, fundamental-frequency standard deviation over a rolling window, articulation-rate coefficient of variation, laughter detection via periodicity analysis of the amplitude envelope in a defined frequency band, backchannel detection via a speech-burst state machine bounded by duration and surrounding-silence constraints, and turn-dominance flagging.
4. A **per-user calibration subsystem** that maintains a persistent baseline distribution for each measured feature, initialized from a population-default ("replicant") prior and progressively blended at a configured weight with each session's data so that the user's personal feature distribution dominates after a small number of completed sessions.
5. A **voice-print subsystem** that maintains an N-dimensional spectral fingerprint of the designated user, computed during a brief calibration window at session start, and used to reject feature frames that fall outside the user's voice-print envelope so that ambient or far-field voices do not contaminate the listening-behavior measurements.
6. A **context-profile subsystem** providing a plurality of user-selectable conversation profiles (default, one-on-one, sales, presentation, negotiation, interview, hard conversation, etc.), each defining a distinct bundle of threshold values for the signal-model subsystem and a distinct default for the audio-capture subsystem's counterparty-capture switch; specifically, symmetric profiles default to capturing both sides of the conversation, while adversarial profiles default to capturing the user's microphone only.
7. A **real-time feedback subsystem** that emits visual or auditory cues to the user during the live conversation when one or more measured signal channels cross a threshold, with cue intensity scaled by the magnitude of the threshold excursion.
8. A **post-session reporting subsystem** that aggregates the session's signal data into a structured report visualizing listening-behavior performance against the user's calibrated baseline.
9. A **privacy-by-design architecture** in which all audio processing occurs on the user's local device, no audio samples are transmitted to remote servers, no speech-to-text transcription is performed, and the absence of network egress is independently verifiable through inspection of the system's network requests during operation.

## 4. Detailed Description

### 4.1 Audio-capture subsystem

The system obtains a microphone audio stream via a host-platform API (`navigator.mediaDevices.getUserMedia` in web environments; platform-native APIs in native-application environments). Optionally, when the user selects a counterparty-capture mode, the system additionally obtains an audio stream representing the counterparty side of the conversation. In a web-browser embodiment, this counterparty stream is obtained from the active browser tab's audio output via the `chrome.tabCapture.getMediaStreamId` API or equivalent. In a native-desktop embodiment, the counterparty stream is obtained from the operating-system loopback device (WASAPI loopback on Windows; ScreenCaptureKit or virtual loopback device on macOS; PulseAudio monitor source on Linux).

The two streams, when both are active, are processed independently through identical feature-extraction pipelines so that the signal model receives feature vectors of the same shape from each source.

### 4.2 Feature-extraction subsystem (AudioWorklet path)

The feature-extraction subsystem runs on a dedicated audio thread (`AudioWorkletProcessor` in the web embodiment) that receives raw PCM audio samples and computes, every approximately 128 milliseconds (i.e., on each 6,144-sample buffer at 48 kHz sampling), a feature vector comprising:

- **RMS energy**, the square root of the mean of squared samples.
- **Zero-crossing rate** (crossings per second), counting sign changes between adjacent samples and normalizing by buffer duration.
- **Voice-activity flag with near-field gate**, requiring both that RMS exceeds a hard floor (~0.005) and that RMS exceeds a rolling-average ambient floor estimate by a configurable ratio (typically 4×); the ambient floor is updated only on quiet frames so that loud user speech does not contaminate the floor estimate.
- **Fundamental frequency** estimated by autocorrelation bounded to the voice range 80–400 Hz, with a normalized correlation confidence floor of 0.30 to reject non-pitched frames.
- **Sub-frame amplitude envelope**, an array of K (typically 8) RMS values computed at sub-buffer resolution to yield an envelope sampled at approximately 62 Hz; used downstream for periodicity-based detection.
- **Peak amplitude** for diagnostic purposes.

Additionally, on the main thread, an FFT-based analyzer computes per-frame **spectral centroid** and **spectral flatness** from the magnitude spectrum derived from `AnalyserNode.getFloatFrequencyData` or equivalent.

### 4.3 Signal-model subsystem

The signal model consumes the feature stream and produces a plurality of signal channels, of which the following ten are claimed as primary:

1. **Pace** — calibrated zero-crossing-rate score against personal baseline.
2. **Energy** — calibrated RMS-energy score against personal baseline.
3. **Tension** — weighted combination of spectral-centroid and inverted spectral-flatness scores.
4. **Response gap** — duration between counterparty utterance end and user utterance start (when dual-stream is active).
5. **Within-turn pause** — distribution of silence intervals within the user's own continuous-speech segments.
6. **Interruption count** — count of user-speech onsets following an unusually short preceding silence (typically <1.0 seconds and >0.1 seconds), refined when dual-stream is active by requiring counterparty-speech presence at the moment of user-speech onset.
7. **F0 standard deviation** — rolling-window (typically 30 seconds) standard deviation of confident F0 estimates during user speech.
8. **Rate coefficient of variation** — rolling-window standard deviation of ZCR divided by mean ZCR during user speech.
9. **Laughter count** — incremented when the sub-frame envelope buffer exhibits periodicity in the 3–8 Hz band with modulation depth exceeding a threshold (typically 0.45) and band-energy ratio against an out-of-band reference exceeding a threshold (typically 3.0×).
10. **Backchannel count and word-burst count** — produced by a state machine over the speech-VAD signal that classifies each speech burst by its duration and surrounding silence; bursts within a defined range (typically 100–450 ms) preceded by sufficient silence (typically ≥300 ms) are classified as backchannels, longer bursts are classified as substantive word-bursts.

Additional turn-dominance, question-detection, and speaking-ratio signals are derived from the above primary signals and are surfaced as outputs of the signal-model subsystem.

### 4.4 Per-user calibration subsystem ("replicant")

The calibration subsystem maintains, for each calibrated feature (RMS, ZCR, spectral centroid, spectral flatness), a baseline distribution characterized by its 5th-percentile minimum, 95th-percentile maximum, and the range between them. The subsystem is initialized with a population-default ("replicant") baseline derived from published descriptive statistics of adult conversational speech, allowing meaningful signal scoring from the first frame of the user's first session.

Each completed session updates the persistent baseline via a weighted blend: new-session statistics are weighted at a configured fraction (typically 0.20 after the first session, 1.0 on the first session when the population default is still active), and the prior baseline is weighted at the complement. The persistent baseline is stored in browser-local storage or platform-native storage, never transmitted off-device, and is loaded on each session start.

### 4.5 Voice-print subsystem

At session start, the voice-print subsystem captures the user's first N seconds (typically 20) of speech and computes an M-dimensional (typically 8) spectral fingerprint summarizing the user's average spectral signature across frames. During the remainder of the session, incoming feature frames are scored against this fingerprint via z-score distance in the M-dimensional space; frames whose distance exceeds a threshold are flagged as not-from-user and are excluded from the signal-model's measurements. This prevents ambient voices (other people in the room, speaker bleed from the conversation) from contaminating the user's listening-behavior measurements.

Optionally, the voice-print subsystem also operates a speaker-counter that clusters rejected frames into distinct voice clusters to estimate the number of audibly present voices in the user's environment.

### 4.6 Context-profile subsystem

The system provides a plurality of named context profiles (default, one-on-one, sales, presentation, negotiation, interview, hard conversation, etc.). Each profile defines: (i) a bundle of threshold-overrides applied to the signal-model subsystem (e.g., a higher pace threshold for the negotiation profile to permit strategic pauses without triggering pace nudges); (ii) a default for the audio-capture subsystem's counterparty-capture switch — symmetric profiles default to capturing both microphone and counterparty streams, while adversarial profiles default to capturing the microphone only.

The user selects a profile via the system's panel UI, either before starting a session or during a session.

### 4.7 Real-time feedback subsystem

When any signal channel crosses its configured threshold, the feedback subsystem emits a visual cue overlaid on the user's screen. The cue's intensity (size, opacity, color tier) is scaled by the magnitude of the threshold excursion. A cooldown period (typically 5–10 seconds) prevents cue stacking.

### 4.8 Post-session reporting subsystem

At session end, the system aggregates session data into a structured "integration tape" report showing the user's signal trajectories over time relative to their personal baseline. The user may share or export this report; it is not transmitted off-device by the system.

### 4.9 Privacy-by-design architecture

The system performs no speech-to-text transcription. No audio samples are transmitted to remote servers. The system's network egress can be independently verified through inspection of network requests during operation; in a properly configured embodiment, the system's network request count during a live session is zero. Persistent state — calibration baselines, voice prints, session reports — is stored only in platform-local storage (e.g., IndexedDB, `chrome.storage.local`, or platform-native key-value store).

## 5. Drawings (Reference Descriptions)

- **Figure 1.** System architecture diagram. Audio sources (microphone + optional counterparty stream) → feature-extraction subsystem (audio thread) → signal-model subsystem (main thread) → feedback subsystem + post-session reporting. All flows internal to the device.
- **Figure 2.** Feature-extraction pipeline. Time-domain features (RMS, ZCR, F0, sub-frame envelope, VAD with near-field gate) computed in the audio thread; spectral features (centroid, flatness) computed via FFT on the main thread; combined feature vector posted every ~128 ms.
- **Figure 3.** Calibration evolution. First session blends 100% new data into the persistent baseline; subsequent sessions blend 20% new, 80% prior. After ~10 sessions, the persistent baseline has fully converged on the user's personal feature distribution.
- **Figure 4.** Context-profile decision tree. User selects profile → profile dictates threshold-bundle and counterparty-capture default → user can override counterparty-capture switch manually.
- **Figure 5.** Voice-print filtering. M-dimensional spectral fingerprint computed during initial 20 s window → subsequent frames scored against fingerprint → out-of-print frames excluded from measurements.
- **Figure 6.** Signal-model channel layout. Ten primary signal channels listed in §4.3, each producing a real-time scalar output and contributing to the post-session report.

## 6. Claims (Drafted for Provisional Priority)

The following claims are provided for the purpose of establishing priority. A non-provisional application filed within twelve months will refine and supplement these claims.

**Claim 1.** A computer-implemented method for providing real-time feedback on conversational listening behaviors to a designated user, comprising: capturing, on a local computing device, an audio stream from a microphone associated with the designated user; computing, on said local computing device and without speech-to-text transcription, a plurality of acoustic feature vectors from said audio stream at a temporal resolution of approximately ten or more vectors per second; deriving, on said local computing device, a plurality of listening-behavior signal values from said feature vectors, said plurality including at least three of: pace, energy, response gap, within-turn pause, interruption count, F0 standard deviation, articulation-rate coefficient of variation, laughter incidence, backchannel incidence, and turn-dominance; comparing said signal values against a per-user baseline distribution stored on said local computing device, said baseline initialized from a population-default prior and progressively updated across sessions; producing real-time visual feedback to said designated user when a signal value crosses a threshold defined by a user-selected conversation-context profile; and storing session data only on said local computing device, performing no transmission of audio samples to remote servers.

**Claim 2.** The method of claim 1, further comprising: conditionally capturing a second audio stream from a counterparty source, said capture conditioned on (a) the user's manual selection, and (b) a per-profile default that captures the counterparty stream for symmetric conversation contexts and does not capture the counterparty stream for adversarial conversation contexts.

**Claim 3.** The method of claim 1, further comprising: capturing, during an initial calibration window of said audio stream, a multi-dimensional spectral fingerprint of said designated user; and excluding from the signal-value derivation those feature vectors whose multi-dimensional spectral distance from said fingerprint exceeds a threshold.

**Claim 4.** The method of claim 1, wherein deriving listening-behavior signal values comprises detecting laughter by accumulating a sub-frame amplitude envelope of said audio stream, computing band-energy in a frequency band of approximately 3–8 Hz of said envelope, and incrementing a laughter count when said band-energy exceeds a multiple of out-of-band reference energy and a modulation-depth threshold is met.

**Claim 5.** The method of claim 1, wherein deriving listening-behavior signal values comprises detecting backchannels by a state machine that classifies each speech burst by its duration and surrounding silence, classifying as a backchannel each burst within a duration range of approximately 100 to 450 milliseconds that is preceded by at least approximately 300 milliseconds of silence.

**Claim 6.** A non-transitory computer-readable medium storing instructions that, when executed, perform the method of claim 1.

**Claim 7.** A system comprising a local computing device configured to perform the method of claim 1, said local computing device including a microphone interface, an audio-thread processor configured to compute said acoustic feature vectors, a main-thread processor configured to derive said listening-behavior signal values, a persistent local data store, and a display interface for said real-time visual feedback.

**Claim 8.** The method of claim 1, wherein the population-default prior comprises feature-distribution parameters derived from published descriptive statistics of adult conversational speech, including without limitation RMS-energy range approximately 0.005 to 0.080, ZCR range approximately 800 to 2200 crossings per second, spectral-centroid range approximately 800 to 2400 Hz, and spectral-flatness range approximately 0.30 to 0.80.

**Claim 9.** The method of claim 2, wherein the adversarial conversation contexts comprise negotiation, interview, and hard-conversation profiles, and the symmetric conversation contexts comprise default, one-on-one, sales, and presentation profiles.

**Claim 10.** The method of claim 1, further comprising: at the end of each session, blending the session's feature statistics into said per-user baseline distribution at a weight of approximately 0.20 when said baseline has been updated from at least one prior session, and at a weight of approximately 1.00 when said baseline is at its population-default state.

## 7. Notes for Counsel

- The non-provisional filing should refine the F0 estimation specification, the voice-print algorithm, and the laughter periodicity detection with implementation-level precision sufficient to support method claims.
- The non-provisional should add a continuation pathway for forthcoming v1.1.34 features (smile-in-voice estimation, prosodic convergence detection) so that priority date is preserved for those signals if they become claimed.
- Prior art search should include the Pentland MIT sociometric badge body of work, Schuller/audEERING's openSMILE patent portfolio (if any), Cogito Corp's emotion-AI patents, Behavioral Signals patent filings, and Apple's voice-analysis patents around the Mood iOS feature.

---

_Drafted 2026-05-18 by Nathan Vajdos for filing under 35 U.S.C. § 111(b). This document is a working draft; counsel should review prior to USPTO submission. Filing fee for individual/micro-entity is approximately $75 (provisional, micro-entity)._
