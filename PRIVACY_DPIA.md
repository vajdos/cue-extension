# Cue — Data Protection Impact Assessment (DPIA)

**Document type:** Data Protection Impact Assessment under GDPR Article 35, also satisfying CCPA / CPRA risk-assessment expectations.

**Version:** 1.0 (v1.1.33 — corpus telemetry under "default-on, opt-out" model)

**Drafted:** 2026-05-18

**Controller of record:** Nathan Vajdos / Cue (single-founder operation; LLC formation in progress)

**Reviewer:** [TBD — recommend engaging a privacy attorney before EU launch or before user count exceeds 1,000]

---

## 1. Purpose of this document

This DPIA documents the legal basis, risk analysis, and mitigation measures for Cue's anonymous-metrics corpus telemetry, which is enabled by default with prominent opt-out disclosure at install time and one-click opt-out in Settings.

Filing under GDPR Article 6(1)(f) — **legitimate interest** — requires a documented balancing test that weighs the controller's interest against the data subject's fundamental rights and freedoms. This document is that balancing test.

## 2. Description of processing

### 2.1 What is collected

Per-session aggregated signal scores transmitted to `https://cue-pwa.vercel.app/api/corpus` at two moments per nudge event:

1. **At nudge fire:** the immediate pre-nudge signal values (pace, tension, energy, pause — each a 0-100 integer score) plus the nudge type (one of: pace, tension, long_speech, escalation, decision).
2. **30 seconds after nudge fire:** the post-nudge signal values for the same four signals, allowing the server to compute a `behavior_changed` Boolean.

Each record is tagged with:
- A 96-bit random `device_id` generated at install time, stored locally, never linked to any user-identifiable information.
- A timestamp (ms since epoch).
- A source identifier (`extension` | `desktop` | `pwa`).
- The client semantic version (e.g., "1.1.33").

### 2.2 What is NOT collected — at any time, by any code path

