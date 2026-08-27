# Repository Context and TrustGraph Status

Status: repository context selection, preview, manual TrustGraph loading, and
the guarded multi-target Graph RAG chat integration are implemented. Guided
setup remains separate follow-up work.

Last updated: 2026-08-27.

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

Repositories define eligible context files through `.footnote/context-files`
and preview the safe, tracked selection with `pnpm context:repo:list`.
Repository context is not loaded by default. The preview resolver does not read
file contents or contact TrustGraph.

An operator can now load the selected text files with
`pnpm context:repo:load`. The command uses TrustGraph's Librarian API directly,
keeps the repository-relative path and SHA-256 content hash with every
document, and reports added, changed, unchanged, skipped, and failed files.
The earlier hand-written snapshot and seed loader have been removed.

The backend Graph RAG adapter calls TrustGraph 2.8's flow-scoped endpoint with
bounded retrieval limits and requires returned source URIs before consuming a
generated response. The current deployment supplies three explicitly
configured targets. Responses are bounded per target and across that set:
oversized generated responses are retained as explicitly marked excerpts,
while oversized HTTP bodies still fail open. Each successful target becomes
one aggregate advisory evidence item with target identity, collection, source
URIs, and titles retained in provenance. A shared 60-second default retrieval
timeout covers the target set, and partial target failures preserve successful
results. TrustGraph derives authorization from the bearer token; an optional
workspace reference only routes the request.

## Interim Project Context Path

Issue #490 adds a direct local document lookup for Footnote explanations and
discovery. It reads the `.footnote/context-files` allowlist, splits approved
documents into excerpts, reuses an index when the content still matches, and
uses a separately configured embedding model to find relevant excerpts. It
serves `project_context` without TrustGraph. Current-state questions can also
use a limited set of live GitHub results. TrustGraph remains the longer-term
external retrieval option. See
[Project Context](../architecture/context-integrations/project-context.md).

## Repository Context File

The agreed location is:

```text
.footnote/context-files
```

The file will use familiar include and exclude patterns:

```gitignore
# Files selected if repository context is enabled
README.md
AGENTS.md
SECURITY.md
MIT_LICENSE.md
HIPPOCRATIC_LICENSE.md
docs/**/*.md

# Exclude files matched above by prefixing a pattern with !
# Example: !docs/archive/**
```

The first version now does the following:

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

## Load into TrustGraph

Start a local TrustGraph instance, choose an existing processing flow, then
preview and load the repository selection:

```powershell
$env:TRUSTGRAPH_URL = "http://localhost:8888"
$env:TRUSTGRAPH_WORKSPACE = "default"
$env:TRUSTGRAPH_FLOW_ID = "<local-flow-id>"
$env:TRUSTGRAPH_COLLECTION = "footnote-repository-context"

pnpm context:repo:list
pnpm context:repo:load
```

Set `TRUSTGRAPH_TOKEN` when the local Librarian endpoint requires bearer
authentication. The token is read only from the environment and is not included
in logs or results. Run `pnpm context:repo:load -- --help` for equivalent
command-line options.

The loader sends one `add-document` request per selected file. The existing
1 MiB per-file limit keeps each file below TrustGraph's chunking threshold.
Every request includes the chosen workspace. Processing uses the Librarian API's
`add-processing` and `remove-processing` operations.

Document and processing IDs are stable for a repository ID and relative path.
On a repeat load:

- the same content hash and existing processing submission are unchanged
- a missing processing submission is repaired
- changed content replaces the old document and processing submission
- a failure for one file is reported while the loader continues with other
  files
- remote documents that are no longer selected are reported and left unchanged

An `added` or `changed` result means the document was stored and processing was
submitted. TrustGraph may still be processing it asynchronously.

## Completed and planned work

### 1. Choose repository context files

Implemented on `feature/repository-context-files`: `.footnote/context-files`,
the file resolver, tests, and a command that lists the selected files. This
work does not contact TrustGraph.

Done when a contributor can review one stable list of repository context files.

### 2. Load repository context into TrustGraph

Implemented by the setup-time Librarian loader and
`pnpm context:repo:load`. It records the repository-relative path and content
hash and supports repeatable reconciliation without adding runtime authority.

Done when the selected Footnote docs can be loaded into a local TrustGraph
instance and inspected there. Multiple explicitly configured collections may
be used by the runtime; unconfigured collections are not discovered.

### 3. Use TrustGraph context in chat

Implemented in the backend workflow context-step path. A scoped request runs
deployment ownership validation, queries the explicitly configured target set
under one shared timeout and aggregate source/response budget, and preserves
successful results when one target fails. Generated Graph RAG text reaches
final generation as labeled user-level advisory context, not as a system
instruction or source fact. Target, collection, source, and failure details
remain visible through governed provenance and metadata, while local chat
continues when retrieval is unavailable.

Done when a scoped chat request can use repository context from TrustGraph and
show that use in its response details. This is complete; the three-target live
deployment path is validated separately from this status document.

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
