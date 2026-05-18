# Cursor — Self-Improving Setup for Cue (you do these, 12 min total)

I can't create accounts on your behalf — but everything else is ready.
The `.cursor/rules/cue-context.md` file is in place and Cursor's agent
will read it automatically on every task.

## Step 1 — Sign up (3 min)
1. Go to https://cursor.com
2. Click **Sign up** → use Google sign-in with `Nathan.Vajdos@regis-energy.com`
3. Pick the **Pro plan** ($20/mo) — required for the Background Agent
   that does autonomous improvements. Free tier is editor-only.

## Step 2 — Connect this codebase (4 min)
1. Download the Cursor app from https://cursor.com/download
2. Open Cursor → **File > Open Folder** → select
   `C:\Users\NathanVajdos\Downloads\cue-extension`
3. Cursor auto-detects `.cursor/rules/cue-context.md` and uses it.
4. Run `git init` in this folder if it isn't already a git repo:
   ```
   git init
   git add .
   git commit -m "Cue v1.1.15 baseline"
   ```

## Step 3 — Connect to GitHub (so Background Agent can work) (3 min)
1. Create a private repo at https://github.com/new — call it
   `cue-extension`. Do NOT initialize with README (you have one).
2. In a PowerShell at the cue-extension folder:
   ```
   git remote add origin https://github.com/<your-handle>/cue-extension.git
   git push -u origin main
   ```
3. In Cursor: **Settings > Background Agents > Connect GitHub** and
   pick the cue-extension repo.

## Step 4 — Turn on Background Agents (2 min)
In Cursor settings:
- **Background Agents: ON**
- **Auto-fix on save: ON**
- **Read project rules: ON** (this picks up `.cursor/rules/`)
- **Trigger on:** "every commit" or "every hour" — your call. I
  recommend "every commit" so it never runs against stale state.

## What the agent will do automatically
After setup, Cursor's background agent will read
`.cursor/rules/cue-context.md` and act on these directives without
prompting:

1. Tune thresholds based on your actual session frame-store data.
2. Fix false positives (e.g., the PAUSE-interruption bug we just
   fixed in mic-only mode — same pattern, different signals).
3. Bump `manifest.json` version + rebuild `dist\cue-X.Y.Z.zip`
   whenever it ships a user-facing change.
4. Keep `manifest.json` consistent with files actually on disk
   (the plan file at `~/.claude/plans/graceful-booping-panda.md`
   has been wrong before — agent will verify filesystem state).
5. Maintain the on-device-only privacy guarantee. Will not add
   anything that exfiltrates audio features.

## Things the agent is told NOT to touch without you approving
- `assets/icons/*` (brand)
- `verify/*` (privacy commitments — must stay truthful)
- `manifest.json` permission list (re-triggers Chrome Store review)

## How to give it new tasks
In Cursor's chat panel:
- **`@codebase`** — points it at the whole repo
- **`@docs`** — points it at the rules in `.cursor/rules/`
- **`@cmd-k`** — opens the inline-edit prompt in any file

Example prompts that work well given the rules file:
- "Lower the pace threshold by 5 if the last 10 sessions show
  speakingRatio > 0.7 average."
- "Add a 'silence streak' positive nudge when the user holds a 6+
  second pause."
- "Verify all `web_accessible_resources` paths in manifest.json
  actually exist on disk and either fix the path or create the file."

## If you hit a wall
The most common Cursor agent friction is the GitHub remote auth.
If push hangs, run `git config --global credential.helper manager`
and re-try `git push` — Windows will prompt for your GitHub token.
