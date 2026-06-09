# Setup and Settings Flow

This document defines the first-run bootstrap path and temporary operator
settings editor used before the full authenticated settings UI exists.

## Trigger

- Setup-required mode is true only when resolving `FOOTNOTE_SETTINGS_PATH` returns `ENOENT`.
- Invalid YAML is not setup-required mode. Invalid YAML remains a normal configuration error.
- Operator settings mode is explicit. `pnpm settings` asks the running backend
  for a short-lived edit link even when `footnote.yaml` exists.
- `pnpm reset` backs up the existing config, removes the canonical config, and
  asks the backend for a first-run setup link.

## Runtime Signaling

- `GET /config.json` includes:
    - `setup.required: boolean`
    - `setup.routePath: "/setup"`
- Web app hard-routes to `/setup` when `setup.required === true`.
- Backend API routing remains unchanged. Only web app routing is gated.

## Bootstrap Code

- Backend emits a startup setup event line with machine-parsable payload and human-readable link block.
- Setup link format uses fragment code: `/setup#code=fn_setup_...`.
- Bootstrap code is one-time and expires after 15 minutes.
- One active bootstrap code is kept per process and reused until exchanged or expired.
- `POST /api/setup/operator-link` issues setup links for operator tooling.
  It accepts only loopback requests. Fly operators reach it through
  `fly ssh console`, not public HTTP.
- Operator links use `mode: "operator"` when editing an existing config and
  `mode: "first-run"` when config is missing or reset.

## Setup Session

- `POST /api/setup/session` exchanges bootstrap code for short-lived setup session.
- Success sets `httpOnly` cookie (`SameSite=Strict`, `Secure` on secure/proxy-secure requests).
- Response returns `{ ok: true, expiresAt, csrfToken }`.
- `DELETE /api/setup/session` clears session cookie.
- First-run sessions are valid only while `footnote.yaml` is missing.
- Operator sessions stay valid until TTL even when `footnote.yaml` exists.

## YAML Edit Path

- YAML read/validate/save still uses `/api/admin/settings/*`.
- Auth accepts:
    - `x-admin-token` (existing path), or
    - valid setup session cookie.
- CSRF requirement:
    - setup-session auth requires `x-setup-csrf` for all non-GET calls.

## First Write Concurrency

- Admin write requires `If-Match`.
- While file is missing, only `If-Match: "footnote-settings-missing"` is accepted.
- Once file exists, sentinel is rejected with `412` and normal ETag flow applies.

## Restart Semantics

- Save succeeds with `restartRequired: true` and `applied: false`.
- Settings are persisted, but running process does not auto-reload or auto-restart.

## Operator Commands

- `pnpm settings`: opens the settings editor for the current config. If config
  is missing, it opens the first-run defaults.
- `pnpm reset`: creates a timestamped backup next to the current config, removes
  the active config, and opens first-run defaults.
- Target detection reads `--target`, then `footnote.yaml deployment.target`,
  then Fly env/manifests, then falls back to local.
