# API Spec

## Location

OpenAPI source: `docs/api/openapi/`. The committed `docs/api/openapi.yaml` is
the bundled contract for consumers; edit the source modules, not the bundle.
Run `pnpm openapi:bundle` to refresh it. The validation command and CI reject a
stale bundle.

The source keeps shared metadata separate and groups paths and schemas by chat,
media, tasks, traces, incidents, accounts, and setup/admin ownership.

## Versioning

PATCH: doc fixes or clarifications with no wire change.
MINOR: backward-compatible additions (new fields/endpoints).
MAJOR: breaking changes to paths, auth, or response/request shapes.
Update `info.version` manually when the wire contract changes.

## Validation

Run `pnpm validate-openapi-links` to verify:

- spec -> code (`x-codeRefs` point to real files/symbols)
- code -> spec (`@api.operationId` tags map to real OpenAPI operationIds)

For routes with runtime validation, the current pattern is:

- compile-time types in `packages/contracts/src/web/types.ts`
- runtime schemas in `packages/contracts/src/web/schemas.ts`
- shared client response validation in `packages/contracts/src/web/client-core.ts`
- backend request validation imports those same runtime schemas directly

## Chat Endpoint

Chat is the shared backend action-routing endpoint for web and Discord surfaces.
It accepts a transport-neutral conversation payload and returns an action union
(`message`, `react`, `ignore`, or `image`). Web callers are constrained to
`message` responses, while trusted internal callers can receive the broader action set.

Public browser traffic is protected by Turnstile + configured rate limits. When needed,
send `X-Session-Id` and `X-Turnstile-Token` headers. `X-Session-Id` is a client-generated
session identifier that scopes rate limits; if you omit it, the server falls back to IP-based limits.

Trusted agent callers send `X-Agent-Token`, backed by the `AGENT_API_TOKEN` secret.
They submit the same `PostChatRequest` and receive the same complete action response
as web or Discord. The token identifies the caller; `surface: web` or
`surface: discord` identifies the behavior being tested.

This endpoint is served at `POST /api/chat` and is now the canonical backend decision point
for chat behavior across packages.
