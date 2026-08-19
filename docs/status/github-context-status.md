# GitHub Context Status

## Implemented

Issue #491 adds a backend-owned, read-only `github_context` workflow
integration. Supported sections are repository metadata, open issues, open
pull requests, releases, and recent commits. Retrieval is disabled by default
and uses bounded GET-only requests, sanitization, fail-open execution, short
in-process caching, citations, and typed response metadata.

## Limitations

Repository selection requires an explicit `owner/repo` slug in the user
conversation. There is one backend-held read-only credential; there is no
per-user OAuth, durable cache, webhook, write operation, or public API change.
Private repositories additionally require an exact configured allowlist.

## Next work

Web and Discord only receive metadata today. Rendering source and freshness
status is deferred to #494.
