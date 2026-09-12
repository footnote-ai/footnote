# Shared Document Facts and Projection Boundaries

**Status:** Accepted

**Date:** 2026-09-12

## Context

The wiki, runtime `project_context`, DeepWiki, TrustGraph, GitHub integration, and future machine-readable documentation all refer to material in this repository. Some of their metadata overlaps. Issue [#651](https://github.com/footnote-ai/footnote/issues/651) asked whether that overlap justified a common document model.

## Decision

We do not need a shared document model or a universal document allowlist.

The systems need a common way to identify the source they refer to:

1. **Repository identity** identifies the repository. For Footnote-owned references, `footnote-ai/footnote` is the canonical serialized form; integrations may derive the URL or URI form they require.
2. **Repository-relative source path** identifies a file within that repository. It uses POSIX separators and has no leading slash, dot segments, parent segments, or empty segments.
3. **Exact revision, when present,** identifies the revision the consumer actually read or built. If the consumer cannot prove that revision, it must omit it and must not present another revision as exact provenance.

Checked-in repository files and Git history remain authoritative. These facts can travel through existing contracts and generated documentation without creating a new `Document` type. TrustGraph's configurable and persisted repository identifier remains its integration concern; changing its representation would require a separate migration decision.

## What remains separate

Each projection continues to own its own policy:

- the wiki decides what is public, how lifecycle is shown, and how routes and links are generated;
- `project_context` decides eligibility, categories, priorities, limits, and retrieval behavior;
- DeepWiki keeps its own entrypoints, notes, and vendor configuration;
- TrustGraph keeps ingestion, target, and workspace policy;
- GitHub integration keeps its metadata and exact-object retrieval behavior;
- [#539](https://github.com/footnote-ai/footnote/issues/539) remains responsible for bounded runtime source retrieval; and
- future machine-readable documentation or MCP interfaces expose approved projections without becoming a new authority.

Two systems referring to the same file does not mean that they share its eligibility, lifecycle, trust, or retrieval policy. Public documentation metadata therefore cannot override backend retrieval, provenance, privacy, or authority decisions.

## Why

The current implementations support a small identity contract, not a larger shared model:

- wiki lifecycle values (`current`, `proposal`, and `historical`) describe publication state, while `project_context` categories describe the meaning of runtime evidence;
- a project-context chunk hash and a TrustGraph full-file hash identify different content and serve different indexing purposes;
- a wiki link to `main` and a commit-pinned project-context citation make different revision claims; and
- overlapping file lists in `stage-content.mjs`, `.footnote/context-files`, `.footnote/context-manifest.json`, `.devin/wiki.json`, and TrustGraph configuration reflect different selection policies, not one allowlist.

## Consequences

[#652](https://github.com/footnote-ai/footnote/issues/652) can reuse repository, path, and verified revision identity while keeping public-documentation policy in the wiki projection. #539 can use the same source vocabulary without inheriting public publication policy. A future MCP interface can transport approved projection data without becoming the repository's document authority.

If later duplication justifies a helper, add the smallest helper at the existing seam and keep it limited to these facts.
