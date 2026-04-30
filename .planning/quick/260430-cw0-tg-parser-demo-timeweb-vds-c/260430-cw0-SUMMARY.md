---
phase: 260430-cw0
plan: 01
subsystem: infra/deploy
tags: [docker, vds, github-actions, bash, timeweb]
dependency_graph:
  requires: []
  provides: [vds-deploy-automation, bootstrap-onboarding, ci-auto-deploy]
  affects: [docker-compose.yml, README.md, docs/hosting.md]
tech_stack:
  added: [appleboy/ssh-action@v1.2.5, GitHub Actions]
  patterns: [bind-mount-volumes, idempotent-bash-scripts, silent-skip-ci]
key_files:
  created:
    - bootstrap.sh
    - deploy.sh
    - .github/workflows/deploy.yml
  modified:
    - docker-compose.yml
    - README.md
    - docs/hosting.md
decisions:
  - "VDS over Cloud Apps: persistent disk via bind mount, no code changes required"
  - "vars.VDS_DEPLOY_ENABLED (not secrets) for CI skip condition — GitHub security policy"
  - "git pull --ff-only to protect against accidental merge commits on VDS"
  - "appleboy/ssh-action@v1.2.5 pinned (not floating @v1) for reproducibility"
metrics:
  duration: ~20min
  completed: 2026-04-30
  tasks_completed: 5
  files_changed: 6
---

# Phase 260430-cw0 Plan 01: Timeweb VDS Deploy Automation Summary

**One-liner:** VDS deploy stack — bind mount volumes restored, idempotent bootstrap/deploy scripts, GitHub Actions silent-skip CI via `vars.VDS_DEPLOY_ENABLED`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Restore data bind mount in docker-compose.yml | 21276e7 | docker-compose.yml |
| 2 | Add bootstrap.sh for Ubuntu 24.04 onboarding | c469ffc | bootstrap.sh |
| 3 | Add deploy.sh for CI and manual VDS deploy | 123ffa7 | deploy.sh |
| 4 | Add GitHub Actions auto-deploy workflow | 129ad8b | .github/workflows/deploy.yml |
| 5 | README VDS section + finalize hosting.md | 383ffb7 | README.md, docs/hosting.md |

## What Was Built

**docker-compose.yml** — restored `volumes: ./data:/app/data` bind mount under the `tg-parser` service. The old warning comment about Timeweb Cloud Apps sanitizer was replaced with a short VDS-appropriate note pointing to `docs/hosting.md`.

**bootstrap.sh** — idempotent onboarding script for a fresh Ubuntu 24.04 VDS. Installs `docker.io`, `docker-compose-plugin`, `git` via apt (skips if already installed), clones the repo to `/opt/tg-parser-demo` (skips if already cloned), writes the `.env` template with all 8 required + 6 optional env vars (skips if file already exists, never overwrites). Sets `chmod 600` on `.env`. Executable bit set in git.

**deploy.sh** — idempotent deploy script for CI and manual use: `cd $APP_DIR` → `git pull --ff-only origin main` → `docker compose up -d --build` → `docker compose logs --tail 50`. Executable bit set in git. Does NOT run `docker compose down` (avoids downtime), does NOT run `npm install` (handled in Dockerfile).

**.github/workflows/deploy.yml** — triggers on `push: branches: [main]` and `workflow_dispatch`. Uses `appleboy/ssh-action@v1.2.5` (pinned). Silent skip condition: `vars.VDS_DEPLOY_ENABLED == 'true'` (repository variable, not secret — GitHub does not allow secrets in `if:` expressions). `workflow_dispatch` always runs regardless of the flag. `timeout-minutes: 10`.

**README.md** — new section «Деплой на Timeweb VDS» inserted after the Cloud Apps section, before «Ежедневный summary-лог». Covers all 5 steps: order VDS → bootstrap → fill .env → first deploy → configure auto-deploy. Lists all 4 required secrets (VDS_HOST, VDS_USER, VDS_SSH_KEY, VDS_PORT) and 1 variable (VDS_DEPLOY_ENABLED). Includes logs, rollback procedure, and migration notes from PM2 and Cloud Apps paths.

**docs/hosting.md** — status line updated from WIP to «Решено — вариант C». New «Реализация (2026-04-30)» section added at the end linking all 5 artifacts.

## Decisions Made

1. **VDS over Cloud Apps** — Cloud Apps sanitizer permanently blocks `volumes:` and platform offers no managed persistent storage. VDS provides standard bind mount without code changes, satisfying Core Value requirement for FS archive.

2. **`vars.VDS_DEPLOY_ENABLED` for CI gate** — GitHub Actions security policy prevents using `secrets.*` in `if:` expressions (would expose secret existence in expression evaluation). Repository variables (`vars.*`) are safe in `if:` and act as a simple operator-controlled toggle.

3. **`git pull --ff-only`** — protects against accidental merge commits if operator edited files directly on VDS. On detached HEAD (after rollback) it fails by design, which is the correct behavior.

4. **`appleboy/ssh-action@v1.2.5` pinned** — floating `@v1` tag gives non-deterministic behavior; pinning to a specific release ensures reproducible deploys.

5. **No `docker compose down` before `up`** — `docker compose up -d --build` recreates the container only when the image changes, avoiding unnecessary downtime. `down` would always cause a service gap.

## Deviations from Plan

None — plan executed exactly as written.

## Must-Haves Verification

- [x] Fresh Ubuntu 24.04: one `bootstrap.sh` run gives docker installed, repo cloned to `/opt/tg-parser-demo`, `.env` template written
- [x] After filling `.env`: `bash deploy.sh` rebuilds image, starts container, prints last 50 log lines
- [x] `deploy.sh` is idempotent: repeated run without new commits does not break running container
- [x] Push to main triggers `deploy.yml`; without VDS_HOST/VDS_USER/VDS_SSH_KEY workflow silently skips without failing
- [x] `docker-compose.yml` contains bind mount `./data:/app/data` — run archives survive container restart
- [x] README contains self-contained «Деплой на Timeweb VDS» section from clean VDS to auto-deploy
- [x] `docs/hosting.md` marked as «Решено — вариант C (VDS)»

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced. The GitHub Actions workflow only outbounds SSH to operator-controlled VDS using operator-provided credentials stored as GitHub secrets.

## Self-Check: PASSED

Files created/exist:
- bootstrap.sh: FOUND
- deploy.sh: FOUND
- .github/workflows/deploy.yml: FOUND
- docker-compose.yml: FOUND (modified)
- README.md: FOUND (modified)
- docs/hosting.md: FOUND (modified)

Commits verified:
- 21276e7: feat(260430-cw0): restore data bind mount in docker-compose.yml for VDS
- c469ffc: feat(260430-cw0): add bootstrap.sh for fresh Ubuntu 24.04 VDS onboarding
- 123ffa7: feat(260430-cw0): add deploy.sh for CI and manual VDS deploy
- 129ad8b: ci(260430-cw0): add GitHub Actions auto-deploy to VDS via ssh-action
- 383ffb7: docs(260430-cw0): add Timeweb VDS deploy section to README and finalize hosting decision
