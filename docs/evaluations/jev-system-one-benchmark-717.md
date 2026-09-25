# Jev/System One benchmark for context judgment

Date: 2026-09-25

This report records a benchmark-only, observe-only evaluation of direct Jev/System One judgments. It reuses the frozen synthetic corpus and deterministic baselines from [#717](https://github.com/footnote-ai/footnote/issues/717) and the stacked benchmark work in [PR #739](https://github.com/footnote-ai/footnote/pull/739). It does not change production context selection, routing, policy, TRACE, provenance, or workflow behavior.

## What ran

The run used OpenRouter's Decisions API with the pinned request model `typesafe/jev-1.13`. The provider returned `typesafe/jev-1.13-20260917` for all 106 requests: 100 context cases and six claim/evidence cases. No private transcript content was sent. The state contained only committed synthetic fixtures.

For each context case, BM25 plus bounded deterministic graph expansion supplied up to 15 candidates. One Jev request asked one Noul question per candidate and one shared Score question about the sufficiency of the candidate set. The candidate questions returned probabilities. The benchmark replayed fixed thresholds of 0.5, 0.7, and 0.8 without tuning them against labels.

The second workload was claim support. Six synthetic fixtures tested whether evidence supported, contradicted, or failed to establish a claim. This workload was observe-only and did not control any application behavior.

## Results

| Method                                  | Required recall | Useful precision | Distracting rate | Avg messages | Avg context units |            p95 latency |
| --------------------------------------- | --------------: | ---------------: | ---------------: | -----------: | ----------------: | ---------------------: |
| Current window                          |           0.500 |            0.035 |            0.023 |        24.00 |             442.4 | 0.005 ms local harness |
| BM25 + bounded graph                    |           0.967 |            0.117 |            0.027 |        14.50 |             265.8 | 0.508 ms local harness |
| Frozen generic hosted selector, not Jev |           0.991 |            0.886 |              n/a |         1.75 |              30.4 |               7,070 ms |
| Jev at 0.5                              |           0.773 |            1.000 |            0.000 |         1.16 |              20.3 |                 287 ms |
| Jev at 0.7                              |           0.600 |            1.000 |            0.000 |         0.90 |              16.0 |                 287 ms |
| Jev at 0.8                              |           0.547 |            1.000 |            0.000 |         0.82 |              14.7 |                 287 ms |

Jev compressed the candidate set and removed all labeled distractors in this corpus. It also lost required-message recall against the cheap graph baseline at every tested threshold. At 0.5, Jev selected no message in 12 of 100 cases. Raising the threshold reduced context size but reduced recall further.

The 100 context calls used 238,191 input tokens and 29,650 output tokens. OpenRouter reported $0.010004. The six claim/evidence calls used 2,414 input tokens and 120 output tokens, with reported cost $0.000101. These prices are observations from this run, not a budget guarantee.

The claim/evidence workload classified all six fixtures correctly at a 0.5 support threshold. Probabilities ranged from 0.02 for contradicted claims to 0.99 for supported claims. Six fixtures are too few to support a calibration claim.

The frozen generic hosted row came from the earlier semantic-selector experiment. It is included for context compression comparison only. That selector was not Jev. Its recorded result was 0.991 recall, 0.886 useful precision, 1.75 messages, 30.4 units, 7.07 seconds average latency, and $0.062784 total cost. The five-case matched answer replay found no downstream answer-quality advantage over BM25 plus graph. See [the #739 report](https://github.com/footnote-ai/footnote/pull/739) and [issue #722](https://github.com/footnote-ai/footnote/issues/722).

## Decision

The reusable benchmark and a fail-open Jev adapter are justified. A permanent production judgment seam is not justified by this run. Jev showed useful compression, but it did not beat the strongest cheap baseline on required recall, and the claim/evidence sample was deliberately small. Keep BM25 plus bounded deterministic expansion as the comparison baseline.

This conclusion does not reject Jev for other tasks. A larger labeled claim/evidence evaluation, a balanced generated-answer replay, or a different question formulation could change the result. Such work should remain an evaluation slice until it shows a repeatable advantage after cost, latency, and error handling are included.

## API facts verified before the run

- TypeSafe's [official JavaScript/TypeScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js) exposes typed `choice`, `score`, and `noul` builders, inferred answers, per-call timeout, retry settings, and `AbortSignal` cancellation.
- TypeSafe's [OpenAPI document](https://api.typesafe.ai/openapi.json) defines `POST /v1/systemone`, `GET /v1/models`, the three question types, model identity, and input/output usage. Noul returns a yes probability; Choice and Score also return confidence and probability maps.
- OpenRouter's [Jev integration guide](https://openrouter.ai/blog/tutorials/how-to-use-jev/) documents the Decisions endpoint, `typesafe/jev-1.13`, shared state with multiple typed questions, and the distinction between Noul probability and Choice/Score confidence.
- OpenRouter's [model page](https://openrouter.ai/typesafe/jev-1.13/api) listed $0.042 per million input tokens and free output during this investigation. Provider pricing and model availability can change.

## Remaining unknowns

- The corpus is synthetic and its labels are not human-reviewed production judgments.
- The run did not measure generated answer quality after Jev pruning.
- It did not test direct TypeSafe routing, OpenJEV, or a compatible local derivative.
- It did not establish a maximum question count, production concurrency, retry behavior under rate limits, or cancellation behavior against a live interrupted request.
- The returned model snapshot and provider behavior can change even when a gateway request model is pinned. Future runs must record the served model and replay thresholds without retuning.
