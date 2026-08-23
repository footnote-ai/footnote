# Authelia-on-Fly Single-Instance Profile

**Status:** accepted for a limited deployment profile.

Footnote supports OIDC. Deployment tooling may support specific identity
providers. The runtime does not know which provider was selected.

The Fly deploy wrappers may optionally provision Authelia 4.39.20 and pass the
four standard OIDC values to Footnote. Authelia is deployment tooling, not a
backend provider adapter. The profile is intentionally single-instance and
non-HA: it uses one 512 MB Machine, one 1 GB volume, the file user backend, and
local SQLite storage.

This profile does not provide production identity storage, password reset, MFA
enrollment, SMTP notifications, LDAP, custom domains, or multi-machine
coordination. Operators must treat the generated Authelia volume and Fly
secrets as the owner-controlled identity system.

The static user database is mounted at `/config/users.yml`. The persistent
`/data` volume is reserved for SQLite and notification state.
