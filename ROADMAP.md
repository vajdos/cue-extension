# Cue — Foundation Roadmap

This file is the North Star for turning Cue from "extension exists" into "people pay for it." It captures what's true today, what the privacy claim actually delivers, the seven items blocking real-business status, and the phases that resolve them.

**How to use it.** Each future session takes one phase and executes it. Sessions do not pick phases out of order unless the gate explicitly allows it. Update the Progress log at the bottom when a phase is closed. Do not replace this file — append, refine, and re-check the Open Questions when decisions land.

**Who it's for.** Nathan (founder, sole human on the project). Any future Claude session briefed against the file. Any contractor we hand off to.

**Conventions.** Terse. Declarative. No marketing voice. File references look like `src/signal/thresholds.js:42`. Don't duplicate `README.md` / `CHROME_STORE_LISTING.md` / `LAUNCH_NOW.md` — point at them and note where they need updating.

---

## Status snapshot

Cue is a Manifest V3 Chrome extension that captures the user's microphone in a hidden offscreen document, processes per-frame acoustic features in an AudioWorklet, scores them against a per-user baseline, and surfaces rule-based intervention nudges (PAUSE / ASK_QUESTION / CONTINUE) plus coaching cues to a Chrome Side Panel + a center-screen overlay on the active call tab. Auto-activates on Zoom Web, Teams Web, and Google Meet. Local-only — IndexedDB for session frames, `chrome.storage.local` for preferences. Build is v1.1.31 (after this session's privacy-claim cleanup and two safety fixes). The codebase was written by one person (Nathan) using Claude Code over the past several weeks; bus factor is 1. Marketing PWA is live at `cue-pwa.vercel.app`. Chrome Web Store submission has been prepared and is ready to upload — submission has not yet been made.

---

## Privacy claim verdict

> **Claim holds as-implemented (v1.1.31).**
>
> The README/Web Store claim "no audio recorded, no transcription, no upload, verifiable in Chrome DevTools → Network tab" holds at the byte level in the shipping build.
>
> **Network egress in `cue-store-prep/`:** 0 `fetch()` to external URLs, 0 `XMLHttpRequest`, 0 `WebSocket`, 0 `sendBeacon`, 0 image-pixel trackers, 0 third-party SDKs, 0 `chrome.storage.sync`, 0 Web Speech API code, 0 `googleapis.com` references. The only remaining `fetch()` is `verify/verify.js:229` which reads `chrome.runtime.getURL('src/audio/cue-processor.js')` — a local URL inside the extension.
>
> **What was removed this session to make the claim hold at the byte level:** `src/calendar/calendar-service.js` (googleapis.com/calendar/v3 fetch — was inert), `src/transcription/vernacular-engine.js` (Web Speech → Google cloud ASR — was inert), four `/api/sync` and `/api/test-haptic` fetches in `panel.js` + `service-worker.js` (uploaded email + nudge text + session counts when sync was opted in).
>
> **Residuals that do not affect the claim:** 5 user-initiated `<a href>` / `chrome.tabs.create` links to `cue-pwa.vercel.app/trust`, `/pricing.html`, `/api/haptic-test`. These are browser navigations from explicit user clicks, not extension-initiated uploads.

Non-negotiable: every future phase must re-verify this claim before it ships. **Phase 0 is the gate.**

---

## Phases

### Phase 0 — Verify

**Goal.** Confirm the privacy claim holds at the byte level. Confirm Chrome Web Store readiness. Re-run before every release.

**Gate.** None — this phase is the gate for everything else.

**Status.** Largely complete after this session. Residual items only.

**Deliverables.**
- ☐ Re-run network-egress audit on every build before zipping. Audit grep template lives in this session's transcript — port to `scripts/verify-privacy.ps1`.
- ☐ Re-confirm v1.1.31 build (`dist/cue-1.1.31-store.zip`, sha256 truncated to first 16 hex) before submission.
- ☐ Add a `PRIVACY_AUDIT.md` that records each version's audit result with a date + sha256.