- Audio samples (raw or compressed).
- Speech-to-text transcripts (no transcription is performed anywhere in Cue's pipeline).
- User names, email addresses, phone numbers, postal addresses, or any other contact information.
- IP addresses — Vercel's edge layer is configured to strip the `x-forwarded-for` header before forwarding to the corpus endpoint, and the endpoint does not log connection IPs.
- Browser fingerprints (user agent, screen resolution, installed fonts, time zone, language) — none captured, none transmitted.
- Calendar event titles, participant lists, or meeting metadata.
- Counterparty audio or features — only the user's own signal scores are transmitted.
- The user's location, beyond what is incidentally inferable from client `Accept-Language` headers (which are not logged).

### 2.3 Where the data is stored

- Vercel (USA) — serverless function entry point. No persistent storage at this layer.
- Airtable (USA, EU dual-region for paid tiers) — base ID `apptO12PxTpR5192l`, table `tblAJWECL4jqUkq4X`. Append-only records.

### 2.4 How long the data is retained

- 24 months from collection date, then automatically archived (read-only) for one further year, then deleted. The archival rotation will be implemented by a Vercel cron job before retention crosses the 24-month threshold for the first cohort of records.

### 2.5 Who has access

- Nathan Vajdos (founder) — full read/write.
- Future engineering hires bound under written confidentiality agreements.
- Future scientific advisors (Itzchakov, Brooks, etc.) — read-only, aggregate views only, only after a signed data-use agreement.
- No third-party data brokers, advertisers, or analytics platforms.

## 3. Legal basis under GDPR

### 3.1 Article 6(1)(f) — Legitimate Interest

Cue relies on legitimate interest as the lawful basis for processing per the conditions established in *Recital 47* (legitimate interest is appropriate when "a relevant and appropriate relationship between the data subject and the controller in situations such as where the data subject is a client or in the service of the controller").

### 3.2 The three-part balancing test

GDPR jurisprudence requires that legitimate-interest processing satisfy: (a) purpose test, (b) necessity test, (c) balancing test.

**(a) Purpose test — is the interest legitimate?**

Yes. The interest is validation of Cue's measurement model against real-world listening behavior outcomes, in order to:
- Improve the calibration of signal thresholds per the actual distribution of user behavior, not laboratory speech corpora.
- Enable construct-validation research against published listening scales (AELS, LQS) — a prerequisite for the regulatory and commercial defensibility of any voice-AI product in 2026 and forward.
- Support pre-registered scientific publication establishing the measurement validity of Cue's signal model.

This interest is commercially legitimate, scientifically legitimate, and aligned with the user's interest in receiving a more accurate product.

**(b) Necessity test — is the processing necessary for the interest?**

Yes. The interest (model validation, threshold calibration) requires real-world signal-distribution data. No aggregated synthetic substitute exists; published research corpora (Stivers 2009, Provine 2000) are too small or too narrow. The specific data collected — signal scores tied to a random device ID — is the minimum dataset necessary; no audio, no transcripts, no PII.

**(c) Balancing test — does the interest override the data subject's rights and freedoms?**

The data subject's rights to consider:

- **Right to be informed.** Satisfied — the install-time onboarding screen prominently discloses the collection with clear language, the privacy policy at `cue-pwa.vercel.app/privacy` mirrors this disclosure, and the disclosure is reproduced in plain English in Settings → Privacy.
- **Right to object.** Satisfied — one-click opt-out at any time via Settings, with immediate cessation of further data transmission AND deletion of the local `device_id` so future records cannot be linked.
- **Right to erasure ("right to be forgotten").** Satisfied — opt-out wipes the device ID locally; users may also request server-side deletion of records tied to their previous device ID (procedure: email `privacy@cue-app.com` — TBD, set up forwarding before EU launch).
- **Right to data portability.** Limited applicability since the data is anonymous post-collection (no longer linked to a person). On request, Cue will provide the records tied to a user's prior device ID if they retain it.
- **Risk of re-identification.** Low. The dataset contains only random IDs and numerical signal scores. Re-identification would require correlating Cue's data with an external dataset containing the same scoring methodology — no such external dataset exists.
- **Risk of profiling or automated decision-making.** None. Cue does not make automated decisions affecting the user based on corpus data. The corpus informs *future* threshold tuning across the user base; it does not feed back into the individual user's session in any way.
- **Risk of harm.** Negligible. The transmitted data cannot embarrass, financially harm, or identify the user even in the event of a complete data breach.

**Conclusion of balancing test:** The legitimate interest in scientific model validation, combined with the minimal data scope, the prominent disclosure, and the immediate opt-out availability, outweighs the data subject's residual privacy interest in withholding anonymous numerical scores.

## 4. Data minimization analysis

Each transmitted data element is justified against the principle of data minimization (GDPR Article 5(1)(c)):

| Field | Necessary? | Justification |
|---|---|---|
| `device_id` (96-bit random) | Yes | Required to pair pre-nudge and post-nudge records (computed `behavior_changed` requires linking the two halves). Lower-entropy IDs would cause cross-user collisions. PII alternative (e.g., email hash) would be more identifying and is therefore rejected. |
| `ts` (ms timestamp) | Yes | Same as above — pairs the two halves. |
| `nudge_type` | Yes | The corpus is conditional on nudge type; thresholds tune per type. |
| `signals_before` (4 ints) | Yes | The pre-state is the dependent variable in the behavior-change analysis. |
| `signals_after` (4 ints) | Yes | Same; the post-state is the second dependent variable. |
| `source` | Yes | Different platforms (extension / desktop / PWA) have different audio capture characteristics; corpus thresholds must tune per platform. |
| `client_version` | Yes | Records collected under v1.1.33 thresholds are not directly comparable to records under a future v2.0 threshold revision. |

No additional fields are transmitted.

## 5. Security measures

- TLS 1.2+ on all transport between Cue clients and the Vercel endpoint.
- Vercel platform security: SOC 2 Type II certified, encrypted at rest, encrypted in transit, regular security audits.
- Airtable platform security: SOC 2 Type II certified, encryption at rest and in transit.
- No private keys, signing keys, or admin credentials are embedded in client code.
- Corpus endpoint rate-limited via Vercel's edge config.

## 6. Risk register

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Vercel or Airtable breach exposes records | Low | Low (anonymous data) | Vercel + Airtable both SOC 2 certified; data is not PII; users notified per breach-notification timelines |
| Re-identification via signal-pattern uniqueness | Very low | Low | Signal patterns are not stable identifiers; aggregate values; no longitudinal tracking beyond random ID |
| User opts out but residual records remain server-side | Medium | Low | Documented retention policy; user may request server-side deletion via the email procedure noted above |
| Counterparty's behavior reflected in user's signal scores without counterparty consent | Medium | Medium | Mitigated by: (a) only the user's own signals are transmitted, not counterparty signals; (b) install-time consent screen requires user to consider counterparty disclosure; (c) per-context defaults exclude counterparty capture in adversarial contexts |
| Regulator audits before formal compliance program is in place | Low (under 1,000 users) | Medium | This DPIA serves as the documentation. Engage privacy counsel before user count exceeds 1,000 or before any EU launch. |

## 7. Consultation

Pre-launch consultations consulted in preparing this document:

- The Cue founder (Nathan Vajdos) as data controller.
- Published GDPR / CCPA guidance from the ICO (UK), CNIL (France), and California Office of the Attorney General.
- No data subjects were consulted directly (none yet exist for v1.1.33). The opt-out provision allows individual consultation/objection at install time.

Recommended before EU launch:
- Engagement of a privacy attorney licensed in the EU (recommend a firm with prior consumer voice-AI clients).
- Appointment of a Data Protection Officer if user counts exceed 1,000 EU residents OR if any "special-category data" (Article 9) becomes part of processing.
- Publication of a public Privacy Policy at `cue-pwa.vercel.app/privacy` mirroring this DPIA's disclosures in user-readable form.

## 8. Decision

The processing described in this DPIA is **approved** under GDPR Article 6(1)(f) legitimate interest, subject to:

1. The opt-out toggle remaining available, one-click, in Settings.
2. The disclosure text remaining prominently visible during install-time onboarding.
3. No expansion of the dataset (audio, transcripts, PII) without re-running this DPIA.
4. Annual review of this document; next review date 2027-05-18.
5. Immediate re-review if (a) user count exceeds 1,000, (b) EU launch is contemplated, (c) any breach occurs, or (d) Vercel or Airtable terms change materially.

---

_Signed: Nathan Vajdos, Controller. Counter-signed: [pending privacy counsel review]._

_Authority: GDPR Articles 6(1)(f), 35; UK GDPR Art. 35; CCPA §1798.100; CPRA §1798.140._

_This document is internal-record. The user-facing privacy policy at `cue-pwa.vercel.app/privacy` is the public-facing companion document and must be kept consistent with this DPIA._
