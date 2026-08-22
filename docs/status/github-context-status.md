# GitHub Context Status

## Implemented

Issue #491 adds a read-only `github_context` workflow integration. The backend
can retrieve repository metadata, open issues, open pull requests, releases,
and recent commits. The feature is off by default. It uses GET requests, cleans
returned text, keeps a short in-process cache, adds citations, and records the
results in typed response metadata. Chat continues if the lookup fails.

Web and Discord show source, freshness, and coverage summaries from backend
metadata. When a count reaches the configured record limit, the UI says that
the results may be incomplete. It never presents the count as a repository
total.

## Limitations

For a general repository, the user must include an `owner/repo` slug.
Footnote-current-state questions are a narrow exception: the backend may select
the fixed `footnote-ai/footnote` repository for `repo_explainer` requests.
There is one read-only backend credential. There is no per-user OAuth, durable
cache, webhook, or write operation. Private repositories also need an exact
configured allowlist.
