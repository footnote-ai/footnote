# Context-selection downstream support evaluation #717

This is a deterministic context-support proxy; no final answer generation was run.

| Method | Answer correctness | Reference resolution | Confusion rate | Avg messages | Avg context units | Retrieval p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current_window | 0.500 | 0.300 | 0.200 | 24.000 | 442.400 | 0.040 |
| bm25 | 0.900 | 0.900 | 0.000 | 24.000 | 441.850 | 0.688 |
| bm25_graph_expansion | 0.950 | 0.950 | 0.000 | 15.050 | 275.950 | 0.339 |
| bm25_graph_budget_10 | 0.900 | 0.900 | 0.000 | 10.000 | 182.850 | 0.336 |

Generation latency and cost are `n/a`; provider-path evidence is intentionally not invented.
