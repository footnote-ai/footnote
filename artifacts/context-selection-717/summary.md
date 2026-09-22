# Context-selection benchmark #717

Generated: 2026-09-22T20:50:08.646Z
Corpus: 100 synthetic cases / 4000 messages

| Method                      | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | Avg candidates | Avg depth | Avg branches | p95 ms | Unavailable |
| --------------------------- | ---------------: | ---------------: | ---------------: | -----------: | ---------: | -------------: | --------: | -----------: | -----: | ----------: |
| current_window              |            0.548 |            0.041 |            0.020 |       24.000 |    442.070 |         40.000 |    24.000 |        0.000 |  0.005 |           0 |
| recency_reply_expansion     |            0.639 |            0.047 |            0.020 |       24.140 |    444.730 |         40.000 |    24.000 |        0.140 |  0.020 |           0 |
| recency_author_continuation |            0.684 |            0.050 |            0.020 |       24.210 |    445.430 |         40.000 |    24.000 |        0.210 |  0.027 |           0 |
| bm25                        |            0.910 |            0.065 |            0.023 |       24.000 |    440.530 |         40.000 |    40.000 |        0.000 |  0.358 |           0 |
| bm25_reply_expansion        |            0.955 |            0.067 |            0.023 |       24.070 |    441.790 |         40.000 |    40.000 |        0.070 |  0.176 |           0 |
| bm25_graph_expansion        |            0.955 |            0.125 |            0.014 |       14.610 |    266.570 |         40.000 |    40.000 |        2.610 |  0.118 |           0 |
| hash_embedding_proxy        |            0.819 |            0.059 |            0.015 |       24.000 |    440.100 |         40.000 |    40.000 |        0.000 |  0.415 |           0 |
| existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |            n/a |       n/a |          n/a |    n/a |         100 |
| openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |            n/a |       n/a |          n/a |    n/a |         100 |

## By category

