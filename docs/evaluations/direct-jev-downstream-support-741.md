<!--
@description: Downstream answer-support replay for the hosted Jev context selector.
@footnote-scope: test
@footnote-module: DirectJevDownstreamSupportReport
@footnote-risk: medium - Model-reviewed answers can influence later retrieval decisions.
@footnote-ethics: high - Results are advisory, synthetic, and must not become policy authority.
-->

# Hosted Jev downstream answer-support replay (#741)

Status: **completed as a bounded, observe-only replay; no production integration.**

## Why this replay exists

The direct Jev benchmark showed strong context compression on the frozen #717
corpus. This replay asks the narrower follow-up question: does that compressed
context still support a useful Footnote answer?

It reuses the existing #717 balanced 20-case replay and blinded answer-review
machinery. It does not relabel the older generic semantic-selector results as
Jev.

## Inputs and method

- Selector: TypeSafe Jev through OpenRouter, requested model
  `typesafe/jev-1.13`, served model `typesafe/jev-1.13-20260917`.
- Jev selector replay: 20 frozen cases, using the saved selections from the
  100-case hosted run. No new Jev calls were needed for this replay.
- Comparison: the same 20 cases with BM25 plus bounded deterministic graph
  expansion.
- Answer replay: the canonical local `POST /api/chat` path, using the local
  backend only. The production backend and runtime were not changed.
- Review: 20 blinded reviewer calls using the existing
  `context-answer-review-v1` rubric. The reviewer was used as an exploratory
  consistency check, not as canonical ground truth.
- Scoring: `message` answers were reviewed. `ignore` is descriptive only and
  was not scored. Two Jev cases could not run because no context was selected.

## Selector-level context

The full 100-case hosted result remains the primary selector evidence:

| Method | Required-context recall | Useful precision | Distractor rate | Avg messages | Avg estimated tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| BM25 + deterministic graph | 0.967 | 0.116 | 0.025 | 15.05 | 275.95 |
| Jev at 0.5 | 0.960 | 0.966 | 0.028 | 1.49 | 25.42 |

On the balanced 20-case replay, Jev selected 1.50 messages on average and
had selector latency p50 `198.696 ms` and p95 `287.826 ms`. BM25 selected
15.05 messages on average with measured selector latency averaging `0.454 ms`.
These are selector measurements, not end-to-end answer latency.

## Downstream result

The Jev replay produced 17 `message` actions, one `ignore`, and two
`not_run` cases. BM25 produced seven `message` actions and 13 `ignore` cases.
Because ignores are not answer attempts, the aggregate answer rows are not a
fair selector-to-selector accuracy comparison.

| Reviewed message answers | Jev | BM25 + graph |
| --- | ---: | ---: |
| Reviewed answers | 17 | 7 |
| Sufficient answers | 14 | 6 |
| Average required-fact coverage | 0.918 | 0.829 |
| Answers with unsupported claims | 5 | 0 |
| Answers with distractor contamination | 0 | 1 |

The reviewer cost was `$0.198074` for 20 calls. Jev-backed answer replay
latency was p50 `37.971 s` and p95 `77.670 s`, with `$0.002592` of recorded
backend-reported generation cost across the 17 message calls. Those values
include the local answer-generation path and are not Jev selector cost.

## Paired answerable cases

Only six cases produced `message` actions for both selectors. On those matched
cases:

| Outcome | Cases |
| --- | ---: |
| Both sufficient | 2 |
| BM25 sufficient, Jev insufficient | 3 |
| Jev sufficient, BM25 insufficient | 1 |
| Neither sufficient | 0 |

The cases were:

| Case category | Result | Observation |
| --- | --- | --- |
| `immediate_predecessor` | BM25 only | Jev had lower fact coverage and two unsupported claims. |
| `old_relevant_history` | Jev only | Jev recovered the required fact; BM25 included irrelevant context. |
| `reply_ancestry` | Both | Both were sufficient. |
| `same_author_continuation` | Both | Both were sufficient. |
| `historical_context_not_recovered` | BM25 only | Jev missed the required historical reference. |
| `negative_historical_match` | BM25 only | Both found the fact, but Jev produced five unsupported claims. |

## What this does and does not show

Jev clearly compressed the selected context and caused the answer path to run
on more cases than BM25 in this small replay. That is useful evidence for a
possible advisory relevance selector.

The downstream evidence is mixed. On the six directly paired message cases,
BM25 had three sufficient-only wins and Jev had one. Jev also produced
unsupported claims in five of 17 reviewed answers. The sample is small, the
answer generation path is variable, and the review is model-assisted, so this
does not establish that Jev improves final answer quality.

The result does not justify a permanent `JudgmentRuntime`, context graph, or
production Jev selector. It does justify keeping the frozen benchmark and
considering a larger labeled downstream study or an open-weight challenger
against the same corpus. Jev probabilities remain model outputs, not policy
confidence or canonical labels.

No production routing, workflow, authorization, policy, provenance, TRACE,
cost authority, or runtime behavior changed.

## Reproducibility and artifacts

The direct selector artifact is
`artifacts/direct-jev-judgment-741/openrouter-results.json`. The balanced
replay and blinded-review files are local ignored `.footnote-dev` artifacts;
they contain generated answer text and are not committed. The replay scripts
accept `hosted_jev` explicitly so the Jev result remains distinct from the
generic hosted-selector path.
