# Cue — Google Calendar Integration Setup

Cue v1.1.0 ships with calendar scaffolding fully wired but **dormant** until you complete the one-time Google Cloud setup below. Once configured, Cue will:

- Show your next upcoming meeting in the side panel
- Auto-switch the conversation profile based on the meeting title (e.g., "Sales call w/ Acme" → Sales/Discovery profile)
- Notify you ~5 minutes before a video-call meeting starts
- Tag the post-call Integration Tape with the meeting context

**Time required:** ~15 minutes. Most of it waiting for Google Cloud.

---

## Step 1 — Create a Google Cloud project (5 min)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Top bar → click the project dropdown → **New Project**
3. Name: `Cue Extension` · Organization: leave default · Click **Create**
4. Wait ~30 seconds for it to provision; switch to it via the dropdown

## Step 2 — Enable the Calendar API

1. Left nav → **APIs & Services** → **Library**
2. Search: `Google Calendar API`
3. Click the result → click **Enable**

## Step 3 — Configure OAuth consent screen

1. Left nav → **APIs & Services** → **OAuth consent screen**
2. User Type: **External** (unless you have a Workspace org) → **Create**
3. Fill in:
   - **App name:** `Cue`
   - **User support email:** your email
   - **App logo:** optional
   - **Developer contact email:** your email
4. **Save and Continue** through Scopes (no scopes needed at this step — we'll add via manifest)
5. **Save and Continue** through Test Users — add your own Google email
6. **Save and Continue** to summary → **Back to Dashboard**

## Step 4 — Create the OAuth client ID

1. Left nav → **APIs & Services** → **Credentials**
2. **+ Create Credentials** → **OAuth client ID**
3. Application type: **Chrome Extension**
4. Name: `Cue Chrome Extension`
5. **Application ID:** the extension ID Chrome shows in `chrome://extensions/` (e.g., `ocgcnfbheloiffbinfbannijdbdgioom`)
6. Click **Create**
7. **Copy the Client ID** — looks like `1234567890-abc...apps.googleusercontent.com`

## Step 5 — Plug the Client ID into Cue

Open `manifest.json` in the extension folder. Find this block:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/calendar.readonly"]
}
```

Replace `YOUR_CLIENT_ID_HERE.apps.googleusercontent.com` with the Client ID you copied.

## Step 6 — Reload the extension

1. `chrome://extensions/` → click the reload icon (↻) on Cue
2. Open the side panel — you should now see a **"Connect calendar"** button (or it auto-prompts)
3. Click → Google's OAuth consent screen pops up
4. Sign in → click Allow → Cue caches the token

## Step 7 — Verify

1. In the side-panel DevTools console, run:
   ```javascript
   CueCalendarService.listUpcomingEvents({ maxResults: 3 })
     .then(events => console.log('UPCOMING:', events))
   ```
2. You should see your next 3 calendar events printed.

---

## What it does once connected

### Title-based profile auto-switching

Meeting titles are matched against these patterns:

| Title contains | Profile applied |
|---|---|
| `sales`, `discovery`, `demo`, `prospect`, `pitch`, `qualification` | Sales/Discovery |
| `negotiation`, `contract`, `deal`, `terms`, `pricing`, `vendor` | Negotiation |
| `present`, `all hands`, `town hall`, `webinar`, `keynote` | Presentation |
| `1:1`, `1-on-1`, `one on one`, `coaching`, `skip`, `sync` | 1-on-1 Coaching |
| Anything else | Default — balanced |

You can override the auto-pick at any time via the source picker in the side panel — your manual choice wins.

### Imminent-meeting nudge

5 minutes before any calendar event with a video-call link, Cue posts a system notification: *"Sales call w/ Acme starts in 5 minutes. Cue is ready."*

### Tape tagging

The Integration Tape header for a session that overlaps a calendar event will read: *"Sales call w/ Acme · 32 min · EQ 73"* instead of *"Friday, Apr 25, 9:30 AM · 32 min · EQ 73"*.

---

## Disconnecting

Open the side panel → Settings → **Disconnect calendar**. This:

1. Revokes the OAuth token via `chrome.identity.removeCachedAuthToken`
2. Clears `cueCalendarAuthToken` and `cueCalendarLastEvents` from local storage
3. Hides all calendar UI

You can reconnect at any time without re-doing GCP setup.

---

## Troubleshooting

### "Auth token request returned empty"
- Your OAuth consent screen is in **Testing** mode and you're not in the test-users list. Add your email at *APIs & Services → OAuth consent screen → Test users*.

### "Calendar API 403"
- Calendar API is not enabled for this GCP project. Re-do Step 2.

### "Calendar API 401"
- Token expired. The library auto-revokes; click Connect Calendar again.

### Extension Application ID mismatch
- The Application ID you entered in Step 4 must EXACTLY match the ID shown in `chrome://extensions/`. If they differ, OAuth fails silently. Re-create the credential with the correct ID.

### When you publish to Chrome Web Store
- The extension ID will change after the store assigns a permanent one. You'll need to **add a second OAuth client** (or update the existing one) with the production ID. Both can coexist in the same GCP project.

---

## Privacy note

Cue requests **only** `calendar.readonly` scope. Cue cannot:
- Create, modify, or delete calendar events
- Send invitations
- See calendars other than your primary
- See attendees who haven't accepted

Calendar event metadata stays in `chrome.storage.local` — same on-device principle as voice analysis.
