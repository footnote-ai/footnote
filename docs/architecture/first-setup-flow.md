# First-Setup Flow

This document defines the first-run bootstrap path used when `footnote.yaml` is missing.

## Trigger

- Setup-required mode is true only when resolving `FOOTNOTE_SETTINGS_PATH` returns `ENOENT`.
- Invalid YAML is not setup-required mode. Invalid YAML remains a normal configuration error.

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

## Setup Session

- `POST /api/setup/session` exchanges bootstrap code for short-lived setup session.
- Success sets `httpOnly` cookie (`SameSite=Strict`, `Secure` on secure/proxy-secure requests).
- Response returns `{ ok: true, expiresAt, csrfToken }`.
- `DELETE /api/setup/session` clears session cookie.

## YAML Edit Path

- YAML read/validate/save still uses `/api/admin/settings/*`.
- Auth accepts:
    - `x-admin-token` (existing path), or
    - setup session cookie, only while setup is required.
- CSRF requirement:
    - setup-session auth requires `x-setup-csrf` for all non-GET calls.

## First Write Concurrency

- Admin write requires `If-Match`.
- While file is missing, only `If-Match: "footnote-settings-missing"` is accepted.
- Once file exists, sentinel is rejected with `412` and normal ETag flow applies.

## Restart Semantics

- Save succeeds with `restartRequired: true` and `applied: false`.
- Settings are persisted, but running process does not auto-reload or auto-restart.
