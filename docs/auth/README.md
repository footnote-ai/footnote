# Account Identity and Access Direction

**Last Updated:** 2026-07-22

## Status

This document records the current direction. It is not a complete implementation
plan or a final provider decision.

The first implementation is intended for Footnote administrators. The same
identity foundation should later support regular users who choose to create an
account.

See the [high-level delivery roadmap](./roadmap.md) for the intended order of
small working slices.

## Why Footnote Needs This

Footnote currently supports anonymous use and temporary setup access. It does
not have a general account login.

A general login becomes useful when people need to:

- update their own stored information
- save preferences or history
- review consent choices
- request deletion of account-linked data

Administrators also need a safer way to reach future instance-management tools.
The current setup link and admin token are useful bootstrap tools, but they are
not the intended long-term login experience.

## Plain-Language Model

The identity provider answers:

> Who signed in?

Footnote answers:

> What may this person do here?

Keeping those questions separate prevents an identity provider from becoming
the owner of Footnote's settings, consent, retention, provenance, incident, or
review rules.

## Current Direction

### Use a standard identity boundary

Footnote should connect to identity providers through OpenID Connect (OIDC)
where practical. This keeps the boundary familiar and replaceable.

authentik remains a strong self-hosted option. A compatible cloud identity
service may also be useful for deployments that do not want to operate their own
identity system. The first implementation should avoid provider-specific
behavior unless it is needed and clearly isolated.

### Keep the backend in charge

`packages/backend` remains the public authentication and access boundary for
the web app and other Footnote clients.

The browser should not decide that someone is an administrator. It should ask
the backend whether the current session is signed in and whether a protected
action is allowed.

The agent runtime should not own account identity or access decisions.

### Separate account pages from administrator pages

The intended route meanings are:

- `/account`: the signed-in person's own information and preferences
- `/admin`: instance-wide administration
- `/api/auth/*`: backend login, callback, session, and logout operations

The first login page should use `/account`, even when only administrators can
sign in. This avoids treating every future account as an administrator account.

### Separate identity from permissions

The basic signed-in identity should contain only stable identity information,
such as the provider issuer and subject identifier. Names and email addresses
are useful display information, but they can change and should not be permanent
identifiers.

Administrator access should be a separate decision. During the first slice,
every identity admitted to the Footnote application may be treated as an
administrator. Later work can add roles or other access rules without changing
the basic login identity.

## First Working Slice

The first slice should prove one small flow:

1. An approved administrator visits `/account`.
2. They choose **Sign in**.
3. An OIDC provider confirms their identity.
4. Footnote creates its own short-lived session.
5. `/account` shows the signed-in identity.
6. The administrator can sign out.

Likely backend operations are:

- start login
- receive the provider callback
- return the current session identity
- sign out

Exact endpoint names, library choices, cookie settings, and configuration keys
belong in the implementation plan. They should not be fixed by this direction
document before the code path is reviewed.

### Expected limits of the first slice

- Only administrators are admitted.
- There are no roles or administrator levels.
- Login does not yet grant access to the admin settings API.
- Existing setup links and admin-token behavior remain unchanged.
- Sessions may be temporary and may end when the backend restarts.
- Public Footnote features continue to work when account login is disabled.

This gives us a real end-to-end login without also changing configuration
authority.

## Later Slices

Likely follow-up work includes:

- connect authenticated administrator sessions to selected `/api/admin/*`
  operations
- add the `/admin` web surface
- decide how administrator access is assigned and reviewed
- support regular user accounts on `/account`
- add account-linked preferences, consent, retention, and deletion controls
- decide whether sessions need persistent storage

These are directions, not a commitment to one large account system. Each slice
should be justified by a concrete need.

The roadmap keeps these outcomes on separate branches so the first login change
does not grow into the full account and administration system.

## Provider Options

### authentik

authentik is still the leading self-hosted candidate because it supports OIDC,
fits community-run deployments, and can keep identity infrastructure under the
deployment owner's control.

### Cloud identity services

A cloud provider may reduce setup and maintenance for some deployments. Footnote
should be able to use one without moving Footnote-owned access, consent, or data
rules into that provider.

### Other self-hosted providers

Other OIDC-compatible providers should remain possible. We should prefer a
small standards-based integration over a broad provider abstraction created
before we have evidence that it is needed.

## Relationship To Current Setup Access

The current setup session is a temporary bootstrap mechanism. It proves that a
person has a short-lived setup code. It does not represent a general account.

Account sessions should be modeled separately. Later administrator work may
allow an account session to access settings, but it should not silently turn a
setup session into a permanent identity.

## Terminology

Use **administrator** or **admin** for people who manage a Footnote instance.
Use **user** for a person using the service, including someone with a personal
account.

Some implemented setup API names still contain `operator`. Those names describe
the current contract and should remain accurate in current-system docs until a
follow-up change renames the code and API together.

## What This Direction Does Not Decide

This direction does not yet choose:

- the first production identity provider
- an OIDC client library
- exact configuration keys
- session storage technology
- role or permission shapes
- account database tables
- consent or retention data models
- whether every deployment must enable accounts

Those decisions should be made as the relevant working slice is planned.

## References

- [Admin Settings Architecture](../architecture/admin-settings-architecture.md)
- [Setup and Settings Flow](../architecture/first-setup-flow.md)
- [Footnote Philosophy](../Philosophy.md)
- [Footnote License Strategy](../LICENSE_STRATEGY.md)
- [authentik OAuth2/OIDC provider documentation](https://docs.goauthentik.io/docs/add-secure-apps/providers/oauth2/)
- [OpenID Connect](https://openid.net/developers/how-connect-works/)
