# Admin Settings Architecture

Footnote keeps canonical runtime settings in `footnote.yaml`.

This document describes the trusted admin API that manages that file for
hosted environments, including the first-setup bootstrap flow that reuses
these YAML endpoints.

## Problem

Before this branch, hosted settings edits were operationally awkward. Maintainers
had to redeploy with a changed file or manually copy YAML into a running volume.

That was acceptable for early maintenance, but not a stable foundation for an
admin surface.

## Scope

Current scope includes:

- schema discovery for editable YAML-backed keys
- canonical YAML read
- YAML validate-only
- canonical YAML replace
- setup-session bootstrap exchange for first-run setup when file is missing
- runtime config setup-state signaling via `GET /config.json`

It does not add:

- web admin UI
- api-client wrappers
- secret management abstraction
- auto-restart
- live config reload

## Runtime Model

- Source of truth stays `FOOTNOTE_SETTINGS_PATH`.
- Runtime still loads settings at startup.
- Saved YAML changes are not applied to the running process.
- Setup-required mode is true only when `FOOTNOTE_SETTINGS_PATH` is missing (`ENOENT`).
- Invalid YAML is not setup mode; invalid YAML remains a normal config error.
- Successful validate/write responses explicitly report:
    - `restartRequired: true`
    - write responses also report `applied: false`

## Auth And Availability

- Routes live under `/api/admin/*`.
- Admin settings auth accepts either:
    - `x-admin-token` (existing trusted token)
    - setup session cookie (`footnote_setup_session`) only while setup is required
- Token comes from `SETTINGS_ADMIN_TOKEN`.
- If setup is not required and token is unset, admin settings endpoints return `503`.
- When setup-session auth is used, all non-GET admin settings calls require `x-setup-csrf`.

This keeps backend startup fail-open while leaving the admin API disabled by
default unless explicitly configured.

## Endpoints

### `GET /api/admin/settings/schema`

Returns editable settings metadata derived from `settingsSpecEntries`:

- env key
- YAML path
- value kind
- description
- defaults/allowed values when present

### `GET /api/admin/settings.yaml`

Returns canonical persisted YAML as `text/yaml; charset=utf-8`.

- includes strong `ETag`
- `404` when settings file is missing

### `POST /api/setup/session`

Exchanges one-time setup bootstrap code for short-lived setup session.

- request body: `{ code: string }`
- success sets `httpOnly` setup cookie and returns `{ ok, expiresAt, csrfToken }`
- errors:
    - `400` invalid payload
    - `401` invalid/expired/used code
    - `409` setup not required

### `DELETE /api/setup/session`

Clears setup session cookie and invalidates in-memory session record.

### `POST /api/admin/settings/validate`

Accepts raw YAML text and validates without writing.

- success: normalized summary + `restartRequired: true`
- failure: structured `validationErrors[]`
- `413` on oversized payload (`SETTINGS_ADMIN_MAX_BODY_BYTES`)

### `PUT /api/admin/settings.yaml`

Replaces canonical YAML after validation.

- requires `If-Match` from latest read
- `428` if `If-Match` is missing
- `412` on ETag mismatch
- writes use temp file + rename in same directory (atomic replace)
- success returns new `etag`, `restartRequired: true`, `applied: false`

## Concurrency Model

This API uses optimistic concurrency with ETags:

1. caller reads YAML and receives current ETag
2. when file is missing, caller submits first write with `If-Match: "footnote-settings-missing"`
3. once file exists, caller submits replacement with `If-Match: <etag>`
4. backend rejects stale writers with `412`

This prevents accidental last-write-wins overwrites when multiple admins edit
the same file.

## Validation Model

The backend now exposes one canonical YAML validation path shared by:

- startup settings load
- admin validate endpoint
- admin write endpoint

Validation errors are categorized (for example `invalid_version`,
`unsupported_key`, `secret_key_forbidden`, `type_mismatch`) and include a
pointer when available.

## Logging And Audit

Current audit trail is structured logs.

Event families:

- `admin.settings.disabled`
- `admin.settings.auth.failed`
- `admin.settings.read.succeeded|failed`
- `admin.settings.validate.succeeded|failed`
- `admin.settings.write.succeeded|failed`

Logs are intended to carry safe metadata only (request context, file path,
ETag hashes, validation category/pointer, restart semantics), never token
values.

## Code Map

Primary implementation:

- `packages/backend/src/handlers/adminSettings.ts`
- `packages/backend/src/http/adminRoutes.ts`
- `packages/backend/src/http/setupRoutes.ts`
- `packages/backend/src/handlers/setupSession.ts`
- `packages/backend/src/services/setupBootstrap.ts`
- `packages/backend/src/config/settings.ts`
- `packages/backend/src/config/sections/services.ts`

Contract and spec:

- `packages/contracts/src/web/types.ts`
- `packages/contracts/src/web/schemas.ts`
- `docs/api/openapi.yaml`
- `docs/api/operation-map.md`

## Planned Direction (Non-Binding)

Likely next steps, but not committed in this branch:

1. backend-owned admin web page for raw YAML read/validate/save flow
2. schema-driven form editing on top of existing schema endpoint
3. stronger operator authn/authz (for example OIDC-backed identities and roles)
4. persistent audit log once admin action surface grows
5. optional restart orchestration endpoint, gated by deployment policy

Pre-1.0 rule still applies: update the intended shape directly as design moves;
avoid compatibility shims unless explicitly required.
