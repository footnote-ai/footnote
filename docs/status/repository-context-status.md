# Repository Context and TrustGraph Status

Last reviewed: 2026-11-04.

Footnote has several ways to use project material. The local `project_context`
lookup searches approved documents during chat; a separate loader sends
selected files to TrustGraph; bounded GitHub metadata helps with current-state
questions. The local document lookup is not a general code-search index.
[GitHub source retrieval](../architecture/context-integrations/github.md)
has its own scope and implementation (see
[#539](https://github.com/footnote-ai/footnote/issues/539)).

## What is implemented

- `.footnote/context-files` lists repository documents that the local lookup
  may read. The resolver uses tracked files and enforces path and size limits.
- `pnpm context:repo:list` previews selected paths without reading their
  contents or contacting TrustGraph. `pnpm context:repo:load` submits the
  approved files to the configured TrustGraph Librarian API.
- Guided `/setup` can review and load the prepared document bundle when an
  operator has configured a TrustGraph destination.
- `repo_explainer` can request local project-document retrieval and, for
  current-state questions, separate bounded GitHub metadata. The backend fixes
  the repository identity to `footnote-ai/footnote`.
- Retrieved documents are advisory. Their source status and commit-pinned
  citations are carried into response details; the documents cannot change
  system instructions or policy.

See [Project Context](../architecture/context-integrations/project-context.md)
and [TrustGraph](../architecture/context-integrations/trustgraph.md) for the
request paths and configuration.

## Default and evidence limits

Local project-document retrieval is **off by default**. The checked-in
configuration test confirms that default; enabling it requires an explicit
`CHAT_CONTEXT_PROJECT_DOCS_ENABLED=true` setting and a working embedding
provider. A failed or unavailable lookup is reported as such and does not block
chat.

The 13-question offline evaluation checks that expected documents and
categories appear in the curated manifest. It also runs a synthetic
retriever: its documents contain only file paths, and deterministic fake
embeddings rank the expected path first. That exercises the retrieval
interface, but it does not read or index the actual document contents or
verify that those files are selected from the allowlist.

Separate routing tests check how an explicit `repo_explainer` intent maps to
Footnote's repository. Neither test establishes that a live planner will
choose retrieval, that real embeddings will find the right passage, or that
an answer will use and cite it correctly.

No live model or embedding provider was called for this status review. Live
planner selection, provider-backed retrieval quality, answer wording, source
use, citations, and traces remain unverified in default and intentionally
enabled deployments. Do not read the synthetic evaluation as a live readiness
claim.

Run the focused offline checks with:

```sh
pnpm exec tsx --test packages/backend/test/projectContextEvaluation.test.ts packages/backend/test/projectContextRouting.test.ts packages/backend/test/config.projectDocs.test.ts
```
