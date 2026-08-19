# GitHub Context

## Purpose

`github_context` adds bounded GitHub repository state to a response. Results
reflect current repository state when retrieval succeeds, but may also be
partial, stale, or unavailable. It is not web search: web search discovers
broad public sources, while this integration reads a single user-named
`owner/repo` through fixed GitHub REST endpoints.

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
issues, open pull requests, releases, and commits. Each section returns at
most five sanitized records. Control characters are removed and text is
length-bounded. Repository text is injected with an explicit **untrusted
context** label; it cannot select routing, policy, verification, or terminal
state.

## Freshness and failures

The total retrieval timeout is capped at five seconds. Successful data is
fresh for one minute in a bounded in-process cache (32 repositories). A live
failure may use cached sanitized data up to fifteen minutes old and records
`stale` with the original fetch timestamp. Section failures produce `partial`
when other sections succeed. Complete failures produce `unavailable` and
generation continues without GitHub context.

## Provenance

Canonical GitHub object URLs become citations. Response metadata records the
repository, requested sections, status, fetch time, returned counts, failed
sections, and bounded reason codes. Workflow records retain the context-step
outcome for trace review.
