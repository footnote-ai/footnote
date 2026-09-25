# Context-selection benchmark #717

Generated: 2026-09-22T21:55:59.335Z
Corpus: 100 synthetic cases / 4000 messages

| Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | Avg candidates | Avg depth | Avg branches | p95 ms | Unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| current_window | 0.500 | 0.035 | 0.023 | 24.000 | 442.400 | 40.000 | 24.000 | 0.000 | 0.005 | 0 |
| recency_reply_expansion | 0.567 | 0.039 | 0.023 | 24.100 | 444.300 | 40.000 | 24.000 | 0.100 | 0.020 | 0 |
| recency_author_continuation | 0.600 | 0.041 | 0.023 | 24.150 | 444.800 | 40.000 | 24.000 | 0.150 | 0.027 | 0 |
| bm25 | 0.933 | 0.063 | 0.027 | 24.000 | 441.850 | 40.000 | 40.000 | 0.000 | 0.372 | 0 |
| bm25_reply_expansion | 0.967 | 0.064 | 0.027 | 24.050 | 442.750 | 40.000 | 40.000 | 0.050 | 0.198 | 0 |
| bm25_graph_expansion | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 | 40.000 | 40.000 | 3.050 | 0.106 | 0 |
| hash_embedding_proxy | 0.800 | 0.056 | 0.019 | 24.000 | 440.900 | 40.000 | 40.000 | 0.000 | 0.425 | 0 |
| existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 100 |
| openjev | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 100 |

## By category

