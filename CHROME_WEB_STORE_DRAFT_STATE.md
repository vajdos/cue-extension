# Cue — Chrome Web Store Draft State

**This file is a stub.** It documents the verification step Nathan must run in the Chrome Web Store Developer Dashboard, the exact data points to capture, and where the answers go. The state itself **cannot be verified from this repo or from any API I have access to** — only Nathan (logged into `chrome.google.com/webstore/devconsole` as `vajdos@gmail.com`) can confirm what's actually there.

This stub will be filled in by a future session after Nathan completes the verification — or by Nathan directly, in this file.

> Created 2026-05-17 as a placeholder. Status: **PENDING VERIFICATION.**

---

## Why this can't be auto-verified

The Chrome Web Store dev console requires a logged-in Google account session. The `chrome.google.com/webstore/devconsole/<accountId>/*` URLs are gated behind Google authentication. Public APIs that would return draft state (like a hypothetical "GET extension status" endpoint) don't exist publicly — the Chrome Web Store Publish API requires per-app OAuth tokens that themselves require Nathan to grant access.

Conclusion: the only way to know what's in the dev console is to look at the dev console.

---

## The exact verification step

**Nathan does this in his browser, then types the answers below.**

1. Open `https://chrome.google.com/webstore/devconsole`
2. Sign in with `vajdos@gmail.com`
3. Look at the **Items** dashboard
4. Find the Cue draft (the one called *"Cue — Live Conversation Intelligence"* per the foundation-audit session's earlier screenshot — may now be renamed via manifest as *"Cue — Real-Time Conversation Intelligence"* if the v1.1.x zip was uploaded)
5. Click into it
6. Capture the following data points (write the answers in this file's `Captured state` section below):

| Data point | Where to look in the dev console |
|---|---|
| **Listing status** | Top of the listing page. Possible values: `Draft`, `Pending review`, `Published (Public)`, `Published (Unlisted)`, `Published (Private)`, `Rejected`, `Taken down` |
| **Current uploaded version** | "Package" tab → "Current version" |
| **Last upload date** | "Package" tab |
| **Listing URL** (if published) | Top of the listing page after publish — looks like `chrome.google.com/webstore/detail/cue-real-time-conversation-intelligence/<32-char-id>` |
| **Extension ID** | URL bar when on the listing detail page — the part after `/detail/<slug>/` |
| **Visibility** | "Distribution" tab → "Visibility" radio. Possible: `Public`, `Unlisted`, `Private` |
| **Most recent review communication** | "Account" tab → email feedback section. If rejected, the reason is here. |
| **Permissions justifications status** | "Privacy practices" tab — each permission either has a justification or is flagged red |
| **Privacy disclosure status** | "Privacy practices" tab — every data-usage category should be marked yes/no with explanations |
| **Pending review action item count** | If status is `Pending review`, dev console shows what Google is still waiting on |

---

## Captured state

**Filled in: TODO — Nathan to verify and complete.**

```
Listing status:                  ___________
Current uploaded version:        ___________
Last upload date:                ___________
Listing URL:                     ___________
Extension ID:                    ___________
Visibility:                      ___________
Most recent review communication: ___________
                                  ___________
Permissions justifications:       all-clear / N items flagged: ___________
Privacy disclosure:               complete / N gaps: ___________
Pending review notes:             ___________
```

---

## What changes based on each possible state

The answer to this verification dictates several roadmap moves:

| State | What it unblocks / blocks |
|---|---|
| **Draft, never submitted** | Run `ROADMAP.md` Phase 2 (Ship). Upload `cue-1.1.31-store.zip` (or newer). Fill in listing per `CHROME_STORE_LISTING.md`. Click Submit. |
| **Pending review** | Wait. Nothing to do but watch for Google's email. Estimated SLA: 2-7 business days. |
| **Published (Unlisted)** | 🎉 We're live. Update `ROADMAP.md` Phase 5 — distribution path is operational. Update `/install` page to show "Add to Chrome" button pointing at the listing URL. Email David, Andy, Mark with the one-click install link. |
| **Published (Public)** | Same as Unlisted, plus marketing surface goes live. |
| **Rejected** | Read rejection notes. Fix what Google flagged. Resubmit. Most common rejections at v1.x stage: vague permission justifications, "single purpose" violation, deceptive description (the now-removed SOC 2 / HIPAA copy was a risk for this — confirm those edits actually shipped to the dev console). |
| **Taken down** | Severe. Read takedown notice. Determine cause. Likely requires policy correspondence with Google. |

---

## Cross-references

- `CHROME_STORE_LISTING.md` — the paste-ready listing text (cleaned 2026-05-15)
- `CHROME_WEB_STORE_REVIEW.md` (Phase 1.7, not yet written) — will consolidate listing + permission justifications + reviewer FAQ
- `ROADMAP.md` Phase 2 (Ship) — depends on this verification
- `DOCUMENTATION_PLAN.md` Phase 2.3 — this is the stub it called for

---

## Note to future sessions

Do not skip this verification. The roadmap's Phase 2 (Ship) makes assumptions about Web Store state that may be wrong. Nathan's hands are required. Until this is filled in, treat the Web Store state as **unknown**.

If Nathan returns to a future session and says "I checked, here's what I saw" — paste it into the `Captured state` block above, then update the `Updated` line at the bottom.

---

_Updated 2026-05-17: stub created. Status: PENDING VERIFICATION by Nathan._
