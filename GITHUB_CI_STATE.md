# Cue — GitHub CI State

There is **one repo with GitHub Actions**: `vajdos/cue-desktop`. The Chrome extension repo (`cue-extension/`) and the PWA repo (`cue-pwa-git/`) have no GitHub Actions workflows — Vercel handles PWA deploy, and the extension repo doesn't currently have a remote pushed to GitHub.

This file inventories the two active workflows in the desktop repo, what they do, what secrets they need, and their current pass/fail state.

> Generated 2026-05-17. Verification source: `cue-desktop/.github/workflows/`, live query of `api.github.com/repos/vajdos/cue-desktop/actions/runs`.

---

## Two workflows, both active

### `build-desktop.yml` — Tauri build + GitHub Release publishing

**Triggers**
- `push` to `main` → builds artifacts, 30-day retention
- `push` of `v*` tag → builds artifacts + publishes a permanent GitHub Release
- `workflow_dispatch` → manual trigger

**Jobs**
- `build-windows` on `windows-latest`: Node 20 + stable Rust + `npm install` + `npm run build` (= `tauri build`) → outputs `.exe` NSIS installer + portable .zip
- `build-macos` (inferred from existing release assets): macOS runner, outputs `.dmg` for Apple Silicon

**Outputs**: three assets attached to each `v*` release:
- `Cue-portable-windows-x64.zip`
- `Cue_<version>_x64-setup.exe`
- `Cue_<version>_aarch64.dmg`

**Concurrency**: cancels previous runs on the same ref, so a rapid second push doesn't pile up builds.

**Permissions**: `contents: write` — required to publish releases.

**Secrets needed**: none specifically declared in build-desktop.yml itself (no `${{ secrets.* }}` references in the build job).

### `verify-and-fix.yml` — Autonomous Claude-powered verify-and-fix agent

**Triggers**
- `push` to `main` (paths-ignore: `STATUS_FOR_NATHAN.md`, `NEXT_RELEASE_NOTES.md`, `*.md` — doc-only changes don't trigger)
- `schedule: '0 11 * * 1-5'` → 6 AM Central, weekdays
- `workflow_dispatch`

**What it does** (per file header):
1. Runs the Cue self-test suite (lints, tests, smoke checks)
2. If anything fails → fires the fix-agent
3. The fix-agent calls Claude (Anthropic API) with the failure log + `.cursor/rules/cue-context.md` guardrails
4. Claude proposes a code change → workflow applies it → commits to a `fix/` branch → opens a PR for review

**Secrets needed**: `ANTHROPIC_API_KEY` (one-time setup; required to call Claude API)

---

## Recent runs (last 8) — 2026-05-17 snapshot

All `completed | success`:

| Workflow | Title | Outcome |
|---|---|---|
| Verify + Fix Agent | (scheduled) | ✅ success |
| Build Cue Desktop | `v1.0.2: strip in-panel jitter, kill question-detection nudges` | ✅ success |
| Build Cue Desktop | (mirror of above on `main` push) | ✅ success |
| Verify + Fix Agent | `v1.0.2: ...` (push trigger) | ✅ success |
| Verify + Fix Agent | (scheduled) × 4 | ✅ success |

**CI is healthy.** The v1.0.2 desktop build (the one this session triggered) succeeded, attached all 3 installers to the GitHub release, and the daily verify-and-fix agent is running on cron.

---

## What's NOT in CI today

These are gaps, in priority order:

1. **No CI for `cue-extension/`** (the master extension repo). The repo has a `.git/` folder but no GitHub remote. Build is done ad-hoc by Nathan or by Claude Code sessions. **Phase 1 of `ROADMAP.md` (build script) is the natural place to add CI for this — same `windows-latest` runner, same Node version, run the privacy audit grep + build script + upload zip artifact.**
2. **No CI for `cue-pwa-git/`.** Vercel auto-deploys from git, so CI is less critical, but there's no test step on the PWA either — broken API endpoints would only surface on a live curl. A simple `npm run test` or even `node -c api/*.js` would catch syntax errors before deploy.
3. **No release-on-merge for the extension.** The desktop tags + publishes. The extension has no equivalent — every Web Store submission is a manual upload via the dev console UI.
4. **No security scanning** (Dependabot, CodeQL). Defensible because there's no `package.json` and no third-party deps in either the extension or the desktop's frontend — but the Tauri Rust side does have `Cargo.lock` with transitive deps that could carry vulnerabilities. Worth turning on Dependabot in `vajdos/cue-desktop` for the `cargo` ecosystem at minimum.

---

## Where secrets are stored (and how to rotate)

The CI runs under the `vajdos` GitHub account. Secrets are configured in:

- `github.com/vajdos/cue-desktop/settings/secrets/actions`

Currently configured (inferred from workflow files + STATUS_FOR_NATHAN.md):

| Secret | Used by | Rotation |
|---|---|---|
| `ANTHROPIC_API_KEY` | verify-and-fix.yml | Rotate via console.anthropic.com when needed; update GitHub Actions secret |
| (no others declared in current workflows) | — | — |

If the verify-and-fix agent starts failing with auth errors, the Anthropic key has expired or been rotated upstream. Replace it.

---

## Action items from this audit

1. ☐ Add CI to `cue-extension/` once `scripts/build-store-package.ps1` exists (Phase 1 of `ROADMAP.md`). Run the privacy audit grep + build the store zip on every push to `main`.
2. ☐ Decide whether to push `cue-extension/` to a public or private GitHub repo. Currently it's local-only — bus factor 1 includes the source itself.
3. ☐ Turn on Dependabot for `cargo` in `vajdos/cue-desktop` (the Rust side).
4. ☐ Add a minimal `node -c api/*.js` syntax-check workflow to `cue-pwa-git/` (Vercel does its own typecheck on deploy, but a pre-deploy GitHub action would catch issues 30 seconds earlier).
5. ☐ Document the Anthropic key rotation procedure for the verify-and-fix agent — currently tribal knowledge.

---

## Cross-references

- `ROADMAP.md` Phase 1 (Stabilize) — build script + CI for extension
- `BUILD_AND_RELEASE.md` (Phase 1.5, not yet written) — how to ship a new version
- `DOCUMENTATION_PLAN.md` Phase 2.2 — this is the verification it called for

---

_Updated 2026-05-17: created from live query of `vajdos/cue-desktop` Actions runs and inspection of workflow files._
