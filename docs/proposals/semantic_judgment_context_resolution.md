# Jev and conversation context

**Status:** Investigation summary; no production integration.
**Updated:** 2026-09-28

A recent-message window can miss the earlier message that makes a conversation
make sense. We investigated whether semantic judgments could help Footnote
find that context without sending a large chunk of history to the answering
model.

Jev looks promising for selecting much less context. We have not shown that
it produces better final answers. That is a reason to keep the findings and
be specific about the next question, not to reject semantic judgment or build
a permanent runtime around it yet.

## What we learned

The experiments used a frozen set of 100 synthetic conversation cases. BM25,
a cheap keyword-ranking method, combined with nearby and related messages
was a strong baseline. It recovered more of the needed context than the
recent window alone.

Three different experiments followed, and their results should stay separate:

- A generic hosted semantic selector compressed context well. In the small
  matched answer comparison, it did not improve answer quality over the cheap
  baseline. This selector was not Jev.
- Hosted Jev selected about 1.5 messages per case, compared with about 15 for
  BM25 plus deterministic expansion, while retaining similar recall of needed
  messages. This was one recorded run, not a production estimate.
- The tested OpenJEV checkpoint ran locally on the RX 7800 XT through WSL2 and
  ROCm. Its Python reference implementation and temporary HTTP bridge proved
  local feasibility. They did not establish that Jev requires Python or that
  Footnote should add a model-serving sidecar.

The hosted Jev follow-up replayed 20 cases through Footnote's chat endpoint.
Only six produced answers for both selectors: both answers were sufficient
in two cases, only BM25's in three, and only Jev's in one. The reviewer also
found unsupported claims in five of the 17 Jev-backed answers it reviewed.
The unequal answer counts, small synthetic sample, and model-assisted review
limit what we can conclude. Compression is the clearest result; better
answers remain unproven.

We also tried one claim/evidence question. A single borderline result tells
us little about whether Jev would help with that separate task.

## What is worth following up

The next useful question is whether a smaller context can preserve answer
support consistently, including older references and ambiguous replies. A
larger labeled comparison could test that against the same cheap baseline.
Broader uses, such as checking claims against evidence, need their own examples
and measurements. [#715](https://github.com/footnote-ai/footnote/issues/715)
tracks the investigation; [#741](https://github.com/footnote-ai/footnote/issues/741)
tracks the direct Jev work.

There is no need to choose a permanent `JudgmentRuntime`, conversation graph,
or serving stack from these results. Keep the experimental code and reports
as references rather than merging them into production.

## Boundaries to keep

A judgment is evidence, not permission. Its confidence cannot authorize an
action, override retrieval or safety policy, or become an official truth label.
Initial shadow evaluation must leave the actual model input unchanged; using
judgments to select live context needs a separate decision. Disabled,
unavailable, failed, or uncertain selection must preserve the existing
deterministic context path and history-window fallback, not a partly pruned
result. Any future semantic resolution must respect the existing
`runtimeConfig.contextManager.enabled` gate.

Before searching beyond the current context, define the channel, thread,
user, or deployment scope and check access to each candidate. Record that
check and keep unauthorized content out of context, model input, and traces.
Use sanitized or consented evaluation data, respect local-versus-hosted data
rules, and avoid retaining duplicate private messages just to explain a score.
Public Trace should not expose private candidates or hidden prompts.

This work is independent of [BAML](./baml_typed_model_function_consolidation.md).
Choosing a tool for typed model functions does not decide how to run a native
classifier.

## Evidence

- [Cheap baselines and generic semantic selection](https://github.com/footnote-ai/footnote/blob/9ce1beb13916a0020331983a4f25915c0cd5f08f/docs/evaluations/context-selection-evidence-717.md) and [answer review](https://github.com/footnote-ai/footnote/blob/9ce1beb13916a0020331983a4f25915c0cd5f08f/docs/evaluations/context-selection-answer-quality-717.md) — #733, #735, #736, and #739.
- [Local OpenJEV benchmark](https://github.com/footnote-ai/footnote/blob/034a4ab4322c3f0f959a4dcafd4f8c664ac2d56a/docs/evaluations/openjev-runtime-benchmark-718.md) — #738.
- [Hosted Jev benchmark](https://github.com/footnote-ai/footnote/blob/d13885a28beb059065686d6c6f98c127bdb39390/docs/evaluations/direct-openrouter-jev-743.md) and [downstream answer replay](https://github.com/footnote-ai/footnote/blob/0f7d0f3927c7219becbc75e7253cc87a6e41a6ee/docs/evaluations/direct-jev-downstream-support-741.md) — #743, #745, and #750. The replay report identifies which raw answer artifacts remain local rather than committed.
