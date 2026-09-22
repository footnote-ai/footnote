<!--
@description: Evidence record for the first context-selection benchmark slice.
@footnote-scope: test
@footnote-module: ContextSelectionBenchmarkReport
@footnote-risk: medium - Benchmark interpretation can influence later context architecture.
@footnote-ethics: high - The corpus is synthetic and must not become a path for private transcript retention.
-->

# Context-selection benchmark (#717)

Status: **benchmark harness and deterministic baseline slice complete; OpenJEV
runtime gate remains unavailable on this machine**.

Run date: 2026-09-22

Base: `origin/main` at `6fa7416ae8ff5e8d052dac67a2ae10eb074d6d58`

Artifact: `artifacts/context-selection-717/results.json`
Summary artifact: `artifacts/context-selection-717/summary.md`

## Corpus

The committed harness builds 100 synthetic, structurally faithful Discord
turns. It does not copy production or private transcripts. Each turn contains
40 candidate messages and reference labels for messages that are:

- necessary;
- useful;
- distracting; or
- irrelevant by omission from the first three sets.

The cases cover trigger-only turns, immediate and distant context, old relevant
history, reply ancestry, one relevant branch among chatter, simultaneous
conversations, topic switches, pronoun resolution, same-author continuation,
scattered context, high-similarity distractors, and historical context that
should not be recovered.

The current backend behavior is modeled as the Discord 24-message non-system
window in `packages/backend/src/services/conversationContextService.ts`. The
harness does not call production context selection or change production input.

## Compared methods

| Method                                     | Result in this slice                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Current 24-message window                  | Completed; fail-open baseline                                           |
| Recency plus deterministic reply expansion | Completed                                                               |
| BM25-style lexical retrieval               | Completed                                                               |
| Dependency-free hash embedding proxy       | Completed; not a neural embedding                                       |
| Existing cross-encoder/reranker            | Explicitly unavailable; no configured dependency in Footnote            |
| OpenJEV                                    | Explicitly unavailable; no Transformers runtime or GPU in this checkout |

The hash embedding is included only as a reproducible local comparison point.
It must not be described as evidence from a neural embedding model.

## Recorded result

The generated summary recorded these aggregate values:

| Method                    | Necessary recall | Useful precision | Distracting rate | Avg messages |
| ------------------------- | ---------------: | ---------------: | ---------------: | -----------: |
| Current window            |            0.647 |            0.048 |            0.022 |       24.000 |
| Recency + reply expansion |            0.752 |            0.054 |            0.022 |       24.160 |
| BM25                      |            0.895 |            0.064 |            0.025 |       24.000 |
| Hash embedding proxy      |            0.797 |            0.058 |            0.015 |       24.000 |

The artifact also records candidate count, retrieval depth, estimated input
tokens, historical-distance recovery, branch expansion count, and local
harness latency. Model-backed unavailable rows are kept separate from zero
quality scores.

## OpenJEV verification

The current upstream `AlexWortega/openjev` repository documents the
`qwen3.5-0.8b-nli-v2s-long` checkpoint, three-way contradiction/entailment/
neutral classification, `predict_hypotheses`, `rerank`, and shared-prefix
batching. The model card also documents the 4B path and an SGLang serving path.
The exact checkpoint and batching formulation must be pinned when the runtime
gate is rerun; this report does not infer conversational relevance from generic
NLI claims.

Primary references checked on 2026-09-22:

- <https://huggingface.co/AlexWortega/openjev/blob/main/README.md>
- <https://huggingface.co/AlexWortega/openjev/tree/main>

This machine has Python 3.13.5, CPU-only PyTorch, no `transformers` package,
and no CUDA device. Downloading model weights or sending private transcript
content to a hosted provider was therefore not appropriate. The OpenJEV row
is an external/runtime prerequisite, not a benchmark failure.

## Interpretation and gate

On this synthetic corpus, BM25 improves necessary-message recall over the
current window, while deterministic reply expansion recovers some ancestry
without introducing a model dependency. These results justify running a
better-labelled and model-backed experiment; they do **not** justify a
production semantic resolver, a new runtime contract, or a change to current
Discord context behavior.

Recommendation for #717: keep the experiment open for the pinned OpenJEV
0.8B/current-small-model run and blinded downstream answer-quality comparison.
Do not advance to #719/#720 based on this slice alone. #718 is the next
independent gate for local runtime feasibility.

## Reproduction

```text
pnpm eval:context-selection
pnpm exec tsx --test scripts/context-selection-benchmark.test.ts
```

The benchmark writes machine-specific raw output under
`artifacts/context-selection-717/`. Those timings are evidence for this run,
not a production SLO.
