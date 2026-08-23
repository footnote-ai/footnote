# Account Identity and Access Status

Status: basic account sign-in is implemented and under human review.

Last updated: 2026-08-23.

This tracker describes the expected order of work. It stays high-level on
purpose. Each implementation branch gets its own status document before code
changes begin.

## Delivery Approach

Prefer a small branch that produces one working result over separate backend,
web, and configuration branches that cannot be used on their own.

Each branch must:

- have one clear user-visible or administrator-visible outcome
- keep existing public and setup behavior working
- include the tests and documentation needed for its change
- avoid building later account features early

## 1. Basic Account Sign-In

Branch: `feat/account-sign-in`

Branch status: [Account Sign-In Status](./account-sign-in.md)

Branch result: implemented and tested. The completed slice provides the
provider-neutral OIDC login, callback, temporary session, identity display, and
local sign-out flow described below. Authentik 2026.8.0 was used for the
completed manual smoke test.

Outcome:

> An approved administrator can sign in, view their identity on `/account`, and
> sign out.

High-level scope:

- backend-owned OIDC login, callback, session, and logout behavior
- a small `/account` page
- temporary Footnote sessions
- the minimum provider configuration needed to run the flow
- focused tests and deployment instructions

Authentik is the provider used for the initial compatibility test, not a
Footnote runtime dependency. Footnote supports standard OIDC behavior.
Deployment tooling may support particular providers, but the runtime receives
only the standard OIDC configuration values and does not know which provider
was selected.

Not included:

- `/admin`
- access to admin settings
- roles or permission levels
- regular-user data
- persistent sessions
- a broad abstraction for providers we have not tested

## Proposed Follow-Up: Deployment Authentication Setup

This is a proposed deployment slice, not part of the completed account sign-in
work. Its purpose would be to make the first-run choices clear:

1. Run without account sign-in.
2. Set up a supported self-hosted provider.
3. Use an existing OIDC provider.

The authenticated choices must both produce the same four Footnote bootstrap
values: `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and
`OIDC_REDIRECT_URI`. The deployment layer may eventually provide an Authelia
profile, but that should wait until a compatibility spike and operational
review prove it is a good fit. No provider-specific runtime contract should be
added.

## 2. Administrator Access

Branch: `feat/admin-account-access`

Outcome:

> A signed-in administrator can reach selected Footnote administration tools.

High-level scope:

- add the `/admin` surface
- make an explicit administrator access decision in the backend
- allow administrator sessions on selected `/api/admin/*` operations
- connect the existing settings experience where appropriate
- keep setup links available for bootstrap and recovery
- include safe administrator identity details in audit events

The first access rule is simple: every account admitted during this
administrator-only stage is an administrator. More detailed permissions wait
for a real need.

## 3. Regular-User Account Features

This work starts only when Footnote has a specific account feature to deliver.
Examples include saved preferences, consent controls, personal data export, or
account deletion.

Name each branch after its outcome, such as `feat/account-preferences`, rather
than creating one broad `user-system` branch.

This keeps user storage and permission decisions tied to real product behavior.

## Add Infrastructure When It Becomes Necessary

Create an infrastructure branch only when its need exists:

- persistent sessions when restart-driven sign-outs are no longer acceptable
- shared session storage when more than one backend instance needs it
- provider-specific handling when another provider exposes a real difference
- administrator roles when administrators need different levels of access

These are not part of the initial sequence. Do not build them only because they
could be useful someday.

## Expected Order

1. deliver basic `/account` sign-in
2. connect signed-in administrators to `/admin`
3. add regular-user features one concrete need at a time

The [account identity direction](../auth/README.md) remains the source for the
shared boundaries behind these slices.