| Category | Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg tokens | p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| trigger_only | current_window | n/a | 0.000 | 0.000 | 24.000 | 444.000 | 0.044 |
| immediate_predecessor | current_window | 1.000 | 0.042 | 0.000 | 24.000 | 447.000 | 0.005 |
| several_turns_back | current_window | 1.000 | 0.125 | 0.000 | 24.000 | 439.000 | 0.006 |
| old_relevant_history | current_window | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.631 |
| reply_ancestry | current_window | 0.500 | 0.042 | 0.000 | 24.000 | 437.000 | 0.012 |
| one_relevant_branch | current_window | 0.500 | 0.042 | 0.125 | 24.000 | 440.000 | 0.003 |
| simultaneous_conversations | current_window | 0.500 | 0.083 | 0.000 | 24.000 | 443.000 | 0.003 |
| topic_switch | current_window | 1.000 | 0.042 | 0.083 | 24.000 | 445.000 | 0.003 |
| pronoun_reference | current_window | 0.500 | 0.042 | 0.000 | 24.000 | 441.000 | 0.005 |
| same_author_continuation | current_window | 0.333 | 0.042 | 0.000 | 24.000 | 443.000 | 0.005 |
| paraphrased_reference | current_window | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.003 |
| scattered_context | current_window | 0.667 | 0.083 | 0.000 | 24.000 | 438.000 | 0.003 |
| irrelevant_high_similarity | current_window | 0.000 | 0.000 | 0.083 | 24.000 | 442.000 | 0.001 |
| historical_context_not_recovered | current_window | 1.000 | 0.042 | 0.000 | 24.000 | 441.000 | 0.001 |
| coreference_ambiguous | current_window | 0.500 | 0.042 | 0.000 | 24.000 | 443.000 | 0.001 |
| semantic_paraphrase | current_window | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.001 |
| misleading_overlap_hard | current_window | 0.000 | 0.000 | 0.083 | 24.000 | 450.000 | 0.001 |
| topic_resumption | current_window | 0.500 | 0.042 | 0.042 | 24.000 | 441.000 | 0.001 |
| speaker_sensitive | current_window | 0.000 | 0.000 | 0.042 | 24.000 | 439.000 | 0.001 |
| negative_historical_match | current_window | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.001 |
| trigger_only | recency_reply_expansion | n/a | 0.000 | 0.000 | 24.000 | 444.000 | 0.147 |
| immediate_predecessor | recency_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 447.000 | 0.016 |
| several_turns_back | recency_reply_expansion | 1.000 | 0.125 | 0.000 | 24.000 | 439.000 | 0.014 |
| old_relevant_history | recency_reply_expansion | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.013 |
| reply_ancestry | recency_reply_expansion | 1.000 | 0.080 | 0.000 | 25.000 | 455.000 | 0.031 |
| one_relevant_branch | recency_reply_expansion | 1.000 | 0.080 | 0.120 | 25.000 | 460.000 | 0.016 |
| simultaneous_conversations | recency_reply_expansion | 0.500 | 0.083 | 0.000 | 24.000 | 443.000 | 0.013 |
| topic_switch | recency_reply_expansion | 1.000 | 0.042 | 0.083 | 24.000 | 445.000 | 0.017 |
| pronoun_reference | recency_reply_expansion | 0.500 | 0.042 | 0.000 | 24.000 | 441.000 | 0.020 |
| same_author_continuation | recency_reply_expansion | 0.333 | 0.042 | 0.000 | 24.000 | 443.000 | 0.013 |
| paraphrased_reference | recency_reply_expansion | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.011 |
| scattered_context | recency_reply_expansion | 0.667 | 0.083 | 0.000 | 24.000 | 438.000 | 0.012 |
| irrelevant_high_similarity | recency_reply_expansion | 0.000 | 0.000 | 0.083 | 24.000 | 442.000 | 0.013 |
| historical_context_not_recovered | recency_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 441.000 | 0.020 |
| coreference_ambiguous | recency_reply_expansion | 0.500 | 0.042 | 0.000 | 24.000 | 443.000 | 0.016 |
| semantic_paraphrase | recency_reply_expansion | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.652 |
| misleading_overlap_hard | recency_reply_expansion | 0.000 | 0.000 | 0.083 | 24.000 | 450.000 | 0.013 |
| topic_resumption | recency_reply_expansion | 0.500 | 0.042 | 0.042 | 24.000 | 441.000 | 0.014 |
| speaker_sensitive | recency_reply_expansion | 0.000 | 0.000 | 0.042 | 24.000 | 439.000 | 0.024 |
| negative_historical_match | recency_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.011 |
| trigger_only | recency_author_continuation | n/a | 0.000 | 0.000 | 24.000 | 444.000 | 0.190 |
| immediate_predecessor | recency_author_continuation | 1.000 | 0.042 | 0.000 | 24.000 | 447.000 | 0.016 |
| several_turns_back | recency_author_continuation | 1.000 | 0.125 | 0.000 | 24.000 | 439.000 | 0.017 |
| old_relevant_history | recency_author_continuation | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.012 |
| reply_ancestry | recency_author_continuation | 0.500 | 0.042 | 0.000 | 24.000 | 437.000 | 0.013 |
| one_relevant_branch | recency_author_continuation | 1.000 | 0.080 | 0.120 | 25.000 | 460.000 | 0.027 |
| simultaneous_conversations | recency_author_continuation | 0.500 | 0.083 | 0.000 | 24.000 | 443.000 | 0.012 |
| topic_switch | recency_author_continuation | 1.000 | 0.042 | 0.083 | 24.000 | 445.000 | 0.012 |
| pronoun_reference | recency_author_continuation | 0.500 | 0.042 | 0.000 | 24.000 | 441.000 | 0.012 |
| same_author_continuation | recency_author_continuation | 1.000 | 0.115 | 0.000 | 26.000 | 471.000 | 0.033 |
| paraphrased_reference | recency_author_continuation | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.027 |
| scattered_context | recency_author_continuation | 0.667 | 0.083 | 0.000 | 24.000 | 438.000 | 0.013 |
| irrelevant_high_similarity | recency_author_continuation | 0.000 | 0.000 | 0.083 | 24.000 | 442.000 | 0.013 |
| historical_context_not_recovered | recency_author_continuation | 1.000 | 0.042 | 0.000 | 24.000 | 441.000 | 0.011 |
| coreference_ambiguous | recency_author_continuation | 0.500 | 0.042 | 0.000 | 24.000 | 443.000 | 0.020 |
| semantic_paraphrase | recency_author_continuation | 0.000 | 0.000 | 0.000 | 24.000 | 444.000 | 0.032 |
| misleading_overlap_hard | recency_author_continuation | 0.000 | 0.000 | 0.083 | 24.000 | 450.000 | 0.013 |
| topic_resumption | recency_author_continuation | 0.500 | 0.042 | 0.042 | 24.000 | 441.000 | 0.012 |
| speaker_sensitive | recency_author_continuation | 0.000 | 0.000 | 0.042 | 24.000 | 439.000 | 0.013 |
| negative_historical_match | recency_author_continuation | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.012 |
| trigger_only | bm25 | n/a | 0.000 | 0.000 | 24.000 | 444.000 | 0.913 |
| immediate_predecessor | bm25 | 1.000 | 0.042 | 0.000 | 24.000 | 447.000 | 0.390 |
| several_turns_back | bm25 | 1.000 | 0.125 | 0.000 | 24.000 | 439.000 | 0.467 |
| old_relevant_history | bm25 | 1.000 | 0.042 | 0.000 | 24.000 | 442.000 | 0.348 |
| reply_ancestry | bm25 | 0.500 | 0.042 | 0.000 | 24.000 | 437.000 | 0.528 |
| one_relevant_branch | bm25 | 1.000 | 0.083 | 0.125 | 24.000 | 441.000 | 0.300 |
| simultaneous_conversations | bm25 | 1.000 | 0.125 | 0.000 | 24.000 | 441.000 | 0.305 |
| topic_switch | bm25 | 1.000 | 0.042 | 0.083 | 24.000 | 445.000 | 0.265 |
| pronoun_reference | bm25 | 0.500 | 0.042 | 0.000 | 24.000 | 441.000 | 0.250 |
| same_author_continuation | bm25 | 1.000 | 0.125 | 0.000 | 24.000 | 434.000 | 0.291 |
| paraphrased_reference | bm25 | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.285 |
| scattered_context | bm25 | 1.000 | 0.125 | 0.000 | 24.000 | 431.000 | 0.260 |
| irrelevant_high_similarity | bm25 | 1.000 | 0.042 | 0.083 | 24.000 | 442.000 | 0.265 |
| historical_context_not_recovered | bm25 | 1.000 | 0.042 | 0.042 | 24.000 | 439.000 | 0.329 |
| coreference_ambiguous | bm25 | 1.000 | 0.083 | 0.000 | 24.000 | 447.000 | 0.294 |
| semantic_paraphrase | bm25 | 1.000 | 0.042 | 0.000 | 24.000 | 450.000 | 0.325 |
| misleading_overlap_hard | bm25 | 1.000 | 0.042 | 0.083 | 24.000 | 458.000 | 0.323 |
| topic_resumption | bm25 | 1.000 | 0.083 | 0.042 | 24.000 | 439.000 | 0.359 |
| speaker_sensitive | bm25 | 1.000 | 0.042 | 0.042 | 24.000 | 434.000 | 0.309 |
| negative_historical_match | bm25 | 1.000 | 0.042 | 0.042 | 24.000 | 443.000 | 0.301 |
| trigger_only | bm25_reply_expansion | n/a | 0.000 | 0.000 | 24.000 | 444.000 | 0.289 |
| immediate_predecessor | bm25_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 447.000 | 0.276 |
| several_turns_back | bm25_reply_expansion | 1.000 | 0.125 | 0.000 | 24.000 | 439.000 | 0.150 |
| old_relevant_history | bm25_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 442.000 | 0.150 |
| reply_ancestry | bm25_reply_expansion | 1.000 | 0.080 | 0.000 | 25.000 | 455.000 | 0.176 |
| one_relevant_branch | bm25_reply_expansion | 1.000 | 0.083 | 0.125 | 24.000 | 441.000 | 0.198 |
| simultaneous_conversations | bm25_reply_expansion | 1.000 | 0.125 | 0.000 | 24.000 | 441.000 | 0.243 |
| topic_switch | bm25_reply_expansion | 1.000 | 0.042 | 0.083 | 24.000 | 445.000 | 0.151 |
| pronoun_reference | bm25_reply_expansion | 0.500 | 0.042 | 0.000 | 24.000 | 441.000 | 0.127 |
| same_author_continuation | bm25_reply_expansion | 1.000 | 0.125 | 0.000 | 24.000 | 434.000 | 0.137 |
| paraphrased_reference | bm25_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.139 |
| scattered_context | bm25_reply_expansion | 1.000 | 0.125 | 0.000 | 24.000 | 431.000 | 0.185 |
| irrelevant_high_similarity | bm25_reply_expansion | 1.000 | 0.042 | 0.083 | 24.000 | 442.000 | 0.147 |
| historical_context_not_recovered | bm25_reply_expansion | 1.000 | 0.042 | 0.042 | 24.000 | 439.000 | 0.173 |
| coreference_ambiguous | bm25_reply_expansion | 1.000 | 0.083 | 0.000 | 24.000 | 447.000 | 0.133 |
| semantic_paraphrase | bm25_reply_expansion | 1.000 | 0.042 | 0.000 | 24.000 | 450.000 | 0.133 |
| misleading_overlap_hard | bm25_reply_expansion | 1.000 | 0.042 | 0.083 | 24.000 | 458.000 | 0.138 |
| topic_resumption | bm25_reply_expansion | 1.000 | 0.083 | 0.042 | 24.000 | 439.000 | 0.134 |
| speaker_sensitive | bm25_reply_expansion | 1.000 | 0.042 | 0.042 | 24.000 | 434.000 | 0.191 |
| negative_historical_match | bm25_reply_expansion | 1.000 | 0.042 | 0.042 | 24.000 | 443.000 | 0.133 |
| trigger_only | bm25_graph_expansion | n/a | 0.000 | 0.000 | 13.000 | 241.000 | 0.437 |
| immediate_predecessor | bm25_graph_expansion | 1.000 | 0.077 | 0.000 | 13.000 | 243.000 | 0.106 |
| several_turns_back | bm25_graph_expansion | 1.000 | 0.231 | 0.000 | 13.000 | 235.000 | 0.094 |
| old_relevant_history | bm25_graph_expansion | 1.000 | 0.118 | 0.000 | 17.000 | 312.000 | 0.104 |
| reply_ancestry | bm25_graph_expansion | 1.000 | 0.143 | 0.000 | 14.000 | 251.000 | 0.194 |
| one_relevant_branch | bm25_graph_expansion | 1.000 | 0.133 | 0.000 | 15.000 | 275.000 | 0.094 |
| simultaneous_conversations | bm25_graph_expansion | 1.000 | 0.250 | 0.000 | 16.000 | 293.000 | 0.092 |
| topic_switch | bm25_graph_expansion | 1.000 | 0.067 | 0.000 | 15.000 | 278.000 | 0.086 |
| pronoun_reference | bm25_graph_expansion | 0.500 | 0.077 | 0.000 | 13.000 | 237.000 | 0.083 |
| same_author_continuation | bm25_graph_expansion | 1.000 | 0.200 | 0.000 | 15.000 | 268.000 | 0.088 |
| paraphrased_reference | bm25_graph_expansion | 1.000 | 0.133 | 0.000 | 15.000 | 276.000 | 0.185 |
| scattered_context | bm25_graph_expansion | 1.000 | 0.176 | 0.000 | 17.000 | 301.000 | 0.098 |
| irrelevant_high_similarity | bm25_graph_expansion | 1.000 | 0.067 | 0.133 | 15.000 | 275.000 | 0.088 |
| historical_context_not_recovered | bm25_graph_expansion | 1.000 | 0.071 | 0.071 | 14.000 | 254.000 | 0.090 |
| coreference_ambiguous | bm25_graph_expansion | 1.000 | 0.133 | 0.000 | 15.000 | 280.000 | 0.087 |
| semantic_paraphrase | bm25_graph_expansion | 1.000 | 0.133 | 0.000 | 15.000 | 283.000 | 0.122 |
| misleading_overlap_hard | bm25_graph_expansion | 1.000 | 0.059 | 0.118 | 17.000 | 328.000 | 0.094 |
| topic_resumption | bm25_graph_expansion | 1.000 | 0.118 | 0.059 | 17.000 | 309.000 | 0.203 |
| speaker_sensitive | bm25_graph_expansion | 1.000 | 0.059 | 0.059 | 17.000 | 304.000 | 0.088 |
| negative_historical_match | bm25_graph_expansion | 1.000 | 0.067 | 0.067 | 15.000 | 276.000 | 0.101 |
| trigger_only | hash_embedding_proxy | n/a | 0.000 | 0.000 | 24.000 | 444.000 | 0.865 |
| immediate_predecessor | hash_embedding_proxy | 1.000 | 0.042 | 0.000 | 24.000 | 446.000 | 0.631 |
| several_turns_back | hash_embedding_proxy | 0.500 | 0.083 | 0.000 | 24.000 | 442.000 | 0.431 |
| old_relevant_history | hash_embedding_proxy | 1.000 | 0.083 | 0.000 | 24.000 | 441.000 | 0.407 |
| reply_ancestry | hash_embedding_proxy | 0.500 | 0.042 | 0.000 | 24.000 | 436.000 | 0.405 |
| one_relevant_branch | hash_embedding_proxy | 1.000 | 0.083 | 0.083 | 24.000 | 440.000 | 0.404 |
| simultaneous_conversations | hash_embedding_proxy | 1.000 | 0.083 | 0.000 | 24.000 | 440.000 | 0.409 |
| topic_switch | hash_embedding_proxy | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.406 |
| pronoun_reference | hash_embedding_proxy | 0.500 | 0.042 | 0.000 | 24.000 | 440.000 | 0.405 |
| same_author_continuation | hash_embedding_proxy | 0.667 | 0.083 | 0.000 | 24.000 | 436.000 | 0.403 |
| paraphrased_reference | hash_embedding_proxy | 1.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.425 |
| scattered_context | hash_embedding_proxy | 1.000 | 0.125 | 0.000 | 24.000 | 430.000 | 0.505 |
| irrelevant_high_similarity | hash_embedding_proxy | 1.000 | 0.042 | 0.083 | 24.000 | 441.000 | 0.393 |
| historical_context_not_recovered | hash_embedding_proxy | 1.000 | 0.042 | 0.042 | 24.000 | 438.000 | 0.389 |
| coreference_ambiguous | hash_embedding_proxy | 0.500 | 0.042 | 0.000 | 24.000 | 442.000 | 0.409 |
| semantic_paraphrase | hash_embedding_proxy | 0.000 | 0.042 | 0.000 | 24.000 | 443.000 | 0.460 |
| misleading_overlap_hard | hash_embedding_proxy | 1.000 | 0.042 | 0.083 | 24.000 | 458.000 | 0.363 |
| topic_resumption | hash_embedding_proxy | 1.000 | 0.083 | 0.000 | 24.000 | 441.000 | 0.408 |
| speaker_sensitive | hash_embedding_proxy | 1.000 | 0.042 | 0.042 | 24.000 | 432.000 | 0.311 |
| negative_historical_match | hash_embedding_proxy | 1.000 | 0.042 | 0.042 | 24.000 | 442.000 | 0.311 |
| trigger_only | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| immediate_predecessor | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| several_turns_back | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| old_relevant_history | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| reply_ancestry | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| one_relevant_branch | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| simultaneous_conversations | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| topic_switch | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| pronoun_reference | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| same_author_continuation | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| paraphrased_reference | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| scattered_context | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| irrelevant_high_similarity | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| historical_context_not_recovered | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| coreference_ambiguous | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| semantic_paraphrase | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| misleading_overlap_hard | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| topic_resumption | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| speaker_sensitive | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| negative_historical_match | existing_cross_encoder | n/a | n/a | n/a | n/a | n/a | n/a |
| trigger_only | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| immediate_predecessor | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| several_turns_back | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| old_relevant_history | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| reply_ancestry | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| one_relevant_branch | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| simultaneous_conversations | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| topic_switch | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| pronoun_reference | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| same_author_continuation | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| paraphrased_reference | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| scattered_context | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| irrelevant_high_similarity | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| historical_context_not_recovered | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| coreference_ambiguous | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| semantic_paraphrase | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| misleading_overlap_hard | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| topic_resumption | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| speaker_sensitive | openjev | n/a | n/a | n/a | n/a | n/a | n/a |
| negative_historical_match | openjev | n/a | n/a | n/a | n/a | n/a | n/a |

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
