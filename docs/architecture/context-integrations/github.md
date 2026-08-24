# GitHub Context

## Purpose

`github_context` adds a limited set of GitHub results to a response. When the
lookup succeeds, those results describe the repository at that time. They can
also be partial, stale, or unavailable. This is not web search: it reads one
repository through fixed GitHub REST endpoints. For questions about Footnote's
current state, the backend can use `footnote-ai/footnote` without requiring a
user to include the repository slug.

## Scope and access

The planner may suggest a repository and optional sections only when the exact
slug appears in user-authored conversation text. The backend validates that
suggestion and creates the context-step request. The planner cannot choose
credentials, private access, request limits, caching, or policy.

Public repositories need no token. Private access requires an exact configured
allowlist match and the backend-held read-only token. Tokens are never logged,
prompted, cached as keys, or emitted in metadata.

## Requests and normalization

The integration uses only GET requests for `/repos/{owner}/{repo}`, open
issues, open pull requests, releases, and commits. A user-authored, validated
reference can additionally select one exact read-only object endpoint for a
pull request, issue, commit, or release. Exact retrieval runs before broad
sections, so a merged or older object does not depend on an open/recent listing.
Each broad section returns at most five cleaned records. A returned count is a
count of records retrieved, not the repository total. Footnote removes control
characters and limits text length. Repository text is marked **untrusted
context**. It cannot choose routing, policy, verification, or when execution
ends.

Planner references are advisory. The backend only executes an exact reference
when the identifying material is also present in user-authored conversation and
the repository slug is validated. Invalid, ambiguous, missing, or unavailable
objects remain explicit metadata outcomes and do not block bounded discovery.

## Freshness and failures

The total retrieval timeout is capped at five seconds. Successful data is
fresh for one minute in a bounded in-process cache (32 repositories). A live
failure may use cached sanitized data up to fifteen minutes old and records
`stale` with the original fetch timestamp. Section failures produce `partial`
when other sections succeed. Complete failures produce `unavailable` and
generation continues without GitHub context.

## Provenance

GitHub object URLs become citations. Response metadata records the repository,
requested sections, exact-reference status when requested, fetch time,
per-section limit, returned counts, failed sections, and reason codes. The
workflow trace keeps the lookup outcome. Web and Discord show the source status
without exposing credentials or private access settings.
