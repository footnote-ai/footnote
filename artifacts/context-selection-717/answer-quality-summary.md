# Context-selection downstream support evaluation #717

This is a deterministic context-support proxy; no final answer generation was run.

| Method               | Answer correctness | Reference resolution | Confusion rate | Avg messages | Avg context units | Retrieval p95 ms |
| -------------------- | -----------------: | -------------------: | -------------: | -----------: | ----------------: | ---------------: |
| current_window       |              0.571 |                0.357 |          0.071 |       24.000 |           442.000 |            0.067 |
| bm25                 |              0.857 |                0.857 |          0.000 |       24.000 |           440.429 |            0.870 |
| bm25_graph_expansion |              0.929 |                0.929 |          0.000 |       14.643 |           267.071 |            0.445 |

Generation latency and cost are `n/a`; provider-path evidence is intentionally not invented.
