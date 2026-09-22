# Context-selection evidence expansion (#717)

Generated: 2026-09-22T21:56:01.825Z
Corpus: 100 synthetic cases
Category counts: {"trigger_only":5,"immediate_predecessor":5,"several_turns_back":5,"old_relevant_history":5,"reply_ancestry":5,"one_relevant_branch":5,"simultaneous_conversations":5,"topic_switch":5,"pronoun_reference":5,"same_author_continuation":5,"paraphrased_reference":5,"scattered_context":5,"irrelevant_high_similarity":5,"historical_context_not_recovered":5,"coreference_ambiguous":5,"semantic_paraphrase":5,"misleading_overlap_hard":5,"topic_resumption":5,"speaker_sensitive":5,"negative_historical_match":5}

## Selection budgets

| Method | Budget | Recall | Precision | Distracting | Avg msgs | Avg units | p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current_window | 3 | 0.167 | 0.083 | 0.000 | 3.000 | 55.300 | 0.003 |
| current_window | 5 | 0.233 | 0.070 | 0.000 | 5.000 | 92.050 | 0.000 |
| current_window | 8 | 0.233 | 0.050 | 0.006 | 8.000 | 147.550 | 0.000 |
| current_window | 10 | 0.333 | 0.055 | 0.015 | 10.000 | 184.150 | 0.000 |
| current_window | 15 | 0.367 | 0.043 | 0.013 | 15.000 | 276.650 | 0.001 |
| current_window | 20 | 0.400 | 0.035 | 0.025 | 20.000 | 369.050 | 0.001 |
| current_window | 24 | 0.500 | 0.035 | 0.023 | 24.000 | 442.400 | 0.001 |
| bm25 | 3 | 0.933 | 0.467 | 0.133 | 3.000 | 53.350 | 0.374 |
| bm25 | 5 | 0.933 | 0.280 | 0.080 | 5.000 | 90.350 | 0.158 |
| bm25 | 8 | 0.933 | 0.175 | 0.050 | 8.000 | 145.850 | 0.122 |
| bm25 | 10 | 0.933 | 0.145 | 0.040 | 10.000 | 182.850 | 0.087 |
| bm25 | 15 | 0.933 | 0.100 | 0.027 | 15.000 | 275.350 | 0.088 |
| bm25 | 20 | 0.933 | 0.075 | 0.027 | 20.000 | 367.850 | 0.084 |
| bm25 | 24 | 0.933 | 0.063 | 0.027 | 24.000 | 441.850 | 0.083 |
| bm25_reply_expansion | 3 | 0.933 | 0.467 | 0.133 | 3.000 | 53.350 | 0.126 |
| bm25_reply_expansion | 5 | 0.933 | 0.280 | 0.080 | 5.000 | 90.350 | 0.085 |
| bm25_reply_expansion | 8 | 0.933 | 0.175 | 0.050 | 8.000 | 145.850 | 0.079 |
| bm25_reply_expansion | 10 | 0.933 | 0.145 | 0.040 | 10.000 | 182.850 | 0.086 |
| bm25_reply_expansion | 15 | 0.933 | 0.100 | 0.027 | 15.000 | 275.350 | 0.087 |
| bm25_reply_expansion | 20 | 0.933 | 0.075 | 0.027 | 20.000 | 367.850 | 0.081 |
| bm25_reply_expansion | 24 | 0.933 | 0.063 | 0.027 | 24.000 | 441.850 | 0.084 |
| bm25_graph_expansion | 3 | 0.933 | 0.467 | 0.133 | 3.000 | 53.350 | 0.162 |
| bm25_graph_expansion | 5 | 0.933 | 0.280 | 0.080 | 5.000 | 90.350 | 0.081 |
| bm25_graph_expansion | 8 | 0.933 | 0.175 | 0.050 | 8.000 | 145.850 | 0.095 |
| bm25_graph_expansion | 10 | 0.933 | 0.145 | 0.040 | 10.000 | 182.850 | 0.088 |
| bm25_graph_expansion | 15 | 0.967 | 0.117 | 0.027 | 14.500 | 265.750 | 0.145 |
| bm25_graph_expansion | 20 | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 | 0.096 |
| bm25_graph_expansion | 24 | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 | 0.175 |

## Deterministic-edge ablations

| Configuration | Recall | Precision | Distracting | Avg msgs | Avg units | Branches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bm25 | 0.933 | 0.063 | 0.027 | 24.000 | 441.850 | 0.000 |
| bm25_plus_reply | 0.933 | 0.063 | 0.027 | 24.000 | 441.850 | 0.000 |
| bm25_plus_adjacent | 0.933 | 0.113 | 0.025 | 15.000 | 275.100 | 3.000 |
| bm25_plus_same_author | 0.933 | 0.119 | 0.032 | 12.150 | 222.550 | 0.150 |
| bm25_plus_trigger_reply | 0.933 | 0.121 | 0.033 | 12.000 | 219.850 | 0.000 |
| bm25_plus_reply_adjacent | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 | 3.050 |
| bm25_full_graph | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 | 3.050 |

## Branch-pruning comparison

| Strategy | Budget | Recall | Precision | Distracting | Avg msgs | Branches | Depth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| top_n_bm25_3 | 3 | 0.933 | 0.467 | 0.133 | 3.000 | 0.000 | n/a |
| recursive_graph_3 | 3 | 0.933 | 0.467 | 0.133 | 3.000 | 0.000 | 0.000 |
| top_n_bm25_5 | 5 | 0.933 | 0.280 | 0.080 | 5.000 | 0.000 | n/a |
| recursive_graph_5 | 5 | 0.967 | 0.347 | 0.080 | 4.900 | 1.900 | 1.000 |
| top_n_bm25_8 | 8 | 0.933 | 0.175 | 0.050 | 8.000 | 0.000 | n/a |
| recursive_graph_8 | 8 | 0.967 | 0.273 | 0.058 | 6.400 | 3.400 | 1.000 |
| top_n_bm25_10 | 10 | 0.933 | 0.145 | 0.040 | 10.000 | 0.000 | n/a |
| recursive_graph_10 | 10 | 0.967 | 0.267 | 0.056 | 6.550 | 3.550 | 1.000 |
| top_n_bm25_15 | 15 | 0.933 | 0.100 | 0.027 | 15.000 | 0.000 | n/a |
| recursive_graph_15 | 15 | 0.967 | 0.267 | 0.056 | 6.550 | 3.550 | 1.000 |

## Interpretation guardrails

- These are offline synthetic fixtures; they are not production Discord estimates.
- The budget curve measures answerability pressure as context is reduced; it does not choose a production token budget.
- Ablations report regressions as well as gains. No deterministic edge is presumed useful before measurement.
- Recursive expansion is bounded benchmark code, not a production graph implementation.
- No neural embedding, reranker, OpenJEV, or generated answer call is made.
- The deterministic support proxy remains the downstream answerability check; provider-backed generation is a separate blocked gate.
