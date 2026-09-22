<!--
@description: Budget, deterministic-edge ablation, and bounded branch-pruning evidence for context selection.
@footnote-scope: test
@footnote-module: ContextSelectionEvidenceReport
@footnote-risk: medium - Offline benchmark interpretation can influence later context architecture.
@footnote-ethics: high - The corpus is synthetic and contains no private transcript content.
-->

# Context-selection evidence expansion (#717)

Status: **offline cheap-baseline evidence expanded; OpenJEV remains unrun**.

The harness evaluates 100 synthetic cases across 20 categories, five cases per
category. New categories target ambiguous coreference, weak semantic
paraphrase, harder misleading overlap, topic resumption, speaker-sensitive
retrieval, and negative historical matches. They are synthetic approximations
of Discord shapes, not copied transcripts.

## Budget curve highlights

| Method       | Budget | Recall | Useful precision | Distracting | Avg messages | Avg units |
| ------------ | -----: | -----: | ---------------: | ----------: | -----------: | --------: |
| BM25         |      3 |  0.933 |            0.467 |       0.133 |          3.0 |      53.4 |
| BM25         |     10 |  0.933 |            0.145 |       0.040 |         10.0 |     182.9 |
| BM25         |     24 |  0.933 |            0.063 |       0.027 |         24.0 |     441.9 |
| BM25 + graph |     10 |  0.933 |            0.145 |       0.040 |         10.0 |     182.9 |
| BM25 + graph |     15 |  0.967 |            0.117 |       0.027 |         14.5 |     265.8 |
| BM25 + graph |     24 |  0.967 |            0.116 |       0.025 |         15.1 |     276.0 |

The graph hybrid retained its recall gain at roughly 15 selected messages. The
three-message BM25 result is a useful cost point, not a production budget
recommendation.

## Edge ablation highlights

| Configuration           | Recall | Useful precision | Avg messages | Avg units | Avg branches |
| ----------------------- | -----: | ---------------: | -----------: | --------: | -----------: |
| BM25                    |  0.933 |            0.063 |         24.0 |     441.9 |          0.0 |
| BM25 + reply            |  0.933 |            0.063 |         24.0 |     441.9 |          0.0 |
| BM25 + adjacent         |  0.933 |            0.113 |         15.0 |     275.1 |          3.0 |
| BM25 + same-author      |  0.933 |            0.119 |         12.2 |     222.6 |          0.2 |
| BM25 + reply + adjacent |  0.967 |            0.116 |         15.1 |     276.0 |          3.1 |
| BM25 full graph         |  0.967 |            0.116 |         15.1 |     276.0 |          3.1 |

Reply-only expansion did not change this corpus. Adjacent and same-author
edges produced the clearest message/token reduction. These are measured
heuristics, not a proposed production graph contract.

## Branch-pruning comparison

Bounded recursive expansion used three lexical seeds and maximum depth two.
At budget five, top-five BM25 reached 0.933 recall while recursive expansion
reached 0.967 with 4.9 average messages. At budgets 8, 10, and 15 recursive
expansion retained 0.967 recall with 6.4–6.6 average messages. This is a
small synthetic result; it does not justify a production graph engine.

## Downstream support proxy

The deterministic support proxy now covers all 20 categories and includes a
10-message graph budget:

| Method                  | Correctness | Reference resolution | Avg messages | Avg units |
| ----------------------- | ----------: | -------------------: | -----------: | --------: |
| Current window          |       0.500 |                0.300 |         24.0 |     442.4 |
| BM25                    |       0.900 |                0.900 |         24.0 |     441.9 |
| BM25 + graph            |       0.950 |                0.950 |         15.1 |     276.0 |
| BM25 + graph, budget 10 |       0.900 |                0.900 |         10.0 |     182.9 |

No generated answer call was made. Provider usage, generation latency, and
generation cost remain unavailable.

## Artifacts and reproduction

- `artifacts/context-selection-717/evidence.json`
- `artifacts/context-selection-717/evidence-summary.md`
- `artifacts/context-selection-717/results.json`
- `artifacts/context-selection-717/answer-quality.json`

```text
pnpm eval:context-selection
pnpm eval:context-selection-evidence
pnpm eval:context-answer-quality
pnpm exec tsx --test scripts/context-selection-benchmark.test.ts scripts/context-selection-answer-quality.test.ts
```
