# Jev/System One context benchmark

Status: completed
Corpus: 100 synthetic cases from #717; candidate budget 15
Provider: openrouter
Requested model: typesafe/jev-1.13
Returned models: typesafe/jev-1.13-20260917
Context calls: 100; input tokens 238191; output tokens 29650; reported cost $0.010004
Claim/evidence calls: 6; input tokens 2414; output tokens 120; reported cost $0.000101

| Method                         | Required recall | Useful precision | Distracting rate | Avg messages | Avg context units |  p50 ms |  p95 ms |
| ------------------------------ | --------------: | ---------------: | ---------------: | -----------: | ----------------: | ------: | ------: |
| current window                 |           0.500 |            0.035 |            0.023 |       24.000 |           442.400 |   0.001 |   0.005 |
| BM25 + bounded graph           |           0.967 |            0.117 |            0.027 |       14.500 |           265.750 |   0.211 |   0.508 |
| frozen generic hosted selector |           0.991 |            0.886 |              n/a |         1.75 |              30.4 |     n/a |    7070 |
| Jev at 0.5                     |           0.773 |            1.000 |            0.000 |        1.160 |            20.320 | 189.563 | 287.385 |
| Jev at 0.7                     |           0.600 |            1.000 |            0.000 |        0.900 |            16.000 | 189.563 | 287.385 |
| Jev at 0.8                     |           0.547 |            1.000 |            0.000 |        0.820 |            14.720 | 189.563 | 287.385 |

## Claim/evidence workload

Fixtures: 6; completed accuracy: 1.000; average support probability: 0.343.

## Interpretation

- This benchmark tests direct Jev/System One typed judgments. It does not call OpenJEV. The earlier generic hosted semantic selector is not Jev and appears only as a frozen comparison row.
- The primary Jev formulation asks one Noul relevance question per candidate plus one shared Score sufficiency question in a single request.
- The strongest cheap baseline remains BM25 plus bounded deterministic graph expansion. A permanent judgment seam is justified only if the recorded Jev run shows a repeatable advantage on weak lexical references, distractor pruning, downstream answer quality, or cost-normalized latency.
- Any hosted execution missing from this report is an external access failure, not a zero score.

## Current API facts

- The official TypeScript SDK is [`@typesafe-ai/sdk`](https://github.com/typesafe-ai/typesafe-sdk-js); it supports typed `choice`, `score`, and `noul` questions, per-call timeout, retry, and `AbortSignal` cancellation.
- The direct API is `POST https://api.typesafe.ai/v1/systemone`; OpenRouter exposes Jev through `POST https://openrouter.ai/api/alpha/decisions` with model `typesafe/jev-1.13`.
- The official API returns the requested or served model and input/output usage. Choice and Score include probabilities and confidence; Noul returns only a yes probability.
- The pinned OpenRouter price used for the comparison is $0.042 per million input tokens with free output. Recheck provider pricing before any future run.

## Reproduction

```text
pnpm eval:jev-context
pnpm eval:jev-context -- --limit 20
```

The command reads `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY` without printing it. Without either key it writes a blocked report and does not make a network request.
