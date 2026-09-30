# Account Identity and Access Status

Status: provider-neutral OIDC sign-in, durable Footnote accounts, separate
administrator authorization, explicit Discord connection, and the first
account lifecycle (incident association, export, deletion, and explicit user-owned
memory) are implemented.

Last updated: 2026-09-30.

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

### Explicit Discord connection

`/account connect` starts a private ten-minute transaction from the trusted
Discord interaction identity. The existing OIDC account page authenticates the
browser user and requires explicit consent; consent returns a one-time code,
not a durable mapping. `/account confirm` binds the code only when submitted by
the original Discord user. `/account status` resolves the persisted mapping
through the backend.

Footnote stores the Discord ID separately from the internal account. Repeating
a link to the same account is harmless. If that ID is linked to another
Footnote account, Footnote refuses the new link. Unfinished requests expire
after ten minutes and stay in process memory; a restart clears them. See
[Discord account connection](../auth/README.md#connect-a-discord-account).

The signed-in `/account` page shows whether the Footnote account has a durable
Discord link without exposing the Discord user ID. Disconnect requires the
account-session CSRF token and removes only Discord links owned by that Footnote
account; it does not alter any external Discord account, and users can reconnect
from Discord later.

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

Account lifecycle v1 now covers incident association, export, and deletion.
It does not add saved conversations, inferred profiles, uploads, generalized
preferences, or account merging. Follow-on work is ordered in issue #525.

### Incident reports

An account association lets its holder see only the report's ID, status, and
submitted/updated times. Account export (#523) includes that reporter-safe
projection plus the association time, but not capability material or operator
incident data. The incident remains a separately governed operational record;
claiming it does not grant review powers or make its notes part of account data.
Account deletion (#524) removes each claimed-report link and clears that
report's description, contact, and reporter identifiers. The incident, consent
record, status, remediation, and operator history remain for safety review.
Unclaimed reports are not matched by identity and remain unchanged. Deleting a
Footnote account does not change the user's sign-in or Discord accounts.

### Account export

`GET /api/account/export` downloads a versioned JSON attachment scoped to the
signed-in Footnote account. It includes the internal account row, retained OIDC
issuer/subject mappings, any deliberate Discord mapping, and the account's
incident associations with reporter-safe summaries. Footnote does not retain
the identity-provider account itself or model-provider data; the export says so.
Underlying incident reports remain separately governed operational records,
and the export excludes claim capability material, operator notes, audit data,
and incident contact/description fields.

### Explicit user-saved memory

Signed-in users can save, inspect, and forget up to 50 memory entries per
Footnote account. Each entry stores its ID, text (up to 2,000 characters), and
creation time. Memory text is included in the existing account export and is
deleted with the account. It is loaded only for authenticated web chats or
trusted Discord chats whose Discord user was deliberately linked to that same
Footnote account. A trace can show a coarse included-item count after successful
generation; it never exposes memory text or account identity.

Memory is advisory personalization context, not evidence, a trusted instruction,
or authorization. It is not extracted from conversation history.

## Work sequence

1. #455 — provider-neutral OIDC sign-in (delivered)
2. #456 — signed-in administrator access (delivered)
3. #521 — durable Footnote accounts for regular OIDC users (delivered)
4. #752 — explicit Discord account connection (delivered)
5. #522 — deliberate incident association and safe user view (delivered by PR #754)
6. #523 — export explicit Footnote-owned account data (delivered by PR #755)
7. #524 — delete Footnote account data with documented incident retention (delivered by PR #756)
8. Account lifecycle v1 — complete after #522, #523, and #524.
9. #605 — explicit user-owned memory (delivered).

The sequence keeps external authentication, Footnote authorization, and
Footnote-owned data as separate decisions.
