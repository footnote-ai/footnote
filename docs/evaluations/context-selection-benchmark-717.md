<!--
@description: Evidence record for the first context-selection benchmark slice.
@footnote-scope: test
@footnote-module: ContextSelectionBenchmarkReport
@footnote-risk: medium - Benchmark interpretation can influence later context architecture.
@footnote-ethics: high - The corpus is synthetic and must not become a path for private transcript retention.
-->

# Context-selection benchmark (#717)

Status: **context-selection evidence complete; no production semantic selector
is justified by the available evidence**.

Run date: 2026-09-22

Base: `origin/main` at `6fa7416ae8ff5e8d052dac67a2ae10eb074d6d58`

Artifact: `artifacts/context-selection-717/results.json`
Summary artifact: `artifacts/context-selection-717/summary.md`

## Plain-language result

The current method sends the most recent 24 messages. BM25 is a traditional
text-search ranking method: it finds messages that share useful words with the
trigger. The graph hybrid starts with those search results, then follows simple
conversation links such as adjacency and same-author continuation. In this
synthetic benchmark, the graph hybrid found the most required information,
selected about 15 messages instead of 24, and included a larger share of useful
messages. It is the strongest cheap baseline so far, not a production decision.

**Recall** means “of the messages the answer needed, how many did the method
find?” **Useful precision** means “of the messages it selected, how many were
useful?” A confidence interval is a range showing uncertainty on this fixture
sample; it does not predict performance on real Discord traffic.

## Corpus

The committed harness builds 100 synthetic, structurally faithful Discord
turns. It does not copy production or private transcripts. Each turn contains
40 candidate messages and reference labels for messages that are:

- necessary;
- useful;
- distracting; or
- irrelevant by omission from the first three sets.

The 20 repeated categories cover trigger-only turns, immediate and distant
context, old relevant history, reply ancestry, one relevant branch among
chatter, simultaneous conversations, topic switches, pronoun resolution,
same-author continuation, scattered context, high-similarity distractors,
historical context that should not be recovered, ambiguous coreference,
semantic paraphrase, harder misleading overlap, topic resumption,
speaker-sensitive retrieval, and negative historical matches. Each category has
five cases. The new categories are synthetic approximations of observed Discord
shapes, not private transcript excerpts.

The current backend behavior is modeled as the Discord 24-message non-system
window in `packages/backend/src/services/conversationContextService.ts`. The
harness does not call production context selection or change production input.

## Compared methods

| Method                                  | Result in this slice                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Current 24-message window               | Completed; fail-open baseline                                                      |
| Recency plus reply expansion            | Completed                                                                          |
| Recency plus same-author continuation   | Completed                                                                          |
| BM25-style lexical retrieval            | Completed                                                                          |
| BM25 plus reply expansion               | Completed                                                                          |
| BM25 plus deterministic graph expansion | Completed; 12 lexical seeds, bounded to 24 selected messages                       |
| Dependency-free hash embedding proxy    | Completed; not a neural embedding                                                  |
| Existing cross-encoder/reranker         | Explicitly unavailable; no configured dependency in Footnote                       |
| OpenJEV/local model                     | Not invoked by this offline harness; AMD feasibility is tracked separately in #718 |

The hash embedding is included only as a reproducible local comparison point.
It must not be described as evidence from a neural embedding model.

## Recorded result

The generated summary recorded these aggregate values:

| Method                        | Necessary recall | Recall 95% CI  | Useful precision | Precision 95% CI | Distracting rate | Avg messages | Avg units |
| ----------------------------- | ---------------: | -------------- | ---------------: | ---------------- | ---------------: | -----------: | --------: |
| Current window                |            0.500 | [0.421, 0.579] |            0.035 | [0.029, 0.044]   |            0.023 |       24.000 |     442.4 |
| Recency + reply expansion     |            0.567 | [0.487, 0.643] |            0.039 | [0.032, 0.048]   |            0.023 |       24.100 |     444.3 |
| Recency + author continuation |            0.600 | [0.520, 0.675] |            0.041 | [0.034, 0.050]   |            0.023 |       24.150 |     444.8 |
| BM25                          |            0.933 | [0.882, 0.963] |            0.063 | [0.053, 0.073]   |            0.027 |       24.000 |     441.9 |
| BM25 + reply expansion        |            0.967 | [0.924, 0.986] |            0.064 | [0.055, 0.075]   |            0.027 |       24.050 |     442.8 |
| BM25 + graph expansion        |            0.967 | [0.924, 0.986] |            0.116 | [0.101, 0.133]   |            0.025 |       15.050 |     276.0 |
| Hash embedding proxy          |            0.800 | [0.729, 0.856] |            0.056 | [0.048, 0.066]   |            0.019 |       24.000 |     440.9 |

The intervals are Wilson 95% intervals over the aggregate required-message
and selected-message counts. They describe this synthetic fixture sample;
they are not confidence intervals for production Discord traffic.

The artifact also records candidate count, retrieval depth, estimated input
tokens, historical-distance recovery, branch expansion count, and local
harness latency. Model-backed unavailable rows are kept separate from zero
quality scores.

## Category audit

The refreshed corpus contains five cases in each of 20 categories. The full
case-level and category-level matrix is in `results.json`; selected recall
highlights are:

