# Direct Jev judgment benchmark (#741)

Generated: 2026-09-25T20:05:45.475Z
Implementation: typesafe/jev-1.13-20260917 via TypeSafe
Hosted run: completed

## Context selection

| Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg input tokens | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current_window | 0.500 | 0.035 | 0.023 | 24.000 | 442.400 | 0.005 |
| bm25_graph_expansion | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 | 0.106 |
| Jev Noul relevance | 0.747 | 0.903 | 0.000 | 1.240 | n/a | 190.403 |
- Jev context scores within 0.1 of the fixed 0.5 threshold: 0.010
- Context categories with zero necessary recall in this pass: old_relevant_history, topic_switch

## Claim support

- Cases: 8 completed, 0 failed
- Accuracy at fixed 0.5 threshold: 0.875
- Mean Noul score: 0.521
- Mean request latency: 187.182 ms
- Reported input tokens: 371322
- Reported cost: $0.015596

## Limits

- The context corpus is synthetic and provider-neutral; it is not a production Discord estimate.
- The Jev relevance row uses a fixed exploratory 0.5 threshold, not a threshold tuned on the evaluation cases.
- This report is one pass per case; repeated hosted calls can vary even with the pinned returned model snapshot.
- Noul scores are model probabilities, not Footnote policy confidence or authorization.
- Results are observe-only. No runtime routing, context defaults, provenance, TRACE, or workflow behavior changed.
- OpenRouter is the provider path when `OPENROUTER_API_KEY` is used; its routing and returned provider are part of this evidence.

## Reproduction

```text
pnpm exec tsx scripts/direct-jev-judgment.ts
```

Official docs: [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [TypeSafe API reference](https://docs.typesafe.ai/api), [models](https://docs.typesafe.ai/models), and [model jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
