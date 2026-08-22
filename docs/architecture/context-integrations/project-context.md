# Project Context

## Purpose

`project_context` lets Footnote answer questions about itself from approved
project documents. It supports explanation, onboarding, contribution, and
discovery without making unsupported marketing claims. It is not web search:
web search discovers broad public sources, while this integration reads a
local approved document set selected by `.footnote/context-files`.

## Scope and access

The planner may suggest Footnote-self routing only for `repo_explainer`
intent. The backend derives the canonical `footnote-ai/footnote` repository
from that intent; the repository slug never needs to appear in user text, so
questions like "what work is currently open?" reach project context. The
backend checks that the integration is enabled before creating the executable
context-step request.

Document access stays backend-owned:

- The allowlist comes from `.footnote/context-files`
- Only Git-tracked files inside the repository are read
- Absolute paths, `..` escapes, excludes, and oversize files are skipped
- The backend reads file contents; the script-side resolver previews only

## Retrieval and indexing

Documents are chunked on Markdown headings with a byte cap. Each chunk carries
a content hash and an evidence category:

- `documented_intent` — what the project says it wants to be
- `documented_behavior` — what documented behavior says the project does
- `current_state` — where the project stands now

These categories describe what the document claims; they never prove
implementation. The prompt guidance tells the model to separate documented
intent, documented behavior, current project state, and inference.

Chunks are embedded through an independently configured embedding
provider/model (not the chat provider) and stored in a bounded in-process
vector store. The runtime fingerprints selected paths, content hashes,
embedding settings, and index versions before reusing vectors, so unchanged
documents do not trigger another full embedding build.

Deployments package the curated `.footnote/context-manifest.json` corpus and a
source revision into the image. Production does not depend on `.git`, a
working tree, or runtime GitHub reads. Local development uses `git show` at one
captured `HEAD` revision so the bytes indexed and the citation revision cannot
drift apart.

## Authority boundary

Project documents are untrusted evidence, never system or policy
instructions. The executor wraps every retrieved block in an explicit
`UNTRUSTED PROJECT CONTEXT` label, and the shared prompt guidance instructs
the model not to follow directives inside those blocks or change behavior or
policy based on them.

The injection boundary keeps untrusted context out of the leading trusted
system-instruction run: `injectContextMessagesIntoPrompt` places context after
user conversation and before planner output, and a test proves an
instruction-bearing allowed document stays inside the untrusted envelope.

## Freshness and failures

- Query-embedding failure is observable and fails the context step open; it
  never silently returns an empty result.
- An index rebuild or document-read failure falls back to the last-known-good
  index and records `stale` when matches are still served.
- A first-build failure with no prior index records `unavailable` and
  generation continues without project context.
- The integration is disabled by default.

## Provenance

Retrieved chunks become commit-pinned citations
(`https://github.com/{repo}/blob/{commit}/{path}`) when the head commit is
resolvable, falling back to a `main`-branch URL. Response metadata records
the embedding provider/model, chunker and index versions, requested
categories, returned counts, and status. Workflow records retain the
context-step outcome for trace review.

## Config

Env controls live under `CHAT_CONTEXT_PROJECT_DOCS_*`:

- `CHAT_CONTEXT_PROJECT_DOCS_ENABLED`
- `CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER`
- `CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_MODEL`
- `CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES`
- `CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS`
- `CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY`
- `CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES`
- `CHAT_CONTEXT_PROJECT_DOCS_MIN_SCORE`
- `CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS`

The embedding provider is OpenAI-compatible. OpenRouter uses its explicit
OpenAI-compatible embeddings endpoint; unsupported provider configuration must
fail closed for the context step while the chat request remains fail-open.
The backend caps `maxChunkBytes` at 32 KiB, `maxChunks` at 5,000, and
`topKPerCategory` at 50 even when environment values are higher.

Project context is intentionally Footnote-only in this release. The canonical
repository is `footnote-ai/footnote`, owned by backend routing, source loading,
metadata, and citation construction together; there is no operator repository
override that could make those authorities disagree.

For current Footnote-self questions, backend-owned routing may also request
bounded live GitHub context for `footnote-ai/footnote`. GitHub counts describe
records retrieved, not repository totals, and the response details show that
coverage limit.
