# Cue — PWA Backend State

The Cue PWA at `cue-pwa.vercel.app` is **not** just a marketing site. It has 13 active Vercel serverless functions backed by Airtable, Resend, and Lemon Squeezy. This file inventories every endpoint, what it stores, how it authenticates, and which environment variables it depends on. As of 2026-05-15, the privacy cleanup removed the **extension's outbound calls** to these endpoints — but the endpoints themselves are still live, still listening, and still wired to writable Airtable bases.

This matters because: (a) any external party with the URL can still POST to most of these endpoints, (b) past-uploaded user data (if any) still sits in Airtable, (c) the billing flow (Lemon Squeezy → upgrade-pro.js) is operational, (d) the privacy-claim story for the extension is clean but the broader product surface includes a real cloud backend that needs its own disclosure.

> Generated 2026-05-17. Verification source: `cue-pwa-git/api/`, `cue-pwa-git/vercel.json`, live probe of `https://cue-pwa.vercel.app/api/health`.

---

## Health check (2026-05-17)

```json
{
  "ok": true,
  "checks": {
    "vercel":         { "ok": true },
    "airtable_read":  { "ok": true, "note": "Signups table readable" },
    "airtable_write": { "ok": true, "note": "write + delete round-trip succeeded" },
    "resend":         { "ok": true, "note": "RESEND_API_KEY present" },
    "env": {
      "AIRTABLE_PAT":      true,
      "AIRTABLE_API_KEY":  true,
      "ADMIN_TOKEN":       true,
      "CRON_SECRET":       true,
      "RESEND_API_KEY":    true
    }
  }
}
```

The backend is fully provisioned and functional.

---

## Two Airtable bases

| Base ID | Purpose | Tables (observed) |
|---|---|---|
| `apptO12PxTpR5192l` | Signups + corpus + admin reads | `Signups` (table name resolved at runtime), `tblAJWECL4jqUkq4X` (`AIRTABLE_CORPUS_TABLE` env var — listening corpus) |
| `appG6yqvYz0cRJMKJ` | Cross-device sync + Web Push subscriptions + Pro status | sync state, push subs |

Two separate bases — `apptO...` for prospect/marketing data, `appG6...` for active-user state. Anyone with the Airtable PAT can read/write both; access control is by environment variable, not by row.

---

## Active endpoint inventory (13 endpoints)

### Identity / billing

| Endpoint | Method | Writes to | Auth |
|---|---|---|---|
| `POST /api/signup` | POST | `apptO12PxTpR5192l/Signups` table — name, email, source, score, ref | None (public; rate-limit unverified) |
| `POST /api/lemonsqueezy-webhook` | POST | Airtable CRM record — `proStatus`, `customer ID`, `subscription ID` | **HMAC-SHA256** signature verified against `LEMONSQUEEZY_WEBHOOK_SECRET`. Raw body required (bodyParser disabled). |
| `POST /api/upgrade-pro` | POST | Marks Cue user as Pro after Lemon Squeezy purchase | Called from `/thanks.html` after user types the email they paid with. No signature verification — relies on `signup` → email-existence check. |

### Sync (extension-facing — now orphaned after 2026-05-15 cleanup)

| Endpoint | Method | Writes to | Auth |
|---|---|---|---|
| `POST /api/sync` | POST | `appG6yqvYz0cRJMKJ` — user state (preferences, calibration, progress, sessions) | None visible in headers. Endpoint accepts arbitrary email + payload. |
| `POST /api/test-haptic` | POST | Web Push to every device registered for an email | None visible. |
| `POST /api/push-subscribe` | POST | `appG6yqvYz0cRJMKJ` — Web Push subscription (endpoint + p256dh + auth keys) tied to user email | None visible. |

⚠️ **The extension no longer calls `/api/sync` or `/api/test-haptic`** (removed 2026-05-15). But the endpoints accept POST from any source. If `cueSettings.syncEmail` was ever set by a user on a previous build, their preferences are still in `appG6yqvYz0cRJMKJ` — Airtable doesn't auto-purge.

### Telemetry / corpus

| Endpoint | Method | Writes to | Auth |
|---|---|---|---|
| `POST /api/corpus` | POST | `apptO12PxTpR5192l/tblAJWECL4jqUkq4X` — anonymized nudge → outcome records | `CUE_EXEMPLAR_SECRET` (rotated on exemplar recruitment changes) — defense against random submissions |
| `GET /api/corpus` | GET | (read) | Returns `{configured: <bool>}` — discovery endpoint |
| `POST /api/heard` | POST | Trust Signal counterparty endpoint — post-call "how heard did you feel" 1-5 rating | **HMAC-SHA256** token signed by frontend with `TRUST_SIGNAL_SECRET`; verified before write |

### Admin / desktop

