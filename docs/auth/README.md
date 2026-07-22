# Account Identity and Access Direction

**Last Updated:** 2026-07-22

## Status

This document records the stable direction for account identity and access. It
does not track individual implementation branches.

The first implementation is intended for Footnote administrators. The same
identity foundation should later support regular users who choose to create an
account.

See the [account identity and access status](../status/account-identity-and-access.md)
for the active delivery sequence. The current branch has its own
[account sign-in status](../status/account-sign-in.md).

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

Account login should use `/account`, even when only administrators can sign in.
This avoids treating every future account as an administrator account.

### Separate identity from permissions

The basic signed-in identity should contain only stable identity information,
such as the provider issuer and subject identifier. Names and email addresses
are useful display information, but they can change and should not be permanent
identifiers.

Administrator access should be a separate decision. Roles or other access rules
should be able to change without changing the basic login identity.

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

## References

- [Admin Settings Architecture](../architecture/admin-settings-architecture.md)
- [Setup and Settings Flow](../architecture/first-setup-flow.md)
- [Footnote Philosophy](../Philosophy.md)
- [Footnote License Strategy](../LICENSE_STRATEGY.md)
- [authentik OAuth2/OIDC provider documentation](https://docs.goauthentik.io/docs/add-secure-apps/providers/oauth2/)
- [OpenID Connect](https://openid.net/developers/how-connect-works/)
