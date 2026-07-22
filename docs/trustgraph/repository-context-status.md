# Repository Context and TrustGraph Status

Status: direction agreed; the next branches are not implemented yet.

Last updated: 2026-07-22.

## Goal

Let a repository define the files Footnote may use as project context, then make
it easy to load those files into TrustGraph and use them during chat.

The setup should stay understandable for someone new to the project. Product
docs and setup screens should say things like:

- repository context
- connect TrustGraph
- review files
- load context
- refresh context

Internal code may still use more specific architecture terms where they are
needed, but users should not have to learn them to finish setup.

## Current State

Footnote already has a guarded TrustGraph lookup path. It can call an outside
service for extra context, record what happened, and continue without that
context if the service is unavailable.

The repository-loading test is still limited. It uses a small, hand-written
file at `docs/trustgraph/repo-snapshot.json`. It does not yet read the
repository's real documentation or connect directly to TrustGraph's document
API.

That test file should remain only until the real repository context path is
working.

## Repository Context File

The agreed location is:

```text
.footnote/context-files
```

The file will use familiar include and exclude patterns:

```gitignore
# Files available as repository context
README.md
AGENTS.md
docs/**/*.{md,mdx,txt}

# Remove files matched above
!docs/archive/**
!docs/generated/**
```

The first version should:

- use `globby` for pattern matching
- consider Git-tracked files only
- respect `.gitignore`
- return files only, not directories
- avoid following links outside the repository
- sort paths for stable output
- enforce clear file-count and file-size limits
- provide a preview before anything is sent to TrustGraph

This file becomes the repo-owned source for previews, loading, refreshes, and
source links.

## Planned Branches

### 1. Choose repository context files

Add `.footnote/context-files`, the file resolver, tests, and a command that
lists the selected files. This branch does not contact TrustGraph.

Done when a contributor can review one stable list of repository context files.

### 2. Load repository context into TrustGraph

Use the selected files with TrustGraph's document or text API. Record the
repository-relative path and a content hash for each file. Repeated loads should
report which files were added, changed, unchanged, skipped, or failed.

Once this works, remove the hand-written snapshot and its manual loader.

Done when the selected Footnote docs can be loaded into a local TrustGraph
instance and inspected there.

### 3. Use TrustGraph context in chat

Connect the existing backend lookup path to TrustGraph's normal query API. Keep
access checks, timeouts, source records, and the rule that Footnote continues
without TrustGraph when a lookup fails.

This branch also needs one clear local-development access-check path. The docs
must not describe that check as optional when the backend requires it.

Done when a scoped chat request can use repository context from TrustGraph and
show that use in its response details.

### 4. Add guided setup

Add a Context integrations section to first setup. It should let the user:

1. choose whether to use TrustGraph
2. enter and test connection settings
3. choose whether to load repository context
4. review the selected files and total size
5. load the files and see progress

Done when a new user can complete the flow without editing YAML or running a
manual loading command.

## Later Work

A hosted TrustGraph option can come after the local path works. Local and hosted
setups should use the same repository context file and the same backend
connection boundary.

Automatic refresh, background jobs, broader source-code loading, and hosted
service billing are not part of the first branches.

## Related Docs

- [TrustGraph architecture](../architecture/context-integrations/trustgraph.md)
- [Context integrations](../architecture/context-integrations/README.md)
