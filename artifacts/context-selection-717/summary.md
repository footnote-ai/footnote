# Context-selection benchmark #717

Generated: 2026-09-22T20:00:13.943Z
Corpus: 100 synthetic cases / 4000 messages

| Method | Necessary recall | Useful precision | Distracting rate | Avg messages | p95 ms | Unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current_window | 0.647 | 0.048 | 0.022 | 24.000 | 0.005 | 0 |
| recency_reply_expansion | 0.752 | 0.054 | 0.022 | 24.160 | 0.026 | 0 |
| bm25 | 0.895 | 0.064 | 0.025 | 24.000 | 0.374 | 0 |
| hash_embedding_proxy | 0.797 | 0.058 | 0.015 | 24.000 | 0.479 | 0 |
| existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | 100 |
| openjev | n/a | n/a | n/a | n/a | n/a | 100 |

## Interpretation

- The current window is the fail-open baseline and remains the production behavior; this benchmark does not change it.
- Reply expansion is deterministic and should be considered separately from semantic judgment because it has no model availability or privacy dependency.
- BM25 and the hash-embedding proxy are offline comparison baselines, not evidence that a neural model is unnecessary.
- Cross-encoder and OpenJEV rows are explicit unavailable gates, not zero-quality scores.

## Reproduction

```text
pnpm eval:context-selection
```

The JSON artifact contains case-level metrics and the exact limitations recorded by the harness.
