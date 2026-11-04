# Security Policy

Footnote is pre-1.0 software in active development. The `main` branch is the
supported development line; this policy does not promise fixes or support for
older releases.

## Report a vulnerability

Please do not open a public issue for a security or privacy vulnerability, or
a safety problem that could put people at risk before it is mitigated. Email
**footnote-security@protonmail.com** with a description, its potential impact,
and reproduction steps when available. Avoid sending credentials or private
conversation content unless it is necessary to explain the report.

The maintainer aims to acknowledge reports within 72 hours. Please allow time
for investigation before sharing details publicly.

For ordinary concerns about one assistant response, Discord has a **Report
Issue** flow. It asks for consent before creating a durable incident record;
the stored fields and privacy boundaries are described in
[Incident Handling](docs/architecture/incident-handling.md). This product
reporting flow is separate from private vulnerability disclosure.

## Handling local secrets

Keep `.env` files and credentials out of Git and public reports. If a secret
may have been exposed, revoke or rotate it at the service that issued it, then
review that service's incident guidance. Do not rely on deleting a local file
to revoke a credential.

For current deployment and setup instructions, see the
[deployment guide](deploy/README.md). This policy avoids listing hosting and
scaling details that can change independently of security reporting.