| Endpoint | Method | Writes to | Auth |
|---|---|---|---|
| `GET /api/admin` | GET | (read) — Cue business dashboard data | `ADMIN_TOKEN` env var |
| `GET /api/desktop-updates` | GET | (read) — Tauri updater payload (signed release URL + minisign sig) | None — Tauri updater hits it with platform + version, gets back metadata or 204 |
| `GET /api/health` | GET | (read) — boolean check for env-var presence + Airtable round-trip + Resend key | None |
| `POST /api/send-email` | POST | Sends via Resend | (unknown — header set to `Access-Control-Allow-Origin: *`, but should verify) |

### Disabled (`.disabled` / `.merged-into-*` files in repo)

These have file extensions that prevent Vercel from routing to them. They exist as historical artifacts but are unreachable today:

- `api/generate-vapid.js.disabled` — was admin-only VAPID key generation
- `api/haptic-setup.js.disabled` — Apple Watch onboarding
- `api/haptic-test.js.disabled` — earlier haptic-test variant (replaced by `test-haptic.js`)
- `api/og-image.js.disabled` — OpenGraph image generation
- `api/test-push.js.disabled`
- `api/vapid-public-key.js.merged-into-push-subscribe` — VAPID key fetch (now part of push-subscribe.js)
- `api/weekly-digest.js.disabled` — weekly digest email cron (the `vercel.json` has no cron config → never ran)

---

## Environment variables (Vercel project)

| Var | Required by | Status |
|---|---|---|
| `AIRTABLE_PAT` (and/or `AIRTABLE_API_KEY`) | every endpoint that touches Airtable | ✅ set |
| `AIRTABLE_CORPUS_TABLE` | `corpus.js` | ✅ set (= `tblAJWECL4jqUkq4X`) |
| `ADMIN_TOKEN` | `admin.js`, `generate-vapid.js.disabled` | ✅ set |
| `CRON_SECRET` | (no current cron uses it) | ✅ set, unused |
| `RESEND_API_KEY` | `send-email.js`, signup welcome flow | ✅ set |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | `lemonsqueezy-webhook.js` | not in health-check output — unverified |
| `CUE_EXEMPLAR_SECRET` | `corpus.js` | not in health-check output — unverified |
| `TRUST_SIGNAL_SECRET` | `heard.js` | not in health-check output — unverified |
| `CUE_DESKTOP_LATEST_JSON`, `CUE_DESKTOP_LATEST_VER` | `desktop-updates.js` | not in health-check output — unverified; if absent, updater returns 204 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | push-subscribe + test-haptic | not in health-check output |

The `/api/health` endpoint shows the five it does check. The remaining secrets must be confirmed via the Vercel dashboard.

---

## What this means for the privacy claim

The privacy claim on the Chrome extension (`"no audio recorded, no transcription, no upload, verifiable in Chrome DevTools → Network tab"`) is about **the extension**. It still holds — the extension no longer talks to any of these endpoints (post-2026-05-15 cleanup).

But the PWA itself accepts uploads. Anyone interacting with the PWA (e.g., submitting via `/api/signup`, opting in via `/api/corpus`, joining the haptic test, paying via Lemon Squeezy) is engaging with a cloud backend. The PWA's `cue-pwa.vercel.app/privacy` page should disclose this. The extension's claim is not weakened by the existence of these endpoints — but a careful auditor will check both surfaces.

**Action items from this audit:**

1. ☐ Audit Airtable bases for past user data uploaded via the old `/api/sync` and `/api/test-haptic` callsites (from extension v < 1.1.30). If any rows exist, decide: delete, anonymize, or disclose.
2. ☐ Update PWA `/privacy` page to describe the active endpoint surface — email captured by signup, Web Push subscriptions by push-subscribe, payment data by Lemon Squeezy, opt-in nudge metadata by corpus. Currently the privacy page is more focused on the extension's claim.
3. ☐ Verify `LEMONSQUEEZY_WEBHOOK_SECRET`, `CUE_EXEMPLAR_SECRET`, `TRUST_SIGNAL_SECRET`, VAPID keys are present in Vercel project settings.
4. ☐ Consider hardening `send-email.js`, `test-haptic.js`, `push-subscribe.js`, `sync.js` — they accept arbitrary POSTs with no signature or rate limit. A motivated attacker can spam Resend mail credits or pollute the sync base.
5. ☐ Delete the `.disabled` files from `cue-pwa-git/api/` if they're not coming back. Or archive to a `_archive/` folder.

---

## Cross-references

- `ROADMAP.md` Phase 4 (Productize) — Lemon Squeezy → upgrade-pro flow lives here.
- `PRIVACY_THREAT_MODEL.md` (Phase 1.6, not yet written) — must reference this backend surface explicitly.
- `DOCUMENTATION_PLAN.md` Phase 2.1 — this is the verification it called for.

---

_Updated 2026-05-17: created from live verification of `cue-pwa.vercel.app/api/health` and source-code inventory of `cue-pwa-git/api/`._
