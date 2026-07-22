# Account Sign-In Status

**Branch:** `feat/account-sign-in`

**Status:** Planned; implementation has not started.

**Last updated:** 2026-07-22

## Goal

Deliver one complete account login flow:

1. An approved administrator visits `/account`.
2. They sign in through an OpenID Connect (OIDC) provider.
3. Footnote creates a short-lived account session.
4. `/account` shows the signed-in identity.
5. The administrator signs out of Footnote.

This branch proves authentication only. It does not grant access to `/admin` or
the admin settings API.

## Decisions For This Branch

### Identity provider boundary

- Use standard OIDC authorization code flow with PKCE.
- Use `openid-client` `^6.8.4` in `packages/backend`.
- Use confidential-client authentication with `client_secret_basic`.
- Require PKCE S256. Do not fall back to plain PKCE.
- Use authentik for the first manual provider test.
- Keep authentik-specific setup in documentation. Do not put authentik-specific
  claims or URLs into Footnote's public contract.
- Request only `openid profile`. Email is not needed for this slice.

`openid-client` supports the project's Node.js 22 and ESM setup. It handles OIDC
discovery, authorization URLs, code exchange, and ID token validation.

### Footnote session

- Store login transactions and signed-in sessions in backend memory.
- Use opaque random cookie values. Do not put identity claims or provider tokens
  in cookies.
- A backend restart ends every account session. This is accepted and documented
  for the first slice.
- Use a 10-minute login transaction lifetime and an 8-hour account session
  lifetime.
- Limit active login transactions to 256 so unauthenticated requests cannot
  grow memory without a bound. Return `429` after pruning when the limit is
  still reached.
- Prune expired transactions and sessions during normal service calls.

### Provider tokens

- Read the validated ID token claims needed to create the Footnote identity.
- Do not call UserInfo in this slice.
- Do not keep access tokens, refresh tokens, or ID tokens after callback
  processing.
- Do not implement provider-wide logout. Signing out ends the Footnote session
  only.

### Identity shape

Use one provider-neutral identity:

```ts
type AuthenticatedPrincipal = {
    issuer: string;
    subject: string;
    displayName: string | null;
};
```

`issuer + subject` is the stable identity. `displayName` is for presentation and
uses `name`, then `preferred_username`, then `null`. Email is not an identifier.

Every account admitted during this administrator-only stage is considered an
administrator, but this branch does not use that fact to unlock administrator
features.

### Configuration

Add four optional environment variables:

- `OIDC_ISSUER_URL`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI`

The three non-secret values remain bootstrap environment configuration, not
`footnote.yaml` settings. The client secret remains secret environment
configuration.

Require an HTTPS issuer. Allow an HTTP redirect URI only for a loopback host
used during local development; deployed callback URIs must use HTTPS.

Behavior:

- none set: account login is disabled without a startup warning
- all set and valid: account login is enabled
- partly set or invalid: account login is disabled and startup emits a safe
  configuration warning
- provider unavailable: public Footnote stays running and the login attempt
  fails with a temporary error

OIDC discovery is lazy. The backend does not wait for the identity provider
during startup. A successful discovery result is cached, provider requests use
a 10-second timeout, and a failed discovery can be retried by a later login.

## API Contract

Add these backend-owned operations:

| Method | Path                 | Purpose                                      |
| ------ | -------------------- | -------------------------------------------- |
| GET    | `/api/auth/login`    | Start login and redirect to the provider     |
| GET    | `/api/auth/callback` | Validate the callback and create the session |
| GET    | `/api/auth/session`  | Return login availability and session state  |
| POST   | `/api/auth/logout`   | End the local Footnote session               |

### Session response

`GET /api/auth/session` returns a discriminated union:

```ts
type GetAuthSessionResponse =
    | {
          enabled: false;
          authenticated: false;
      }
    | {
          enabled: true;
          authenticated: false;
      }
    | {
          enabled: true;
          authenticated: true;
          principal: AuthenticatedPrincipal;
          expiresAt: string;
          csrfToken: string;
      };
