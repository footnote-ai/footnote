# Security Policy

A security problem in an AI assistant isn't always a compromised server.
It might be a private message leaking, a tool running without permission, or
a misleading record of what the assistant did. Footnote treats serious
privacy, provenance, and ethical-safety failures as security concerns too.

## Report a vulnerability

Please email **footnote-security@protonmail.com** rather than opening a public
issue if you've found a security or privacy vulnerability, or a safety problem
that could put people at risk. Describe what happened, its possible impact,
and how to reproduce it if you can. Don't include credentials or private
conversation content unless that information is needed to explain the report.

Reports will be acknowledged within 72 hours. Investigation and remediation
may take longer; please give the maintainer a chance to investigate before
disclosing details publicly.

For problems with an individual answer, Discord also has a **Report Issue**
flow. It asks for consent before saving an incident report. The information
retained and its privacy protections are described in
[Incident Handling](docs/architecture/incident-handling.md). This is separate
from private vulnerability reporting.

## Supported versions

Footnote is pre-1.0 software in active development. The `main` branch is the
supported development line; older releases do not have a guaranteed
security-update schedule.

## Protect local credentials

Keep `.env` files, API keys, and other secrets out of Git and public issue
reports. If a secret may have been exposed, revoke or rotate it at the
issuing service and follow its incident guidance. Deleting a local file
doesn't revoke a compromised credential.

Deployment and hosting details live in the
[deployment guide](deploy/README.md), rather than in this reporting policy.
