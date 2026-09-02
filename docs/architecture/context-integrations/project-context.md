# Project Context

## What it does

`project_context` helps Footnote answer questions about Footnote from approved
project documents. It supports explanations, onboarding, contribution, and
discovery. It does not search the web. Instead, it reads the local document
list in `.footnote/context-files`.

The feature can answer questions such as “How does Footnote work?” or “Where
should I start contributing?” It can also pair those documents with live
GitHub results when someone asks about Footnote's current state.

## Which documents it can read

The planner suggests this lookup only for Footnote explanation requests
(`repo_explainer`). The backend then selects the fixed
`footnote-ai/footnote` repository. A user does not need to write that slug.
It creates the lookup only when project context is enabled.

The backend decides which files it can read:

- `.footnote/context-files` supplies the allowlist.
- It reads only Git-tracked files inside the repository.
- It skips absolute paths, `..` escapes, excluded files, and files that are too large.
- The backend reads file content. The helper script only previews the selected paths.

## How retrieval works

Footnote splits Markdown documents at headings, keeping each excerpt under the
configured byte limit. Every excerpt has a content hash and one of these
labels:

- `documented_intent`: what the project says it wants to be.
- `documented_behavior`: what the documentation says the project does.
- `current_state`: what the document says about the project's current state.

These labels describe the document, not the implementation. The prompt tells
the model to distinguish documented intent, documented behavior, current
state, and inference.

An embedding model, configured separately from the chat model, finds relevant
excerpts. Footnote keeps the resulting vectors in memory. It reuses them only
when the selected files, their hashes, embedding settings, and index versions
still match.

For deployments, `pnpm context:bundle` reads each approved file from one Git
commit and creates the Docker build bundle. Docker checks that the same commit
was supplied as a build argument before it creates the image. This lets the
production image work without `.git`, a working tree, or a GitHub read at
runtime. Local development also reads every file from one captured `HEAD`
commit, so citations and indexed content stay aligned.

The generated bundle is intentionally untracked and not Git-ignored so Fly's
remote builder receives it in the Docker build context.

## How Footnote treats document text

Footnote treats project documents as source material. Text in those documents
cannot change system rules or policy. Retrieved excerpts are marked
`UNTRUSTED PROJECT CONTEXT`, and the prompt tells the model not to follow
instructions found in them.

The context Step returns these excerpts as bounded Evidence. The model-input
builder keeps them separate from trusted instructions and projects them as
user-level advisory data. The integration does not choose prompt roles or
depend on planner markers. A test covers a selected document that contains
instructions and confirms that it remains in the untrusted section.

## When a lookup fails or is out of date

- If the query cannot be embedded, the trace records the failure. Footnote does
  not pretend that the lookup found nothing. Chat continues without project
  documents.
- If rebuilding the index or reading documents fails, Footnote can use its
  last good index. The result is marked `stale`.
- If no earlier index exists, the result is `unavailable` and chat continues
  without project documents.
- The timeout covers index building and query embedding together. A sequence of
  batches cannot keep the chat request running beyond that limit.
- The feature is off by default.

## Citations and response details

Footnote cites an excerpt only when it can create a link pinned to the source
commit:

`https://github.com/{repo}/blob/{commit}/{path}`

If it cannot create that link, the prompt marks the citation as unresolved and
the response does not include it. Footnote never substitutes a moving branch
link. Response metadata includes the embedding provider and model, index and
chunking versions, requested categories, returned excerpt counts, and source
status. The workflow trace keeps the lookup outcome.

## Configuration

The environment settings begin with `CHAT_CONTEXT_PROJECT_DOCS_`:

- `CHAT_CONTEXT_PROJECT_DOCS_ENABLED`
- `CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER`
- `CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_MODEL`
- `CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES`
- `CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS`
- `CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY`
- `CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES`
- `CHAT_CONTEXT_PROJECT_DOCS_MIN_SCORE`
- `CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS`

The embedding provider uses the OpenAI-compatible API. OpenRouter uses its
embeddings endpoint. An unsupported provider makes this lookup unavailable;
the chat request still continues. The backend caps `maxChunkBytes` at 32 KiB,
`maxChunks` at 5,000, and `topKPerCategory` at 50, even if the environment
requests higher values.

This release supports Footnote only. The backend uses
`footnote-ai/footnote` consistently for routing, document loading, metadata,
and citations. Operators cannot override it.

For Footnote current-state questions, the backend can also request live GitHub
results from `footnote-ai/footnote`. Those counts show records returned, not
the total number of issues, pull requests, releases, or commits in the
repository.