| Category                  | Current |  BM25 | BM25 + graph |
| ------------------------- | ------: | ----: | -----------: |
| old relevant history      |   0.000 | 1.000 |        1.000 |
| reply ancestry            |   0.500 | 0.500 |        1.000 |
| pronoun reference         |   0.500 | 0.500 |        0.500 |
| coreference ambiguous     |   0.500 | 1.000 |        1.000 |
| semantic paraphrase       |   0.000 | 1.000 |        1.000 |
| misleading overlap hard   |   0.000 | 1.000 |        1.000 |
| topic resumption          |   0.500 | 1.000 |        1.000 |
| speaker sensitive         |   0.000 | 1.000 |        1.000 |
| negative historical match |   1.000 | 1.000 |        1.000 |

The new cases expose weak lexical/context behavior in coreference, speaker
selection, and the current-window baseline. BM25 still performs strongly on
these synthetic cases. That does not prove semantic judgment is unnecessary;
it shows the level a semantic method would need to beat. The fixtures remain
synthetic approximations, not independent production estimates.

## Budget, ablation, and branch-pruning evidence

`artifacts/context-selection-717/evidence.json` and
`evidence-summary.md` record budgets 3/5/8/10/15/20/24, deterministic-edge
ablations, and a bounded three-seed recursive expansion comparison. On this
run, BM25 retained 0.933 necessary recall even at budget 3; the full graph
reached 0.967 recall at budgets 15–24 while selecting about 15 messages.
The recursive three-seed graph reached 0.967 recall at budget 5 versus 0.933
for top-five BM25, but selected fewer messages and remains a synthetic
benchmark result. The ablation shows adjacent and same-author edges improved
precision/message reduction more clearly than reply-only expansion in this
corpus; no edge is being promoted to a production contract.

The paired comparison uses the same cases for BM25 and the graph hybrid. For
required-message recall, graph expansion was better on 5 of 95 comparable cases,
tied on 90, and lost on none; the average improvement was `+0.026` with a
paired-bootstrap 95% interval of `[+0.005, +0.053]`. For useful-message
precision, graph expansion was better on 95 of 100 cases, tied on 5, and lost
on none; the average improvement was `+0.053`, with interval `[+0.046,
+0.060]`. These are fixture-level comparisons, not production estimates.

## Downstream support proxy

A bounded 20-case support proxy compared the current window, BM25, and the
bounded graph hybrid using hand-authored synthetic answer facts. The graph
hybrid reached `0.950` answer-fact support and `0.950` necessary-reference
resolution versus BM25 at `0.900` / `0.900`, while selecting `15.050`
messages and `275.950` estimated context units versus BM25's `24` and
`441.850`. The 10-message graph budget matched BM25's `0.900` support scores
at `182.850` estimated context units. These are local context-size proxies,
not tokenizer measurements. This is not generated-answer evidence:
generation latency, cost, and provider usage remain unavailable and are
explicitly null in `artifacts/context-selection-717/answer-quality.json`.

## Model-backed follow-up

The current upstream `AlexWortega/openjev` repository documents the
`qwen3.5-0.8b-nli-v2s-long` checkpoint, three-way contradiction/entailment/
neutral classification, `predict_hypotheses`, `rerank`, and shared-prefix
batching. The model card also documents the 4B path and an SGLang serving path.
The exact checkpoint and batching formulation must be pinned for any future
comparison; this report does not infer conversational relevance from generic
NLI claims.

Primary references checked on 2026-09-22:

- <https://huggingface.co/AlexWortega/openjev/blob/main/README.md>
- <https://huggingface.co/AlexWortega/openjev/tree/main>

The offline harness did not invoke OpenJEV. #718 later showed that the model
can run on the target RX 7800 XT under WSL2 with ROCm, but did not produce a
simple TypeScript-native path or a production server. #722's bounded hosted
comparison did not show better answer quality than BM25 plus deterministic
expansion. No Python sidecar, SGLang service, or production context selector
was added.

## Interpretation and gate

On this synthetic corpus, cheap lexical retrieval plus deterministic
relationships is the strongest tested baseline: the bounded graph hybrid
matches BM25-plus-reply recall while selecting about 39% fewer messages and
lowering the measured distracting rate. #722 did not show a downstream answer
quality improvement over that baseline, and #718 found no simple TypeScript-
native OpenJEV path. The result does not establish production quality because
the corpus remains synthetic and pronoun performance is weak. It does support
keeping the simpler baseline and not adding a production semantic selector,
context graph, or `JudgmentRuntime` from this evidence.

## Concrete reconsideration triggers

This gate is recorded before OpenJEV execution to reduce hindsight bias. A
semantic selector would need to demonstrate a material advantage over the
best cheap hybrid, not merely a small aggregate recall increase. Evidence that
would justify reopening the architecture question includes one or more of:

- materially higher necessary-message recall at equal or smaller context size;
- materially higher useful precision on coreference, paraphrase, and
  simultaneous-conversation categories;
- consistent recovery of lexically weak references that BM25 misses;
- better branch pruning without increasing distracting selections;
- substantially fewer context units for equivalent downstream support; or
- useful attachment/context relevance decisions that deterministic retrieval
  cannot provide.

The eventual comparison must report uncertainty and category-level results.
No threshold is sufficient by aggregate recall alone, and no production
default should change from this benchmark.

## Reproduction

```text
pnpm eval:context-selection
pnpm exec tsx --test scripts/context-selection-benchmark.test.ts
```

The benchmark writes machine-specific raw output under
`artifacts/context-selection-717/`. Those timings are evidence for this run,
not a production SLO.
