<!--
@description: Evidence record for the first context-selection benchmark slice.
@footnote-scope: test
@footnote-module: ContextSelectionBenchmarkReport
@footnote-risk: medium - Benchmark interpretation can influence later context architecture.
@footnote-ethics: high - The corpus is synthetic and must not become a path for private transcript retention.
-->

# Context-selection benchmark (#717)

Status: **cheap-baseline expansion complete; OpenJEV runtime gate remains
unavailable on this machine**.

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

| Method                                  | Result in this slice                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| Current 24-message window               | Completed; fail-open baseline                                     |
| Recency plus reply expansion            | Completed                                                         |
| Recency plus same-author continuation   | Completed                                                         |
| BM25-style lexical retrieval            | Completed                                                         |
| BM25 plus reply expansion               | Completed                                                         |
| BM25 plus deterministic graph expansion | Completed; 12 lexical seeds, bounded to 24 selected messages      |
| Dependency-free hash embedding proxy    | Completed; not a neural embedding                                 |
| Existing cross-encoder/reranker         | Explicitly unavailable; no configured dependency in Footnote      |
| OpenJEV                                 | Explicitly unavailable; not configured or invoked by this harness |

The hash embedding is included only as a reproducible local comparison point.
It must not be described as evidence from a neural embedding model.

## Recorded result

The generated summary recorded these aggregate values:

| Method                        | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | p95 local ms |
| ----------------------------- | ---------------: | ---------------: | ---------------: | -----------: | ---------: | -----------: |
| Current window                |            0.548 |            0.041 |            0.020 |       24.000 |    442.070 |        0.004 |
| Recency + reply expansion     |            0.639 |            0.047 |            0.020 |       24.140 |    444.730 |        0.035 |
| Recency + author continuation |            0.684 |            0.050 |            0.020 |       24.210 |    445.430 |        0.026 |
| BM25                          |            0.910 |            0.065 |            0.023 |       24.000 |    440.530 |        0.483 |
| BM25 + reply expansion        |            0.955 |            0.067 |            0.023 |       24.070 |    441.790 |        0.215 |
| BM25 + graph expansion        |            0.955 |            0.125 |            0.014 |       14.610 |    266.570 |        0.186 |
| Hash embedding proxy          |            0.819 |            0.059 |            0.015 |       24.000 |    440.100 |        0.462 |

The artifact also records candidate count, retrieval depth, estimated input
tokens, historical-distance recovery, branch expansion count, and local
harness latency. Model-backed unavailable rows are kept separate from zero
quality scores.

## Category audit

The corpus now includes direct overlap, paraphrased reference, pronoun,
reply, same-author, branch, simultaneous-conversation, topic-switch,
scattered-context, misleading-overlap, and historical non-recovery cases.
The table compares the current window, pure BM25, and the bounded lexical
graph hybrid. Values are necessary-message recall; `n/a` means the category
has no necessary message.

| Category                         | Current |  BM25 | BM25 + graph | Hybrid avg messages |
| -------------------------------- | ------: | ----: | -----------: | ------------------: |
| trigger-only                     |     n/a |   n/a |          n/a |                13.0 |
| immediate predecessor            |   1.000 | 1.000 |        1.000 |                13.0 |
| several turns back               |   1.000 | 1.000 |        1.000 |                13.0 |
| old relevant history             |   0.000 | 1.000 |        1.000 |                17.0 |
| reply ancestry                   |   0.500 | 0.500 |        1.000 |                14.0 |
| one relevant branch              |   0.500 | 1.000 |        1.000 |                15.0 |
| simultaneous conversations       |   0.500 | 1.000 |        1.000 |                16.0 |
| topic switch                     |   1.000 | 1.000 |        1.000 |                15.0 |
| pronoun reference                |   0.500 | 0.500 |        0.500 |                13.0 |
| same-author continuation         |   0.333 | 1.000 |        1.000 |                15.0 |
| paraphrased reference            |   0.000 | 1.000 |        1.000 |                15.0 |
| scattered context                |   0.667 | 1.000 |        1.000 |                17.0 |
| irrelevant high similarity       |   0.000 | 1.000 |        1.000 |                15.0 |
| historical context not recovered |   1.000 | 1.000 |        1.000 |                14.0 |

The category rows are repeated synthetic cases, not independent production
estimates. BM25 and the graph hybrid still perform well on lexicalized cases;
pronoun resolution remains weak, and the misleading-overlap case is not yet
hard enough to establish robust distractor resistance. The next corpus pass
should add more genuinely paraphrased and ambiguous cases rather than tuning
the selector to these fixtures.

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

On this synthetic corpus, cheap lexical retrieval plus deterministic
relationships is the strongest tested baseline: the bounded graph hybrid
matches BM25-plus-reply recall while selecting about 39% fewer messages and
lowering the measured distracting rate. That is a meaningful null hypothesis
for any future semantic selector. The result does **not** establish production
quality because the corpus remains synthetic, pronoun performance is weak, and
OpenJEV has not been run.

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