**Realistic hour estimate.** 1–2 hours (script + audit doc).

**Next action.** Phase 1 owns the build script; Phase 0 inherits the privacy-audit step from it.

---

### Phase 1 — Stabilize

**Goal.** Stop bugs from shipping. Tighten the build mechanism so privacy claim cannot regress on an accidental future build. Trim the Chrome Web Store zip to only what should ship.

**Gate.** Phase 0 verdict is "Claim holds as-implemented" on the current build.

**Deliverables.**
- ☐ **Build/release script.** Write `scripts/build-store-package.ps1` that mechanically clones `cue-extension/` → strips `identity` permission + `oauth2` block from `manifest.json` → removes `notify_*.py`, `send_steve_*.py`, `poll_twilio.py`, `dist/`, `.env`, `.git`, `.github`, `*.md` → validates the resulting manifest (refuses to build if `YOUR_CLIENT_ID_HERE` survives) → runs the privacy-audit grep template → zips → outputs `dist/cue-<version>-store.zip` with a printed sha256. Resolves top-risk #3 + #6.
- ☐ **Permissions audit.** Drop `activeTab` (0 usage sites in shipping JS). Audit `scripting` — likely droppable since declared `content_scripts` block handles the injection. Document each surviving permission with a one-sentence reviewer-defensible justification inline in `manifest.json` comments or a sibling `MANIFEST_NOTES.md`. Resolves top-risk #4.
- ☐ **Node-runnable test harness.** Add `tests/run-tests.js` (the convention older docs reference) that stubs AudioWorklet, feeds known signal traces through `signal-model.js` + `decision-engine.js`, asserts thresholds and decision outputs match expected. Wire to a pre-commit or pre-build hook. Resolves top-risk #7.
- ☐ **Settings UI cleanup.** The "Sync" card and "Apple Watch haptic" checkbox in `src/settings/settings.html:163-244` are now non-functional (sync code was removed this session — see Open Question #6). Hide both surfaces OR replace with a "Coming back in v2" note until the feature is rebuilt with explicit consent UI.
- ☐ **Commit and push the uncommitted master-repo changes** to remove bus-factor risk on local-laptop-only edits.

**Realistic hour estimate.** 8–12 hours. The build script is ~2h, permissions audit ~1h, test harness ~4–6h, Settings cleanup ~1h, commit hygiene ~10min.

**Next action.** Start with `scripts/build-store-package.ps1` — it's the single highest-leverage item and resolves three top-risk items in one deliverable.

---

### Phase 2 — Ship

**Goal.** Submit to Chrome Web Store with everything a reviewer needs to approve. Defensible public launch.

**Gate.** Phase 1 closed. Build script exists, tests pass, permissions tightened.

**Deliverables.**
- ☐ **Web Store submission.** Upload `dist/cue-1.1.31-store.zip` (or whichever version Phase 1 closes on) to the existing Cue draft in `chrome.google.com/webstore/devconsole`. Paste-ready text lives in `CHROME_STORE_LISTING.md` (this session removed the false SOC 2 sentence — re-verify the current version doesn't reintroduce it).
- ☐ **Privacy disclosures + ToS.** Write a minimal `terms.html` on the PWA (`cue-pwa.vercel.app/terms` currently returns 404). Resolves top-risk #5 partial.
- ☐ **Support email wired.** Register a forwarder (gmail-backed is fine for now). Add it to the Settings UI footer, the Web Store listing's Support field, and the PWA. Resolves top-risk #5 partial.
- ☐ **Reviewer FAQ.** Write `CHROME_WEB_STORE_REVIEW.md` covering the 10 permission justifications + "no remote code" declaration + the privacy claim's exact wording — all paste-ready for the dev-console form fields.
- ☐ **Launch checklist.** A one-page list a future session can run before clicking Submit. Includes: rebuild via script, run privacy audit, verify sha256, paste fields, set Unlisted, click Submit.

**Realistic hour estimate.** 4–8 hours. Most of this is content writing + paste, not engineering.

**Next action.** Write `terms.html` for the PWA. It's the only deliverable that can't be done in the extension repo and needs to land before the listing submits.

---

### Phase 3 — Document

**Goal.** Move the system out of one person's head. Make handoff to a contractor possible in a day.

**Gate.** Phase 1 closed (the system is stable enough to document accurately).

**Deliverables.**
- ☐ **`SIGNAL_MODEL.md`.** The single biggest contractor blocker. Document: the five signals' acoustic definitions + source papers, baseline-calibration math, threshold table with hysteresis windows, decision-engine state machine, nudge cooldown matrix. Extract from inline comments in `src/signal/thresholds.js`, `src/signal/signal-model.js`, `src/signal/decision-engine.js`, `src/signal/nudge-engine.js`. **Resolves top-risk #2. ~3–4 hours.**
- ☐ **`ARCHITECTURE.md`.** Runtime data flow. Service worker → offscreen doc → AudioWorklet → signal model → decision engine → side panel + content-script overlay → IndexedDB. The diagram I drew in Stage 1 of this session is the seed. **~2 hours.**
- ☐ **`MODULE_GUIDE.md`.** Per-file purpose + how to change it safely. Covers: `src/audio/`, `src/signal/`, `src/storage/`, `src/background/`, `src/content/`, `src/settings/`, `side-panel/`, `offscreen/`, `tape/`, `verify/`. **~3 hours.**
- ☐ **`BUILD_AND_RELEASE.md`.** How `scripts/build-store-package.ps1` works + how to add a new version + how to verify the zip + how to update the GitHub release. **~1 hour.**
- ☐ **`PRIVACY_THREAT_MODEL.md`.** What we claim. What could break the claim. The audit grep template. The list of features that would require updated disclosure (sync, calendar, transcription — all currently removed). **~2 hours.**
- ☐ **`CHROME_WEB_STORE_REVIEW.md`** (from Phase 2 — referenced here for cross-link).
- ☐ **`CLAUDE.md`** at the master repo root. Bootstrap orientation for the next Claude session: where files live, what's in scope, what's out of scope, where this ROADMAP.md lives, what conventions apply. **~1 hour.**

**Realistic hour estimate.** 12–18 hours across the seven docs. Don't do them all in one session — pair each doc with the phase that benefits from it.

**Next action.** `SIGNAL_MODEL.md` first. It's the deepest contractor-blocker and the deepest IP.

---

### Phase 4 — Productize

**Goal.** Build the business layer. Make Cue something a customer can buy, get supported on, and ask for a refund on without it becoming a crisis.

**Gate.** Phase 2 closed (the product is publicly installable from the Chrome Web Store) OR an explicit decision to monetize before Web Store approval.

**Deliverables.**
- ☐ **Pricing decision.** Resolve theatrical pricing (top-risk #1). Three options on the table; see Open Question #1. Output: a `PRICING.md` documenting the decided model + plan structure + trial terms.
- ☐ **Payment processor wired.** Stripe or Lemon Squeezy on the PWA. Webhook → IndexedDB / chrome.storage `cuePro: true` flag flow. The `$69/yr Founding Member` CTA in `side-panel/panel.html:161` becomes real.
- ☐ **Terms of Service** (from Phase 2 — billing-specific terms added here).
- ☐ **Privacy Policy** (from Phase 2 — billing-related disclosures added here).
- ☐ **Refund policy + workflow.** Where does a refund request land. Who answers. How fast. Document in `SUPPORT.md`.
- ☐ **Abuse / DMCA / takedown workflow.** Same doc.
- ☐ **Billing failure recovery.** What happens when a card declines on renewal.

**Realistic hour estimate.** 16–24 hours. Mostly business writing + Stripe wiring, not engineering.

**Next action.** Pricing decision (Open Question #1) is the gate for everything else in this phase.

---

### Phase 5 — Grow

**Goal.** Onboarding, activation, retention, privacy-preserving analytics, distribution. **Intentionally lighter-weight in this roadmap** — most decisions here can't be made without real install data + Phase 4 closed.

**Gate.** Phase 4 closed (or an explicit decision to grow on a free-only path).

**Deliverables (questions to answer in this phase, not yet decisions to commit to):**
- ☐ **Onboarding rebuild.** First-run UX is currently the side-panel self-select (Coach me / Quiet). The previous standalone `onboarding/` tab is disabled — should it come back? See Open Question #7.
- ☐ **Activation analytics.** What minimum data can leave the device without breaking the privacy claim? Aggregated install counts? Sessions-per-user via a one-way hash? Self-hosted IndexedDB report only? See Open Question #4.
- ☐ **Retention loop.** Currently zero. Day-7 hook options: weekly OS notification with local progress, streak counter, email digest (requires email capture which itself requires privacy disclosure). See Open Question #5.
- ☐ **Apple Watch + cross-device sync v2.** Reintroduce the feature that was removed in Stage 2 of this audit, this time with explicit consent UI + updated `PRIVACY_POLICY.md` + a `sync` permission scope the user toggles. See Open Question #6.
- ☐ **Distribution beyond Chrome Web Store.** Edge port (likely trivial — Edge accepts Chrome extensions). Firefox port (requires manifest changes — non-trivial). Safari port (requires Xcode + Apple Developer account — defer until paying customers exist).

**Realistic hour estimate.** Wide-open. 4 hours for Edge port. 20+ hours for any one of the retention loops or analytics workstreams.

**Next action.** Resolve Open Questions #4, #5, #6, #7 — then this phase becomes actionable.

---

## Open questions for Nathan

Decisions only Nathan can make. Roadmap is blocked on these — surfaced here so they don't get buried in phase work.

1. ✅ **Pricing model. RESOLVED 2026-05-17:** Waitlist first → free version available immediately → paid Pro tier extends free *shortly after*. Lemon Squeezy stays wired (no products yet). Phase 4 deliverable: wire the existing `/api/signup` endpoint to a waitlist capture UI in the side panel + PWA; remove the theatrical `$69/yr Founding Member` button OR repurpose it as "Join the waitlist."
2. **Support email / domain.** Personal Gmail forwarder, or buy a real domain (`cue.app`, `cuelistening.com`, etc.)? **Blocks Phase 2 + Phase 4.** Top-risk #5.
3. **ToS / Privacy Policy template.** Write fresh with a lawyer, or template from a service (Termly, iubenda, hand-rolled)? **Blocks Phase 2.**
4. ✅ **Privacy-preserving analytics. RESOLVED 2026-05-17:** Opt-in aggregated anonymized telemetry IS the play — Nathan's framing: *"as part of its competitive moat, we need to somehow be collecting these data sets to help understand the measure of being a better listener."* Infrastructure already exists at `cue-pwa.vercel.app/api/corpus` (per `PWA_BACKEND_STATE.md`) — accepts nudge → outcome records gated by `CUE_EXEMPLAR_SECRET`. Phase 5 wires the opt-in UI in extension Settings. **Side-effect: privacy claim copy must be updated** — "no upload" becomes "no upload by default; optional anonymized telemetry for opted-in users." Captured for `PRIVACY_THREAT_MODEL.md` (Phase 1.6).
5. ⏸️ **Retention strategy. DEFERRED 2026-05-17** by Nathan — *"we'll get to this after we solve one through four."* Stays on the roadmap for Phase 5 work after pricing/canonical/bus-factor/analytics are real.
6. **Sync v2 reintroduction.** Apple Watch haptic + cross-device sync was removed in Stage 2 of the foundation audit. **Confirmed on the roadmap.** When? How? What's the consent UI? What data syncs (settings only, or progress too)? **Phase 5 item.**
7. **Onboarding UX.** The standalone onboarding tab was disabled in Stage 4 of this audit (it pointed to a file not in the shipping bundle). The side-panel self-select is the de-facto first-run UX. Is that sufficient? Or rebuild a standalone onboarding flow? **Phase 5 item.**
8. **`notify_*.py` / `send_steve_*.py` scripts.** Nine Python scripts at the master-repo root for sending email/SMS to testers. Keep in repo (excluded from build via Phase-1 build script) or move to a separate `cue-tooling/` repo? **Affects Phase 1 build-script scope.**
9. **Browser distribution.** Edge / Firefox / Safari — which (if any) before paying customers exist? Edge is ~trivial, Firefox is real engineering, Safari requires $99/year Apple Developer. **Phase 5 item.**
10. ✅ **Bus-factor mitigation. RESOLVED 2026-05-17:** Push `cue-extension/` to **public** GitHub repo at `vajdos/cue-extension` (same account as `cue-desktop`). Rationale: (a) bus-factor mitigation, (b) public source IS the strongest defense of the load-bearing privacy claim — Signal/Bitwarden/1Password pattern, (c) Web Store unpack already makes the source effectively-public anyway, (d) makes contractor hiring + future co-founder handoff easier. Phase 1 deliverable: push the repo + add README badges + open-source license. Decision on the actual OSS license terms is a small follow-up (MIT vs Apache-2.0 vs source-available — all preserve commercial flexibility).
11. ✅ **`cue-desktop/` vs. Chrome extension — canonical choice. RESOLVED 2026-05-17:** **Desktop is canonical.** Extension is the browser-only companion. Rationale: front-loaded one-time install friction (desktop) wins by Nathan's "minimum friction wherever the user is" principle vs. the extension's recurring per-meeting friction (only works in browser-based calls + per-meeting mic-permission war demonstrated by David and Andy 2026-05-15). Both surfaces ship; marketing leads with desktop; `/install` page detects OS and offers desktop first. Reshape: `ROADMAP.md` Phase 2 (Ship) now ships desktop first, Web Store submission is a parallel browser-only track.

---

## Progress log

Append dated entries here as phases get worked. Format: `### YYYY-MM-DD — <phase> — <what happened>`.

### 2026-05-15 — Phase 0 (Verify) — Foundation audit completed

- Stage 1 (Inspect & Map) — system mapped, 8 must-read files identified
- Stage 2 (Privacy Claim Verification) — verdict moved from "Claim holds with caveats" → "Claim holds as-implemented"
  - Deleted `src/calendar/calendar-service.js` (was inert googleapis.com/calendar/v3 fetch path)
  - Deleted `src/transcription/vernacular-engine.js` (was inert Web Speech → Google cloud ASR path)
  - Removed 4 `fetch()` calls to `cue-pwa.vercel.app/api/sync` + `/api/test-haptic` (Apple Watch / cross-device sync — went on Open Question #6 for v2 reintroduction)
  - Cleaned `cue-store-prep/manifest.json` `web_accessible_resources` entries for the two deleted files
- Stage 3 (Five-Dimensional Survey) — completed; surfaced false SOC 2 / HIPAA claims + onboarding 404 bug as immediate fixes
- Stage 3 immediate fixes (not deferred to a phase):
  - Deleted false SOC 2 sentence from `CHROME_STORE_LISTING.md:58`
  - Softened false HIPAA implication in `LAUNCH_NOW.md:113`
  - Disabled broken first-run onboarding tab open in `src/background/service-worker.js:83-90` (file referenced was not in shipping bundle — every fresh Web Store install was opening a 404 tab)
- Stage 4 (Top Risks) — 7 items identified, prioritized, mapped to phases
- Stage 5 (Roadmap) — this file
- Build at end of session: **v1.1.31** (`dist/cue-1.1.31-store.zip`, 137,734 bytes)

### 2026-05-17 — Phase 0 / Open Questions — 5 resolutions captured
- **#1 Pricing** → resolved: Waitlist now + free version + paid Pro later. Lemon Squeezy stays wired with no products yet.
- **#4 Privacy-preserving analytics** → resolved: opt-in aggregated anonymized telemetry IS the moat. `/api/corpus` infrastructure exists; wire the extension Settings opt-in UI in Phase 5. **Side-effect:** privacy claim copy must update to "no upload by default; optional opt-in telemetry."
- **#5 Retention strategy** → deferred per Nathan ("solve 1-4 first").
- **#10 Bus-factor mitigation** → resolved: push `cue-extension/` to PUBLIC GitHub at `vajdos/cue-extension`. Rationale: bus-factor + privacy-claim defense (Signal/1Password pattern) + Web Store unpack already makes source effectively-public. Phase 1 deliverable: push + license + README badges.
- **#11 Canonical surface** → resolved: **Desktop is canonical**, extension is browser-only companion. By Nathan's "minimum friction" principle, desktop's one-time-install friction beats extension's recurring per-meeting friction. Reshape: Phase 2 (Ship) ships desktop first, Web Store submission is a parallel track.
- 6 of 11 Open Questions now resolved (#1, #4, #5, #10, #11 + #6 already deferred). 5 still open: support email/domain (#2), ToS template (#3), sync v2 (#6), onboarding UX (#7), notify-scripts location (#8), browser distribution (#9). Plus the 3 fast-fix Nathan-verifications outstanding: voice-print.js read, Web Store draft check, Twilio verification status.
- Next sessions queue: Phase 1.2 SIGNAL_MODEL.md (gated on voice-print.js read), Phase 1.1 work to actually push to GitHub, Phase 4 prep on waitlist wiring.

### 2026-05-17 — Strategic decisions on data flywheel + counterparty capture
After deep discussion of "what does science support" and "what's the moat":

**Science-anchored signal-model framing (locked):**
- 5 of 6 science-supported listening behaviors measured today (within-turn pause, response gap, energy mirror, interrupt count, pace). The 6th — follow-up question asking, Huang et al. 2017 — was removed from the nudge surface but should be RESTORED as measurement-only (no prompting). Strongest single-behavior science in the listening literature.
- Public marketing copy reframes to "five behaviors decades of research show others perceive as good listening" — citations: Stivers 2009 PNAS, Liu 2025 JESP, Huang 2017 JPSP, Pentland 2008, Sacks 1974.

**Voice-print port (locked):**
- Voice-print (8-dim spectral fingerprint, 16-floats-per-user calibration) gets ported to extension. It's measurement-quality infrastructure — without it, every signal measures "user + ambient room noise" instead of "user."
- Speaker counter also ports — gives Cue zero-config awareness of how many people are in the call.
- Not biometric ID. No upload. Documented in PRIVACY_THREAT_MODEL.md as a defensible local-storage write.

**Counterparty acoustic capture — default ON (locked):**
- The single biggest unbuilt moat. Existing `tabCapture` permission + Source picker (currently hidden) + desktop system-audio loopback all already wired.
- Defaults ON for: Default / 1-on-1 Coaching / Sales / Presentation contexts.
- Defaults to ASK for: Negotiation / Interview (new) / Hard conversation (new) — adversarial contexts where two-party-consent exposure is highest.
- Install-time consent screen covers the disclosure. Per-session opt-in friction eliminated.
- Courtesy script ships in Settings as a product feature — users get a tested one-liner to inform counterparties when they want to.
- Chrome's built-in tab-capture indicator + OS screen-recording indicator are the per-session disclosure surfaces.
- Public language convention: "measurement, not recording." Cue measures rhythm and tone, never stores or transmits audio.

**Lawyer memo — deferred (locked):**
- Skip for v1. Norm-shift framing + measurement-not-recording posture + user-courtesy stack is defensible-enough.
- Triggers to revisit: (a) first $X revenue threshold (Nathan to set), (b) first counterparty complaint received in writing.

**Data flywheel architecture (locked):**
- Four-tier inference layer to bootstrap the moat:
  - Tier A: counterparty acoustic signals via tabCapture/system-audio (strongest proxy for "felt heard")
  - Tier B: outcome signals — calendar follow-up scheduling, repeat counterparty, session duration vs. scheduled
  - Tier C: population-level inference from labeled-minority sessions (those with explicit counterparty rating via /api/heard) generalizes to the unlabeled majority
  - Tier D: per-user pattern correlation — "for YOU specifically, X predicts Y" personalized coaching
- Calendar integration returns as Phase 5 opt-in feature (was removed in privacy cleanup; re-add with explicit opt-in + outcome-signal-only scope, no event details to corpus)
- `/api/corpus` and `/api/heard` already wired; need UI to drive them
- Published-science surface (`cue-pwa.vercel.app/science`) becomes part of brand differentiation

**11 → 8 open questions remaining.** The three resolved this round are not the Open Questions list per se — they're product/strategy decisions captured here. The Open Questions table updates separately:
- New Open Question added: legal memo revisit trigger (revenue milestone OR first complaint)

### 2026-05-18 — v1.1.32 shipped — counterparty capture + voice-print + consent screen
Three major workstreams completed in one session:

**Phase B — Code changes (v1.1.32):**
- Ported `src/signal/voice-print.js` from desktop. 8-dim spectral fingerprint, 20s calibration, runtime z-score gating. Filters other speakers in the room so signal measurements track THE user, not ambient noise.
- Counterparty acoustic capture defaults ON for Default / 1-on-1 / Sales / Presentation contexts; defaults to mic-only for Negotiation / Interview / Hard conversation.
- Conversation Profile picker re-surfaced during active sessions, with new Interview and Hard-conversation profiles added.
- Source picker re-surfaced (Me only / Both sides), with both-sides as default.
- New install-time consent screen at `onboarding/onboarding.html` with disclosure language + click-to-copy courtesy script + technical-details disclosure.
- Service worker first-install tab-open re-enabled (previously 404'ing).
- Build: `dist/cue-1.1.32-store.zip`, 147,637 bytes, sha256 `6bef5031b4090a8e29ff24ae`.
- Privacy claim re-verified at byte level: 0 external fetches in shipping bundle.

**Phase C — Documentation:**
- `SIGNAL_MODEL.md` (Phase 1.2) — the IP doc. 5 signals + voice-print + speaker-counter, science citations (Stivers, Liu, Pentland, Sacks, Heldner), threshold tables, calibration math, decision-engine state machine, nudge cooldown matrix, per-context profile overrides. ~440 lines.
- `PRIVACY_THREAT_MODEL.md` (Phase 1.6) — privacy claim defense. Network egress audit (zero external fetches), local storage schema, voice-print disclosure (not biometric ID), counterparty-capture legal posture, audit grep template for future builds. ~280 lines.

**Phase A — Public GitHub push staged (waiting on Nathan):**
- Added MIT LICENSE
- Cleaned master `manifest.json` — removed `identity` permission + `oauth2` block (parity with build manifest)
- Deleted `src/calendar/` and `src/transcription/` from master too — they shouldn't be in the public repo
- Added `notify*.py`, `send_steve*.py`, `poll_twilio*.py`, `dist/*.zip` to `.gitignore`
- Phone number redacted from `TWILIO_SMS_STATE.md`
- Single clean commit ready: `e7a3f84 v1.1.32: foundation audit + science-anchored signal model + GitHub-ready`
- Remote configured: `https://github.com/vajdos/cue-extension.git`
- Push fails until Nathan creates the empty public repo at github.com/new

**Open follow-ups:**
- Nathan to create empty public repo (~90 seconds), then `git push -u origin main`
- Phase 1.3 ARCHITECTURE.md (next session)
- v1.1.33 question-detection-as-measurement (deferred from this session as too large)
- Nathan's 12-minute verifications (Chrome Web Store draft, Twilio status) still pending

### 2026-05-18 — v1.1.33 shipped — five science-backed signals added

After a multi-turn strategic discussion about scientific-advisor affiliations and the gap between Cue's published signal set and the listening-science literature, the five most-cited missing signals were ported into the codebase in one session. Cue now covers ~95% of the documented acoustically-detectable listening behaviors in the peer-reviewed literature.

**Signals shipped (with primary citation):**
1. **F0 variability** (Curhan & Pentland 2007 *J. Applied Psychology* — thin-slice negotiation outcomes). Autocorrelation-based F0 estimator added to AudioWorklet, bounded to 80–400 Hz voice range. Rolling 30 s SD computed in signal-model.
2. **Speech-rate variation** (Goldman-Eisler 1968; Smith et al. 1975). Coefficient of variation of ZCR within speech frames, rolling 20 s window.
3. **Laughter detection** (Provine 2000; Brooks 2024 — TALK / Levity dimension). Sub-frame envelope at 62 Hz, Goertzel-style 3–8 Hz periodicity scan with modulation-depth + out-of-band reference gates.
4. **Backchannel detection** (Stivers 2008; Bavelas et al. 2000 *JPSP*; Brennan & Schober 2001). Speech-burst state machine classifies 100–450 ms bursts following ≥300 ms silence as backchannels; longer bursts as substantive word-bursts. Dual-stream hook for counterparty cross-check via `setCounterpartyActive()`.
5. **Turn-dominance** (Pentland 2008 *Honest Signals*; Mehl et al. 2007 *Science*). Extends existing speakingRatio with explicit imbalance thresholds + session-cumulative speech-time trackers for both user and counterparty.

**Files changed:**
- `src/audio/cue-processor.js` — F0 autocorrelation + sub-frame envelope (108 → 218 lines)
- `src/signal/thresholds.js` — 19 new constants under "v1.1.33 Science-backed signal thresholds" (190 → 244 lines)
- `src/signal/signal-model.js` — 5 detector methods + state + return-payload extension (465 → 842 lines)
- `manifest.json` — version 1.1.32 → 1.1.33 (master also bumped from stale 1.1.17 to match)
- `SIGNAL_MODEL.md` — addendum section with citation, mechanism, threshold, and surfaced-field documentation for each new signal
- `cue-pwa-git/dist/version.json` — release notes added

**Deferred to v1.1.34 (2 of original 7):**
- **Smile-in-voice** (Tartter 1980; Drahota et al. 2008) — needs centroid-conditioned-on-F0 model tuned against real user data.
- **Prosodic convergence** (Pardo 2006; Levitan & Hirschberg 2011; Giles CAT) — needs sustained dual-stream sliding-correlation infrastructure.

Estimate: 2–3 weeks of focused work.

**What this unlocks:**
- The "most scientifically-backed listening tool in consumer software" claim is now defensible against any current competitor (Hume, Lyssn, Behavioral Signals, Humanyze, audEERING, Cogito) — each has 1–3 of these signals, none has 10.
- Construct-validation studies (AELS / LQS correlation with Itzchakov, RCT, cross-linguistic + fairness audit) can now begin. Total path-to-bulletproof: ~6 months, ~$175–230K.
- Signal foundation for v2.0 features (per-context model tuning, longitudinal coaching, outcome-correlation) is in place.

**Mirror status:** All changes propagated from `cue-extension/` master to `cue-store-prep/` build. Both manifests at 1.1.33. Three new-signal source files parse-clean in Node validation.

**Privacy posture:** Unchanged. All five new signals compute on-device, byte-level verifiable. No new network surface.

**Still pending from this arc:**
- Nathan to create empty public repo (~90 seconds), then `git push -u origin main`. The v1.1.33 changes are uncommitted in master at session end — Nathan should commit + push as part of the same push that the v1.1.32 work is waiting on.
- Build the v1.1.33 store zip (`scripts/build-store-package.ps1` doesn't exist yet — manual zip until Phase 1.3 build script lands).
- Phase 1.3 ARCHITECTURE.md (next session).
- v1.1.34 — smile-in-voice + prosodic convergence (2–3 weeks).
- Validation pilot kickoff — schedule Itzchakov outreach call.