| Category                         | Method                      | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | p95 ms |
| -------------------------------- | --------------------------- | ---------------: | ---------------: | ---------------: | -----------: | ---------: | -----: |
| trigger_only                     | current_window              |              n/a |            0.000 |            0.000 |       24.000 |    444.000 |  0.039 |
| immediate_predecessor            | current_window              |            1.000 |            0.042 |            0.000 |       24.000 |    447.000 |  0.007 |
| several_turns_back               | current_window              |            1.000 |            0.125 |            0.000 |       24.000 |    439.000 |  0.004 |
| old_relevant_history             | current_window              |            0.000 |            0.000 |            0.000 |       24.000 |    444.000 |  0.003 |
| reply_ancestry                   | current_window              |            0.500 |            0.042 |            0.000 |       24.000 |    437.000 |  0.005 |
| one_relevant_branch              | current_window              |            0.500 |            0.042 |            0.125 |       24.000 |    440.000 |  0.003 |
| simultaneous_conversations       | current_window              |            0.500 |            0.083 |            0.000 |       24.000 |    443.000 |  0.022 |
| topic_switch                     | current_window              |            1.000 |            0.042 |            0.083 |       24.000 |    445.000 |  0.003 |
| pronoun_reference                | current_window              |            0.500 |            0.042 |            0.000 |       24.000 |    441.000 |  0.009 |
| same_author_continuation         | current_window              |            0.333 |            0.042 |            0.000 |       24.000 |    443.000 |  0.005 |
| paraphrased_reference            | current_window              |            0.000 |            0.000 |            0.000 |       24.000 |    444.000 |  0.003 |
| scattered_context                | current_window              |            0.667 |            0.083 |            0.000 |       24.000 |    438.000 |  0.001 |
| irrelevant_high_similarity       | current_window              |            0.000 |            0.000 |            0.083 |       24.000 |    442.000 |  0.001 |
| historical_context_not_recovered | current_window              |            1.000 |            0.042 |            0.000 |       24.000 |    441.000 |  0.001 |
| trigger_only                     | recency_reply_expansion     |              n/a |            0.000 |            0.000 |       24.000 |    444.000 |  0.165 |
| immediate_predecessor            | recency_reply_expansion     |            1.000 |            0.042 |            0.000 |       24.000 |    447.000 |  0.017 |
| several_turns_back               | recency_reply_expansion     |            1.000 |            0.125 |            0.000 |       24.000 |    439.000 |  0.013 |
| old_relevant_history             | recency_reply_expansion     |            0.000 |            0.000 |            0.000 |       24.000 |    444.000 |  0.013 |
| reply_ancestry                   | recency_reply_expansion     |            1.000 |            0.080 |            0.000 |       25.000 |    455.000 |  0.029 |
| one_relevant_branch              | recency_reply_expansion     |            1.000 |            0.080 |            0.120 |       25.000 |    460.000 |  0.055 |
| simultaneous_conversations       | recency_reply_expansion     |            0.500 |            0.083 |            0.000 |       24.000 |    443.000 |  0.015 |
| topic_switch                     | recency_reply_expansion     |            1.000 |            0.042 |            0.083 |       24.000 |    445.000 |  0.016 |
| pronoun_reference                | recency_reply_expansion     |            0.500 |            0.042 |            0.000 |       24.000 |    441.000 |  0.022 |
| same_author_continuation         | recency_reply_expansion     |            0.333 |            0.042 |            0.000 |       24.000 |    443.000 |  0.014 |
| paraphrased_reference            | recency_reply_expansion     |            0.000 |            0.000 |            0.000 |       24.000 |    444.000 |  0.013 |
| scattered_context                | recency_reply_expansion     |            0.667 |            0.083 |            0.000 |       24.000 |    438.000 |  0.013 |
| irrelevant_high_similarity       | recency_reply_expansion     |            0.000 |            0.000 |            0.083 |       24.000 |    442.000 |  0.018 |
| historical_context_not_recovered | recency_reply_expansion     |            1.000 |            0.042 |            0.000 |       24.000 |    441.000 |  0.020 |
| trigger_only                     | recency_author_continuation |              n/a |            0.000 |            0.000 |       24.000 |    444.000 |  0.199 |
| immediate_predecessor            | recency_author_continuation |            1.000 |            0.042 |            0.000 |       24.000 |    447.000 |  0.018 |
| several_turns_back               | recency_author_continuation |            1.000 |            0.125 |            0.000 |       24.000 |    439.000 |  0.012 |
| old_relevant_history             | recency_author_continuation |            0.000 |            0.000 |            0.000 |       24.000 |    444.000 |  0.013 |
| reply_ancestry                   | recency_author_continuation |            0.500 |            0.042 |            0.000 |       24.000 |    437.000 |  0.020 |
| one_relevant_branch              | recency_author_continuation |            1.000 |            0.080 |            0.120 |       25.000 |    460.000 |  0.038 |
| simultaneous_conversations       | recency_author_continuation |            0.500 |            0.083 |            0.000 |       24.000 |    443.000 |  0.013 |
| topic_switch                     | recency_author_continuation |            1.000 |            0.042 |            0.083 |       24.000 |    445.000 |  0.012 |
| pronoun_reference                | recency_author_continuation |            0.500 |            0.042 |            0.000 |       24.000 |    441.000 |  0.014 |
| same_author_continuation         | recency_author_continuation |            1.000 |            0.115 |            0.000 |       26.000 |    471.000 |  0.051 |
| paraphrased_reference            | recency_author_continuation |            0.000 |            0.000 |            0.000 |       24.000 |    444.000 |  0.014 |
| scattered_context                | recency_author_continuation |            0.667 |            0.083 |            0.000 |       24.000 |    438.000 |  0.013 |
| irrelevant_high_similarity       | recency_author_continuation |            0.000 |            0.000 |            0.083 |       24.000 |    442.000 |  0.012 |
| historical_context_not_recovered | recency_author_continuation |            1.000 |            0.042 |            0.000 |       24.000 |    441.000 |  0.012 |
| trigger_only                     | bm25                        |              n/a |            0.000 |            0.000 |       24.000 |    444.000 |  0.853 |
| immediate_predecessor            | bm25                        |            1.000 |            0.042 |            0.000 |       24.000 |    447.000 |  0.343 |
| several_turns_back               | bm25                        |            1.000 |            0.125 |            0.000 |       24.000 |    439.000 |  0.284 |
| old_relevant_history             | bm25                        |            1.000 |            0.042 |            0.000 |       24.000 |    442.000 |  0.416 |
| reply_ancestry                   | bm25                        |            0.500 |            0.042 |            0.000 |       24.000 |    437.000 |  0.314 |
| one_relevant_branch              | bm25                        |            1.000 |            0.083 |            0.125 |       24.000 |    441.000 |  0.320 |
| simultaneous_conversations       | bm25                        |            1.000 |            0.125 |            0.000 |       24.000 |    441.000 |  0.396 |
| topic_switch                     | bm25                        |            1.000 |            0.042 |            0.083 |       24.000 |    445.000 |  0.318 |
| pronoun_reference                | bm25                        |            0.500 |            0.042 |            0.000 |       24.000 |    441.000 |  0.358 |
| same_author_continuation         | bm25                        |            1.000 |            0.125 |            0.000 |       24.000 |    434.000 |  0.314 |
| paraphrased_reference            | bm25                        |            1.000 |            0.042 |            0.000 |       24.000 |    443.000 |  0.324 |
| scattered_context                | bm25                        |            1.000 |            0.125 |            0.000 |       24.000 |    431.000 |  0.308 |
| irrelevant_high_similarity       | bm25                        |            1.000 |            0.042 |            0.083 |       24.000 |    442.000 |  0.478 |
| historical_context_not_recovered | bm25                        |            1.000 |            0.042 |            0.042 |       24.000 |    439.000 |  0.291 |
| trigger_only                     | bm25_reply_expansion        |              n/a |            0.000 |            0.000 |       24.000 |    444.000 |  0.280 |
| immediate_predecessor            | bm25_reply_expansion        |            1.000 |            0.042 |            0.000 |       24.000 |    447.000 |  0.176 |
| several_turns_back               | bm25_reply_expansion        |            1.000 |            0.125 |            0.000 |       24.000 |    439.000 |  0.198 |
| old_relevant_history             | bm25_reply_expansion        |            1.000 |            0.042 |            0.000 |       24.000 |    442.000 |  0.166 |
| reply_ancestry                   | bm25_reply_expansion        |            1.000 |            0.080 |            0.000 |       25.000 |    455.000 |  0.156 |
| one_relevant_branch              | bm25_reply_expansion        |            1.000 |            0.083 |            0.125 |       24.000 |    441.000 |  0.148 |
| simultaneous_conversations       | bm25_reply_expansion        |            1.000 |            0.125 |            0.000 |       24.000 |    441.000 |  0.161 |
| topic_switch                     | bm25_reply_expansion        |            1.000 |            0.042 |            0.083 |       24.000 |    445.000 |  0.192 |
| pronoun_reference                | bm25_reply_expansion        |            0.500 |            0.042 |            0.000 |       24.000 |    441.000 |  0.139 |
| same_author_continuation         | bm25_reply_expansion        |            1.000 |            0.125 |            0.000 |       24.000 |    434.000 |  0.138 |
| paraphrased_reference            | bm25_reply_expansion        |            1.000 |            0.042 |            0.000 |       24.000 |    443.000 |  0.149 |
| scattered_context                | bm25_reply_expansion        |            1.000 |            0.125 |            0.000 |       24.000 |    431.000 |  0.259 |
| irrelevant_high_similarity       | bm25_reply_expansion        |            1.000 |            0.042 |            0.083 |       24.000 |    442.000 |  0.133 |
| historical_context_not_recovered | bm25_reply_expansion        |            1.000 |            0.042 |            0.042 |       24.000 |    439.000 |  0.195 |
| trigger_only                     | bm25_graph_expansion        |              n/a |            0.000 |            0.000 |       13.000 |    241.000 |  0.324 |
| immediate_predecessor            | bm25_graph_expansion        |            1.000 |            0.077 |            0.000 |       13.000 |    243.000 |  0.099 |
| several_turns_back               | bm25_graph_expansion        |            1.000 |            0.231 |            0.000 |       13.000 |    235.000 |  0.085 |
| old_relevant_history             | bm25_graph_expansion        |            1.000 |            0.118 |            0.000 |       17.000 |    312.000 |  0.086 |
| reply_ancestry                   | bm25_graph_expansion        |            1.000 |            0.143 |            0.000 |       14.000 |    251.000 |  0.089 |
| one_relevant_branch              | bm25_graph_expansion        |            1.000 |            0.133 |            0.000 |       15.000 |    275.000 |  0.117 |
| simultaneous_conversations       | bm25_graph_expansion        |            1.000 |            0.250 |            0.000 |       16.000 |    293.000 |  0.087 |
| topic_switch                     | bm25_graph_expansion        |            1.000 |            0.067 |            0.000 |       15.000 |    278.000 |  0.177 |
| pronoun_reference                | bm25_graph_expansion        |            0.500 |            0.077 |            0.000 |       13.000 |    237.000 |  0.188 |
| same_author_continuation         | bm25_graph_expansion        |            1.000 |            0.200 |            0.000 |       15.000 |    268.000 |  0.194 |
| paraphrased_reference            | bm25_graph_expansion        |            1.000 |            0.133 |            0.000 |       15.000 |    276.000 |  0.209 |
| scattered_context                | bm25_graph_expansion        |            1.000 |            0.176 |            0.000 |       17.000 |    301.000 |  0.094 |
| irrelevant_high_similarity       | bm25_graph_expansion        |            1.000 |            0.067 |            0.133 |       15.000 |    275.000 |  0.086 |
| historical_context_not_recovered | bm25_graph_expansion        |            1.000 |            0.071 |            0.071 |       14.000 |    254.000 |  0.089 |
| trigger_only                     | hash_embedding_proxy        |              n/a |            0.000 |            0.000 |       24.000 |    444.000 |  0.738 |
| immediate_predecessor            | hash_embedding_proxy        |            1.000 |            0.042 |            0.000 |       24.000 |    446.000 |  0.638 |
| several_turns_back               | hash_embedding_proxy        |            0.500 |            0.083 |            0.000 |       24.000 |    442.000 |  0.461 |
| old_relevant_history             | hash_embedding_proxy        |            1.000 |            0.083 |            0.000 |       24.000 |    441.000 |  0.415 |
| reply_ancestry                   | hash_embedding_proxy        |            0.500 |            0.042 |            0.000 |       24.000 |    436.000 |  0.516 |
| one_relevant_branch              | hash_embedding_proxy        |            1.000 |            0.083 |            0.083 |       24.000 |    440.000 |  0.412 |
| simultaneous_conversations       | hash_embedding_proxy        |            1.000 |            0.083 |            0.000 |       24.000 |    440.000 |  0.411 |
| topic_switch                     | hash_embedding_proxy        |            1.000 |            0.042 |            0.000 |       24.000 |    443.000 |  0.411 |
| pronoun_reference                | hash_embedding_proxy        |            0.500 |            0.042 |            0.000 |       24.000 |    440.000 |  0.408 |
| same_author_continuation         | hash_embedding_proxy        |            0.667 |            0.083 |            0.000 |       24.000 |    436.000 |  0.409 |
| paraphrased_reference            | hash_embedding_proxy        |            1.000 |            0.042 |            0.000 |       24.000 |    443.000 |  0.435 |
| scattered_context                | hash_embedding_proxy        |            1.000 |            0.125 |            0.000 |       24.000 |    430.000 |  0.411 |
| irrelevant_high_similarity       | hash_embedding_proxy        |            1.000 |            0.042 |            0.083 |       24.000 |    441.000 |  0.401 |
| historical_context_not_recovered | hash_embedding_proxy        |            1.000 |            0.042 |            0.042 |       24.000 |    438.000 |  0.402 |
| trigger_only                     | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| immediate_predecessor            | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| several_turns_back               | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| old_relevant_history             | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| reply_ancestry                   | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| one_relevant_branch              | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| simultaneous_conversations       | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| topic_switch                     | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| pronoun_reference                | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| same_author_continuation         | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| paraphrased_reference            | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| scattered_context                | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| irrelevant_high_similarity       | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| historical_context_not_recovered | existing_cross_encoder      |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| trigger_only                     | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| immediate_predecessor            | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| several_turns_back               | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| old_relevant_history             | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| reply_ancestry                   | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| one_relevant_branch              | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| simultaneous_conversations       | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| topic_switch                     | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| pronoun_reference                | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| same_author_continuation         | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| paraphrased_reference            | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| scattered_context                | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| irrelevant_high_similarity       | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |
| historical_context_not_recovered | openjev                     |              n/a |              n/a |              n/a |          n/a |        n/a |    n/a |

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
