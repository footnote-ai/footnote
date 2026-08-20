# GitHub Context Status

## Implemented

Issue #491 adds a backend-owned, read-only `github_context` workflow
integration. Supported sections are repository metadata, open issues, open
pull requests, releases, and recent commits. Retrieval is disabled by default
and uses bounded GET-only requests, sanitization, fail-open execution, short
in-process caching, citations, and typed response metadata. GitHub response
metadata is propagated into response details as part of the public response
metadata contract.

## Limitations

Generic repository selection requires an explicit `owner/repo` slug in the user
conversation. Footnote-self current-state questions are a narrow exception:
the backend may select the fixed `footnote-ai/footnote` repository for
`repo_explainer` intent. There is one backend-held read-only credential; there
is no per-user OAuth, durable cache, webhook, or write operation. Private
repositories additionally require an exact configured allowlist.

## Next work

Web and Discord present bounded source, freshness, and coverage summaries from
the backend-owned metadata. Counts at the configured record limit are shown as
limited retrievals, never as repository totals.
