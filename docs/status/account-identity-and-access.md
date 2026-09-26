# Account Identity and Access Status

Status: provider-neutral OIDC sign-in, durable Footnote accounts, and separate
administrator authorization are implemented. Account-owned feature data remains
ordered after this foundation.

Last updated: 2026-09-25.

This tracker describes the durable account direction. Each branch should still
deliver one useful result, preserve public and setup behavior, and avoid
building later account features early.

## Delivered foundations

### Basic account sign-in

Footnote accepts one configured OpenID Connect provider. The backend validates
the OIDC authorization-code callback, creates a short-lived in-memory Footnote
session, exposes a small identity view at `/account`, and supports local
sign-out. OIDC proves who signed in; it does not by itself define Footnote
permissions.

The runtime is provider-neutral. Authentik is the tested provider and the
optional Authelia-on-Fly profile is deployment tooling, not a provider-specific
runtime contract. Both are delivered foundations.

Every successful callback now resolves or creates a durable Footnote account
before issuing the local session. The account store keeps only the internal
account ID and a separate issuer-and-subject mapping. It does not retain email,
display name, broad provider claims, or a generic user-data bucket.

### Administrator access

A signed-in administrator can open `/admin` and use the existing backend-owned
settings editor. The backend authorizes the settings API; the web route is only
a presentation entry point. Administrator access is a separate Footnote
authorization decision. `OIDC_ADMIN_IDENTITIES` contains comma-separated
`issuer|subject` pairs that receive the administrator capability; other admitted
users receive ordinary account sessions.

Administrator settings actions may record a deterministic hash of the external
issuer and subject as a safe actor identifier. Footnote does not retain provider
tokens, cookies, CSRF values, or broad identity claims for this purpose.

## Access and recovery boundary

The selected `/api/admin/*` settings operations accept:

- a signed-in Footnote administrator session;
- the existing `SETTINGS_ADMIN_TOKEN` trusted-token path; or
- a short-lived setup/operator session issued by the bootstrap flow.

Account-session writes require the account-session CSRF token. Setup-session
writes continue to require setup CSRF. Token and setup access remain available
for first-run bootstrap and recovery and do not become permanent account
access.

When account sign-in is disabled or the identity provider is unavailable,
anonymous/public Footnote behavior remains fail-open. The admin API is still
backend-authorized and does not become public.

## Account-owned data boundary

Issue #521 establishes who owns future Footnote data. Future records should
reference the internal account ID, not `issuer + subject`. SQLite uniqueness and
one transaction cover the first-login race, while local sessions remain short-
lived and process-local.

This stage does not add memory, saved conversations, inferred profiles,
uploads, preferences, export, deletion, or account merging. Follow-on work is
ordered in issue #525.

## Work sequence

1. #455 — provider-neutral OIDC sign-in (delivered)
2. #456 — signed-in administrator access (delivered)
3. #521 — durable Footnote accounts for regular OIDC users (delivered)
4. #522 — deliberate incident association and safe user view
5. #523 — export explicit Footnote-owned account data
6. #524 — delete Footnote account data with documented incident retention

The sequence keeps external authentication, Footnote authorization, and
Footnote-owned data as separate decisions.
