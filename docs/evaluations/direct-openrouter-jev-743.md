<!--
@description: Direct OpenRouter Jev evaluation record for PR #743.
@footnote-scope: test
@footnote-module: DirectOpenRouterJevReport
@footnote-risk: medium - Provider evidence can influence later judgment architecture decisions.
@footnote-ethics: high - Results are advisory and use synthetic fixtures only.
-->

# Direct OpenRouter Jev evaluation (#741)

Status: **hosted benchmark completed through OpenRouter; no production integration.**

Base: `ec1fed4cd952cdbd53a07f56652cd975918e2890` (PR #743 head)

Branch: `experiment/jev-openrouter-followup`

## What was tested

The run used OpenRouter's Decisions API with the pinned model
`typesafe/jev-1.13`. It reused the frozen synthetic #717 corpus: 100 cases and
4,000 messages, with no private transcripts. Each case sent one independent
`noul` question per candidate and used a fixed exploratory threshold of `0.5`.

The same report includes the existing recent-window and BM25 plus bounded
deterministic-expansion baselines. The old generic semantic-selector evidence
is not relabeled as Jev. The comparable OpenJEV row remains unavailable.

The second workload sent one hosted claim/evidence support question from
`scripts/fixtures/claim-evidence.json`. It was observe-only and is not a ground
truth label.

## Hosted run

- Provider: `TypeSafe` through OpenRouter.
- Requested model: `typesafe/jev-1.13`.
- Served model: `typesafe/jev-1.13-20260917`.
- Recorded benchmark invocation: 100 context calls plus 1 claim/evidence call.
- A prior successful invocation was also run while debugging the harness, for
  202 context calls plus 2 claim/evidence calls total across the orchestration.
- Recorded context cost: `$0.022187046`.
- Recorded claim/evidence cost: `$0.000014826`.
- Recorded invocation cost: `$0.022201872`.
- Context usage: 528,263 input tokens and 95,080 output tokens.
- Context latency: p50 `199.3163 ms`, p95 `296.3408 ms`, average `216.974238 ms`.
- Claim/evidence latency: `257.1071 ms`, probability `0.52`.
- Errors: none in the recorded invocation.

The complete sanitized result is preserved at
`artifacts/direct-jev-judgment-741/openrouter-results.json`.

## Context-selection result

The recorded 100-case run produced:

| Method                 | Necessary recall | Useful precision | Distracting rate | Avg messages | Estimated input tokens |
| ---------------------- | ---------------: | ---------------: | ---------------: | -----------: | ---------------------: |
| Recent window          |            0.500 |            0.035 |            0.023 |        24.00 |                 442.40 |
| BM25 + graph expansion |            0.967 |            0.116 |            0.025 |        15.05 |                 275.95 |
| Jev at 0.5             |            0.960 |            0.966 |            0.028 |         1.49 |                  25.42 |
| OpenJEV                |      unavailable |      unavailable |      unavailable |  unavailable |            unavailable |

Jev compressed the selected context far more than the cheap baseline while
preserving similar necessary-context recall in this run. Its useful precision
was much higher on this synthetic corpus. This is strong evidence for a
context-relevance capability, not evidence that Jev should control policy or
runtime behavior.

The probabilities were mostly decisive but not all decisive: 3,810 of 4,000
candidate probabilities were at or below `0.05`, 35 were at or above `0.95`,
and 155 were between those values. Across the same recorded probabilities,
thresholds of `0.2`, `0.5`, and `0.8` selected an average of `1.78`, `1.49`,
and `1.02` messages per case. These are operating-point observations, not
threshold tuning: the threshold was fixed before evaluation and no split was
used.

The pinned model still returned a dated served-model ID, and the two complete
runs were not identical. Treat the numbers above as one hosted benchmark run,
not a stable production estimate.

## Claim/evidence result

The one hosted claim/evidence judgment returned probability `0.52`. That is a
borderline single observation, not evidence of general claim-support accuracy.
A larger labeled fixture is needed before this workload can support an adoption
decision.

## Interpretation

Jev is **promising for context relevance**, relative to the strong BM25 plus
deterministic graph baseline, because it achieved similar recall with much
smaller selected context and low recorded cost. This run does not establish
that Jev is broadly useful across Footnote judgment workloads: the
claim/evidence sample was one question, and OpenJEV was unavailable for direct
comparison.

No permanent `JudgmentRuntime` is justified by this benchmark alone. A future
open-weight challenger evaluation against the same frozen corpus is warranted,
but Jev probabilities must not become canonical labels or policy confidence.

No production routing, context selection, planner, authorization, policy,
provenance, TRACE, workflow, or `JudgmentRuntime` seam changed.

## API and limits

OpenRouter documents Jev through `POST https://openrouter.ai/api/alpha/decisions`
with typed questions and returned probabilities, usage, provider, and model
identity. The adapter records these values and preserves timeout, cancellation,
HTTP, invalid JSON, and invalid response-shape distinctions. The API key was
read from the environment, never printed, and never persisted.

- [OpenRouter: What Is Jev?](https://openrouter.ai/blog/insights/what-is-jev/)
- [OpenRouter: How to Use Jev](https://openrouter.ai/blog/tutorials/how-to-use-jev/)
- [OpenRouter Typesafe models](https://openrouter.ai/typesafe)

The corpus is synthetic and not production traffic. The threshold is
exploratory and is not policy confidence. OpenJEV remains a separate local
runtime question. The direct TypeSafe adapter from #743 remains useful
reference work; this run used OpenRouter rather than a TypeSafe credential.
