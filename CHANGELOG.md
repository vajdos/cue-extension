# Cue — Changelog

The Chrome extension. Material changes only. Format: declarative, file-cited where it helps. No marketing.

## v1.1.38 — 2026-05-26 — Phase-1 DSP wired into live scoring

**Pace scoring.** Was ZCR alone. Now blends envelope-based syllable rate (Greenberg 1999 — the science-correct measure) with ZCR via `syllableRateConfidence`. When the in-window speech budget is full, syllable rate dominates; when confidence is low (silence, early-session), ZCR carries. ([a27305a](https://github.com/Vajdos/cue-extension/commit/a27305a))

**Tension scoring.** Was `centroid × 0.7 + flatnessInv × 0.3`. Now augmented with two voice-quality measures (Hillenbrand 1994/96): H1-H2 inverted (low H1-H2 = pressed phonation = tension) at 0.20 weight, and CPP inverted (low CPP = dysphonic / breathy = tension) at 0.20 weight. Centroid drops to 0.50, flatness-inv to 0.10. Sum × 100.

**Replicant calibration.** Extended to track the three new fields per user. Population defaults: `syllableRate { min: 2.5, max: 6.5 } /s`, `h1h2 { min: -5, max: 15 } dB`, `cpp { min: 8, max: 25 } dB`. These blend toward the user's measured ranges over the standard ~10-session replicant convergence.

**Backward compat.** Each feature is type-guarded individually. If the upstream worklet/audio-manager doesn't emit a field, the v1.1.37 scoring path runs unchanged. Older stored replicants without the new baseline keys also fall back gracefully — `_finishCalibration` accumulates the new fields starting next session.

## v1.1.37 — 2026-05-24 — Critical fix + foundation

**Fix.** v1.1.36 shipped to the Chrome Web Store with 77 instances of U+2018/U+2019 (LEFT/RIGHT SINGLE QUOTATION MARK) inside the `NUDGE_PACKS` block in `src/signal/thresholds.js`. The file failed to parse in Chrome; `CUE_THRESHOLDS` was never defined; every downstream consumer (signal model, decision engine, nudge engine, side panel) silently disabled itself. Replacing the smart quotes with ASCII apostrophes restores the nudge pipeline. ([551d245](https://github.com/Vajdos/cue-extension/commit/551d245))

**Hardening.** Pre-commit hook at `.githooks/pre-commit` now blocks any commit that would re-introduce this class of bug — smart quotes, JS SyntaxError, JSON parse errors, forbidden audio APIs (`MediaRecorder`, `Blob(audio)`, `FileReader`, `sendBeacon`), `fetch()` to non-allowlisted hosts, third-party `<script src>` tags, `identity`/`oauth2` in manifest, or staged `.env` / `.pem` / `.key` files. Activation per clone: `git config core.hooksPath .githooks`. ([58d484c](https://github.com/Vajdos/cue-extension/commit/58d484c))

**Signal model (on `phase1-foundation-hardening`).** Three Phase 1 DSP improvements landed but are not yet wired to active scoring:

- **Envelope-based syllable rate** (Greenberg 1999) augments ZCR as the canonical pace estimate. ZCR retained as a legacy field during transition. ([d70ab40](https://github.com/Vajdos/cue-extension/commit/d70ab40))
- **H1-H2 + CPP** added alongside spectral centroid for vocal-edge measurement. H1-H2 captures glottal closure pattern; cepstral peak prominence is the standard clinical dysphonia measure. ([0700264](https://github.com/Vajdos/cue-extension/commit/0700264))
- **Smarter calibration completion** — 5-second early-exit when the natural RMS percentile range is informative; extend up to 15 seconds otherwise; always extend when adaptive VAD has activated. ([bfa89ec](https://github.com/Vajdos/cue-extension/commit/bfa89ec))

## v1.1.36 — 2026-05-23 — Single-word nudges + complete audio silence

Trimmed every nudge text across all tone packs to one word: `Slow`, `Breathe`, `Listen`, `Pause`, `Ask`, `Held`, `Groove`, `Calm`, `Ready`. Removed all chimes, notification sounds, and start tones across extension, desktop, and PWA. Per Nathan's feedback: "more-than-a-single-word cue is distracting"; visual is the only modality.

(Shipped broken to CWS — see v1.1.37 above. Smart-quote corruption was introduced during this edit and not caught until the next session.)

## v1.1.35 — 2026-05-23 — Tier 1 mic meter + Stop Listening text + hint dampening

Tier 1 mic meter in the side panel. "Stop Listening" replaces the previous more-clinical wording. Hint dampening at 3 seconds — short-lived hints don't stack when conditions oscillate near a threshold.

## v1.1.34 — 2026-05-22 — Sidebar jitter + Founding Member CTA + ASK_QUESTION suppression

Sidebar jitter resolved via `min-width: 36px` + `flex-shrink: 0` on signal-value pills. Founding Member CTA wired into the side panel (later swapped to a real Lemon Squeezy link in PWA v1.1.37 swap). Apple Watch CTA hidden until sync v2 ships. `ASK_QUESTION` pill no longer surfaces as a visible nudge — it remains in the state machine but is treated as informational.

## v1.1.33 — 2026-05-22 — Five science-backed signals + corpus opt-out

Added F0-SD (Curhan & Pentland 2007), speech-rate variation CV (Goldman-Eisler 1968), laughter detection in the 3-8 Hz envelope band (Provine 2000; Brooks 2024), backchannel duration-signature detection (Stivers 2008; Bavelas et al. 2000), and turn-dominance flagging (Pentland 2008; Mehl et al. 2007). Corpus opt-out follows Option B — opt-in only, schema-validated payload, no audio.

## v1.1.32 — 2026-05-21 — Foundation audit + science-anchored signal model

Foundation audit consolidated the codebase against the v1.0 spec. Signal model re-anchored to peer-reviewed citations only. Repository made GitHub-ready (remote configured, CI pre-commit hook in place).

## Prior versions

The pre-v1.1.32 history is preserved in `git log` but not summarized here. The lineage begins at `e9bbff4` ("Initial commit: Cue v1.2.0 with first-run onboarding") and was renumbered down to the v1.1.x line during the foundation audit.

## Notes

- The signal model's full DSP description lives in `SIGNAL_MODEL.md` when present, and in `CUE_BUILD_SPEC.md` Part 11 as the canonical reference.
- The privacy property is enforced by code, not policy — see `.githooks/pre-commit`, `verify/verify.html`, and the continuous-improvement swarm at `scripts/swarm.mjs`.
- Every version increments `manifest.json`'s `version` field by one patch; minor for material UX changes; major for foundational shifts.
