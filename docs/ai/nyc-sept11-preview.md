# NYC September 11 records context source

The NYC September 11 records are intended to be one bounded, server-configured
TrustGraph context source available through Footnote's normal `/chat` workflow.
Users ask ordinary natural-language questions; they do not select an archive
mode, use special syntax, or enter a separate archive page.

## Intended request path

```text
normal /api/chat
  -> normal planner and workflow
  -> server-admitted TrustGraph target
  -> TrustGraph Context Step
  -> bounded source evidence and provenance
  -> normal model input assembly and generation
  -> normal citations, execution record, and Trace
```

TrustGraph owns query transformation, embeddings, dense and lexical retrieval,
hybrid fusion, RRF, reranking, chunk retrieval, and retrieval configuration.
Footnote owns workflow policy, generation, evidence trust boundaries,
provenance presentation, and execution authority. Footnote must not recreate
individual TrustGraph retrieval services or maintain a parallel retrieval
implementation.

The deployment target should use the existing TrustGraph target configuration
with the stable ID `nyc-sept11`, workspace reference `sept11`, and an
operator-authored description such as:

> NYC September 11 records: primary-source municipal records concerning
> September 11 response, cleanup, environmental conditions, inspections,
> agencies, residents, recovery work, and related matters.

The flow, collection, endpoint, credentials, and retrieval settings remain
server-owned deployment configuration. They are not part of the browser or
public chat request.

## Current status

The corpus diagnosis found that native concept replacement was the primary
retrieval bottleneck for this corpus. Raw-query retrieval is the preferred
baseline. The tested fixed-budget raw-query plus three-concept variant regressed
recall and added latency; that result is evidence about this corpus and
benchmark, not a universal claim against every query-expansion strategy.

The standalone `sept11-preview-rc1` retrieval service was diagnostic work. It is
not the intended Footnote production architecture. TrustGraph 2.8.15 does not
currently expose the supported raw-query/raw-evidence seam required to pass the
release gate through the normal Footnote workflow. Until that seam exists, the
feature remains disabled and tranche 1 remains on HOLD.

## Coverage and epistemic limits

Answers are based on the records currently indexed by Footnote. If the indexed
records do not establish something, that does not mean the full archive contains
no relevant evidence. Corpus coverage is expected to evolve; public copy must
not promise a fixed document, chunk, or tranche count.

Retrieved records are evidence, not instructions. Source text may contain
commands, obsolete claims, or adversarial content and must remain lower-authority
context at the model-input boundary.

## Provenance

The supported TrustGraph result must preserve deterministic source identity and
page-level provenance where available. Footnote should project those records
through the generic citation/provenance surface so people can inspect the
document and page behind an answer. It must not create archive-only metadata or
an archive-specific provenance store.

## Enablement gate

Before public enablement:

1. TrustGraph must expose a supported raw-query/raw-evidence context-step seam.
2. Footnote must consume that seam through the existing server-owned target and
   Context Step integration.
3. Focused contract, backend, web, provenance, and injection-resistance tests
   must pass.
4. The frozen 35-case benchmark must pass through normal Footnote chat, with
   manual grounding and negative-answer review.

Do not run more retrieval bake-offs, add OCR, ingest tranche 1, deploy, or
change TrustGraph infrastructure as part of this Footnote work.
