<!--
@description: Evidence record for the bounded downstream context-support evaluation.
@footnote-scope: test
@footnote-module: ContextSelectionAnswerQualityReport
@footnote-risk: medium - A proxy can be mistaken for end-to-end answer quality.
@footnote-ethics: high - Synthetic facts avoid retaining private conversation content.
-->

# Context-selection downstream support evaluation (#717)

Status: **bounded support proxy complete; no production selector is justified**.

## Design

The harness selects one representative synthetic case from each of the 20
corpus categories and evaluates identical context packs from:

- the current 24-message window;
- BM25; and
- the bounded BM25 + deterministic graph hybrid;
- the same graph hybrid with a 10-message budget.

Each case has hand-authored synthetic answer facts. The proxy reports whether
all facts are present in the selected context, whether all labeled necessary
messages were recovered, whether explicit distractors were selected while
facts were missing, selected-message count, estimated context tokens, and
retrieval latency. It does **not** generate an answer.

## Results

| Method                  | Answer correctness | Reference resolution | Confusion rate | Avg messages | Avg context units | Retrieval p95 ms |
| ----------------------- | -----------------: | -------------------: | -------------: | -----------: | ----------------: | ---------------: |
| Current window          |              0.500 |                0.300 |          0.200 |       24.000 |           442.400 |            0.040 |
| BM25                    |              0.900 |                0.900 |          0.000 |       24.000 |           441.850 |            0.665 |
| BM25 + graph expansion  |              0.950 |                0.950 |          0.000 |       15.050 |           275.950 |            0.318 |
| BM25 + graph, budget 10 |              0.900 |                0.900 |          0.000 |       10.000 |           182.850 |            0.256 |

The full graph hybrid improved this proxy's support score over BM25 while
selecting about 37% fewer messages and estimated context units. The 10-message
graph budget matched BM25's proxy score while using about 59% fewer context
units.
This is evidence that context selection can improve a downstream support
proxy without semantic judgment. It is not evidence of final answer
correctness.

## What this does and does not prove

Generation latency, provider usage, and cost are `n/a`. No provider call was
made and no private content was sent to a remote model. The artifact keeps
these fields explicitly null rather than treating retrieval latency as answer
latency.

#722 added a bounded hosted comparison after this local proxy. It did not show
better answer quality for BM25 plus deterministic expansion. The local proxy
still has no generation metrics, so it cannot establish final answer quality.
The artifacts are retained for evaluation and regression reproduction only. No
production semantic routing, context graph, or `JudgmentRuntime` follows from
this report.

## Reproduction

```text
pnpm eval:context-answer-quality
pnpm exec tsx --test scripts/context-selection-answer-quality.test.ts
```

Artifacts:

- `artifacts/context-selection-717/answer-quality.json`
- `artifacts/context-selection-717/answer-quality-summary.md`
