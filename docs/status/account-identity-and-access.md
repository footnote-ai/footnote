# Account Identity and Access Status

Status: provider-neutral OIDC sign-in and signed-in administrator access are
implemented. Regular-user account work remains ordered after administrator
access.

Last updated: 2026-08-23.

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

### Administrator access

A signed-in administrator can open `/admin` and use the existing backend-owned
settings editor. The backend authorizes the settings API; the web route is only
a presentation entry point. During this administrator-only stage, every
identity admitted by the configured provider is explicitly treated as an
administrator. That temporary policy lives outside the identity/session shape
so ordinary Footnote users can be separated later.

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

## Next account direction

The next stage is #521: admit ordinary OIDC users without administrator access.
Every successful regular-user sign-in will resolve or create a durable
Footnote-owned account and a separate external-identity mapping. Footnote-owned
data will belong to the internal account identity, not directly to `issuer +
subject`.

Do not add regular-user storage, roles, permission tiers, persistent sessions,
provider enrollment, passwords, or account lifecycle features to the
administrator stage. Follow-on work is ordered in issue #525.

## Work sequence

1. #455 — provider-neutral OIDC sign-in (delivered)
2. #456 — signed-in administrator access (delivered)
3. #521 — durable Footnote accounts for regular OIDC users
4. #522 — deliberate incident association and safe user view
5. #523 — export explicit Footnote-owned account data
6. #524 — delete Footnote account data with documented incident retention

The sequence keeps external authentication, Footnote authorization, and
Footnote-owned data as separate decisions.