```

This endpoint always returns `Cache-Control: no-store`.

### Redirect and error behavior

- Successful login start returns `302` to the provider authorization endpoint.
- Disabled or temporarily unavailable login returns `503` without creating a
  transaction.
- A full transaction store returns `429`.
- A successful callback returns `302` to `/account`.
- A failed callback clears its transaction cookie and returns `302` to
  `/account?auth=failed`. Do not put a provider error or internal reason in the
  redirect URL.
- Logout returns `204` after clearing the local session cookie.

### Cookies and callback checks

Use separate cookies for the short login transaction and the account session.
Both are `HttpOnly`, `SameSite=Lax`, scoped to the narrowest useful path, and
`Secure` for HTTPS deployments.

The callback must validate all of these values before creating a session:

- transaction cookie
- state
- PKCE code verifier
- nonce
- issuer
- audience
- ID token signature and expiry

Build the callback URL from `OIDC_REDIRECT_URI` plus the received query string.
Do not trust the incoming `Host` header to choose the callback origin.

The callback consumes the transaction once. Replaying the callback fails.

### Logout protection

The authenticated session response includes a CSRF token. The web page sends it
as `x-auth-csrf` on `POST /api/auth/logout`.

A valid session with a missing or wrong CSRF token receives `403`. A request
without a valid session still clears the cookie and returns `204`.

## Implementation Steps

### 1. Add the OIDC dependency and configuration

Files:

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `packages/backend/package.json`
- `packages/config-spec/src/env-spec.ts`
- `packages/backend/src/config/types.ts`
- `packages/backend/src/config/buildRuntimeConfig.ts`
- new `packages/backend/src/config/sections/accountAuth.ts`
- new `packages/backend/test/config.accountAuth.test.ts`
- `.env.example`

Work:

- Add `openid-client` 6.x to the shared dependency catalog and backend package.
- Add the four OIDC environment entries.
- Classify the non-secret OIDC keys as bootstrap environment values.
- Build one `accountAuth` runtime config section.
- Treat incomplete or invalid configuration as disabled, with safe warnings.
- Add config tests for disabled, enabled, partial, and invalid URL states.

Checkpoint: the backend starts normally with no OIDC configuration.

### 2. Build the provider and session services

Files:

- new `packages/backend/src/services/oidcClient.ts`
- new `packages/backend/src/services/accountAuth.ts`
- new `packages/backend/test/oidcClient.test.ts`
- new `packages/backend/test/accountAuthService.test.ts`

Work:

- Wrap the small `openid-client` surface Footnote uses.
- Lazily discover provider metadata with a bounded timeout.
- Generate state, nonce, and PKCE values for each login transaction.
- Exchange and validate callback codes.
- Convert validated claims into `AuthenticatedPrincipal`.
- Store only Footnote transaction and session records.
- Enforce one-time transactions, expiry, clearing, pruning, and the active
  transaction cap.
- Inject the clock, random token source, and provider client in tests.

The wrapper is a test seam around one standards library. It is not a plugin
system for multiple identity providers.

Checkpoint: service tests prove the complete transaction and session lifecycle
without contacting a real provider.

### 3. Add shared response contracts

Files:

- `packages/contracts/src/web/types.ts`
- `packages/contracts/src/web/schemas.ts`
- `packages/contracts/src/web/index.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/test/webSchemas.test.ts`

Work:

- Add `AuthenticatedPrincipal` and `GetAuthSessionResponse`.
- Add a strict runtime schema for the session response.
- Export the types and schema through the normal web contract entrypoints.
- Add schema tests for all three response states and invalid mixed states.

Checkpoint: backend and web can import the same serializable session contract.

### 4. Add authentication handlers and routes

Files:

- new `packages/backend/src/handlers/accountAuth.ts`
- new `packages/backend/src/http/authRoutes.ts`
- `packages/backend/src/http/expressApp.ts`
- `packages/backend/src/server.ts`
- new `packages/backend/test/accountAuthHandler.test.ts`
- `packages/backend/test/expressRouteOwnership.test.ts`
- `packages/backend/test/serverContract.test.ts`

Work:

- Implement the four API operations.
- Set and clear the transaction and session cookies.
- Return generic user-facing failures and structured internal reason codes.
- Add `Cache-Control: no-store` to authentication responses.
- Register `/api/auth/*` as an Express-owned backend route group.
- Wire the service once during backend startup without performing network
  discovery.
- Confirm existing setup and admin routes do not change.

Logging events:

- `account.auth.login.started`
- `account.auth.callback.succeeded`
- `account.auth.callback.failed`
- `account.auth.logout.succeeded`

Logs include a request ID and safe result reason. Successful callback logs also
include session expiry and a hashed actor identifier. Never log authorization
codes, cookies, CSRF values, provider tokens, or complete claims.

Checkpoint: handler tests cover disabled login, successful login, provider
failure, invalid callback, callback replay, session reads, CSRF failure, logout,
and expiry.

### 5. Keep the API documentation linked to code

Files:

- `docs/api/openapi.yaml`
- `docs/api/operation-map.md`
- code annotations in the new handler
- contract annotations for the session response

Work:

- Add the four operations and their redirect, success, and error responses.
- Add reusable account-session cookie and `x-auth-csrf` header components.
- Add `x-codeRefs` for handler and contract symbols.
- Add matching `@api.operationId` and `@api.path` annotations.
- Bump the OpenAPI minor version because these are new endpoints.
- Describe cookie and CSRF behavior without exposing implementation secrets.

Checkpoint: `pnpm validate-openapi-links` passes.

### 6. Add the `/account` page

Files:

- new `packages/web/src/pages/AccountPage.tsx`
- new `packages/web/src/styles/account.css`
- `packages/web/src/styles/index.css`
- `packages/web/src/App.tsx`
- new `packages/web/src/pages/AccountPage.test.ts`

Page states:

- loading
- login unavailable
- signed out with **Sign in**
- signed in with the display name and **Sign out**
- generic login or session error

Work:

- Lazy-load `/account` like the other standalone pages.
- Read state from `GET /api/auth/session`.
- Start login with a normal navigation to `/api/auth/login`.
- Send the CSRF token when signing out.
- Validate the session payload with the shared contract schema before using it.
- Remove any generic callback failure marker from the URL after displaying it.
- Keep the page accessible and usable without JavaScript-stored credentials.
- Do not add `/admin`, account editing, or global navigation changes.

Checkpoint: the web build and focused tests cover routing and the main response
states.

### 7. Document setup and perform the provider smoke test

Files:

- `docs/auth/README.md`
- this working plan
- `deploy/README.md`

Document the minimum authentik test setup:

- confidential OAuth2/OIDC provider
- authorization code grant
- strict callback URI matching `OIDC_REDIRECT_URI`
- `openid` and `profile` scope mappings
- PKCE S256 support
- an authentik application assignment limited to the test administrator

Manual checks:

1. Account page reports login disabled with no OIDC configuration.
2. Approved administrator signs in and returns to `/account`.
3. Refreshing `/account` keeps the Footnote session.
4. Invalid or replayed callbacks do not create a session.
5. Sign out clears the Footnote session.
6. The page explains that sign-out ended only the Footnote session.
7. Restarting the backend ends the Footnote session.
8. Provider unavailability breaks login only; public Footnote remains usable.

Record the tested provider and version. Do not commit client secrets or real
account identifiers.

## Validation Before Handoff

Run focused tests while implementing:

- `pnpm backend:prepare`
- Backend authentication tests:

    ```powershell
    pnpm exec tsx --test packages/backend/test/config.accountAuth.test.ts packages/backend/test/oidcClient.test.ts packages/backend/test/accountAuthService.test.ts packages/backend/test/accountAuthHandler.test.ts packages/backend/test/expressRouteOwnership.test.ts packages/backend/test/serverContract.test.ts
    ```

- Shared contract and account page tests:

    ```powershell
    pnpm exec tsx --test packages/contracts/test/webSchemas.test.ts packages/web/src/pages/AccountPage.test.ts
    ```

Then run:

- `pnpm lint:fix`
- `pnpm lint`
- `pnpm type-check`
- `pnpm build`
- `pnpm validate-env`
- `pnpm validate-env-example-parity`
- `pnpm validate-footnote-tags`
- `pnpm validate-openapi-links`
- `pnpm review`
- `pnpm test:build`

`pnpm test:build` is required because this branch adds a provider dependency,
environment configuration, and backend runtime wiring.

## Done When

- `/account` supports sign in, session display, and local sign out.
- The backend verifies the OIDC callback before creating a Footnote session.
- No provider token reaches browser JavaScript or persistent Footnote storage.
- Missing or unavailable OIDC configuration does not stop public Footnote.
- Existing setup sessions and admin settings authentication are unchanged.
- Authentik completes the documented manual smoke test.
- API, environment, deployment, and account documentation match the code.
- Required validation passes, or the handoff names each blocked check and why.

## Explicitly Deferred

- `/admin`
- access to `/api/admin/*`
- roles and permission levels
- regular-user stored data
- persistent or shared session storage
- refresh tokens
- provider-wide logout
- UserInfo calls
- multiple provider connections in one deployment
- provider plugin or adapter frameworks beyond the small OIDC library seam
