# Cue — Tester-Notification Tooling State

The `cue-extension/` master repo root contains **8 Python scripts** for sending email/SMS to Nathan and to testers. They are **manual-fire only** — not scheduled, not in CI, not called from anywhere in the extension code. They exist as one-off tooling for the founder's testing/communication workflow.

They **must be excluded from the Chrome Web Store build** (the build script in `ROADMAP.md` Phase 1.3 enforces this). They are not part of the product. They are not in the shipping bundle.

> Generated 2026-05-17. Verification source: each script's source, search for cron/scheduled-task invocations across all workflows.

---

## The 8 scripts

| Script | What it does | Transport | Credentials |
|---|---|---|---|
| `notify.py` | Sends a single SMS via Gmail → Verizon vtext.com gateway to Nathan's phone (number stored in script; not in this doc) | Gmail SMTP (port 465) | `NOTIFY_EMAIL`, `NOTIFY_APP_PASSWORD` (Gmail app password) |
| `notify_twilio.py` | Paid SMS via Twilio's REST API directly (no SDK) | Twilio REST | Twilio account + auth token (env-var pattern) |
| `poll_twilio.py` | Polls Twilio for inbound SMS replies | Twilio REST | Same as `notify_twilio.py` |
| `send_steve_calendar_setup.py` | Email to Steve about calendar OAuth setup | Gmail SMTP | `NOTIFY_EMAIL`, `NOTIFY_APP_PASSWORD` |
| `send_steve_demo_links.py` | Email to Steve with current demo links | Gmail SMTP | Same |
| `send_steve_iphone_eval.py` | Email to Steve requesting iPhone eval of Cue | Gmail SMTP | Same |
| `send_steve_launch.py` | Launch email to Steve | Gmail SMTP | Same |
| `send_steve_review_report.py` | Email to Steve with usage review report | Gmail SMTP | Same |
| `send_steve_v17_21_eval.py` | Email to Steve about Cue v1.7-v1.21 evaluation | Gmail SMTP | Same |

All except `notify_twilio.py` + `poll_twilio.py` use the same Gmail SMTP transport with the same credentials.

---

## Invocation surface — checked

- **Vercel cron**: None. `vercel.json` has no `cron` entries.
- **GitHub Actions schedule**: The only cron is `verify-and-fix.yml` at `0 11 * * 1-5` (6 AM CT weekdays). It does NOT invoke any of these scripts.
- **`.claude/` scheduled tasks**: None in this repo.
- **`.cursor/` scheduled tasks**: None.
- **Manual invocation only.**

If Nathan runs `python notify.py "Build done"` from a terminal, it fires. Otherwise these scripts are inert files on disk.

---

## What lives in `.env` (gitignored, Nathan's local only)

| Variable | Used by |
|---|---|
| `NOTIFY_EMAIL` | All 7 Gmail-based scripts |
| `NOTIFY_APP_PASSWORD` | All 7 Gmail-based scripts (a Gmail app-specific password, NOT Nathan's actual Gmail password) |
| `TWILIO_ACCOUNT_SID` | `notify_twilio.py`, `poll_twilio.py` |
| `TWILIO_AUTH_TOKEN` | Same |
| `TWILIO_FROM` | Same |
| `STEVE_EMAIL` (likely) | `send_steve_*.py` scripts |

**`.env` is gitignored** (verified during Stage 2 of the foundation audit). Secrets do not leak to GitHub.

---

## The Twilio toll-free verification

Per the foundation-audit session summary, Twilio's toll-free verification for SMS sending was **IN_REVIEW** as of mid-May. The status of that verification is unknown from this audit. If still pending, the Twilio scripts will not send to non-verified recipients. Nathan should check the Twilio console for status.

---

## What this means for the Chrome Web Store build

Three concerns:

### 1. These files MUST NOT ship in the Web Store zip

The build script that closes `ROADMAP.md` Phase 1.3 has to remove all `notify_*.py`, `poll_twilio.py`, and `send_steve_*.py` files from the bundle before zipping. They are not extension code. They would:
- Add weight to the zip for no user value
- Reveal Nathan's phone number, Steve's email, internal communication patterns
- Potentially trigger Web Store reviewers asking "why does this extension contain Python?" — it doesn't matter that Chrome won't run them; the reviewer will ask

### 2. The `.env` file MUST NOT ship

Verified: `.env` is gitignored. The build script must also exclude `.env`, `.env.local`, `.env.*.local` from the zip explicitly — belt-and-suspenders.

### 3. The scripts are useful tooling — keep them, just out of the build

Recommendation (per `ROADMAP.md` Open Question #8):

**Option A — Keep in repo, excluded from build (current state, but with a real build script).**
- Pro: scripts are easy to find when Nathan needs them
- Pro: history is preserved in git
- Con: cohabits with product code

**Option B — Move to a separate `cue-tooling/` repo.**
- Pro: cleaner separation of product code vs. founder-tooling
- Pro: no risk of accidentally building them into the product
- Con: Nathan has to remember which repo they're in
- Con: more repos to maintain

**Recommended: Option A**, gated on the build script existing first.

Alternative: a `_tooling/` subdirectory inside `cue-extension/` that the build script never enters. Same result, less cognitive overhead than a second repo.

---

## Action items from this audit

1. ☐ Confirm Twilio toll-free verification status (Twilio console). If complete, the Twilio scripts are operational. If not, they fail closed for non-verified destinations.
2. ☐ Move all `notify_*.py` + `send_steve_*.py` + `poll_twilio.py` into `_tooling/` subdirectory. Update any docs / git history references.
3. ☐ Add `_tooling/` to the build script's exclude list (Phase 1.3 work in `ROADMAP.md`).
4. ☐ Document Nathan's brain-dump rhythm somewhere — three-times-daily SMS pings (8:45 / 12:45 / 3:45 CT per `MEMORY.md`) are operational but rely on these scripts. If they break and Nathan doesn't know which script is broken, the rhythm dies silently.

---

## Why these scripts exist (historical context)

Per `MEMORY.md`:

> Nathan's 3x daily brain dump workflow (8:45/12:45/3:45 CT) via scheduled-tasks + Outlook

The Gmail-based scripts (`notify.py`, `send_steve_*.py`) appear to be the operational implementation of that rhythm. The Twilio scripts are an alternate path that exists for the case where Gmail SMTP rate-limits or the verizon-gateway path fails.

They are **founder tooling**, not product code. They have always been founder tooling. The right move is to keep them, organize them, and make sure they're invisible to the user-facing build.

---

## Cross-references

- `ROADMAP.md` Open Question #8 — "Keep in repo (excluded from build) or move to a separate repo?"
- `ROADMAP.md` Phase 1.3 — build script that enforces exclusion
- `BUILD_AND_RELEASE.md` (Phase 1.5, not yet written) — must document the exclusion rule
- `DOCUMENTATION_PLAN.md` Phase 2.5 — this is the verification it called for

---

_Updated 2026-05-17: created from per-script source inspection and cross-checked against all known scheduled-task surfaces (Vercel cron, GitHub Actions, .cursor, .claude). All 8 scripts are manual-fire only._
