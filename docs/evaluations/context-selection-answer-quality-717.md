<!--
@description: Evidence record for the bounded downstream context-support evaluation.
@footnote-scope: test
@footnote-module: ContextSelectionAnswerQualityReport
@footnote-risk: medium - A proxy can be mistaken for end-to-end answer quality.
@footnote-ethics: high - Synthetic facts avoid retaining private conversation content.
-->

# Context-selection downstream support evaluation (#717)

Status: **bounded deterministic support proxy complete; generated-answer
evaluation remains unavailable without an approved local/provider path**.

## Design

The harness selects one representative synthetic case from each of the 14
corpus categories and evaluates identical context packs from:

- the current 24-message window;
- BM25; and
- the bounded BM25 + deterministic graph hybrid.

Each case has hand-authored synthetic answer facts. The proxy reports whether
all facts are present in the selected context, whether all labeled necessary
messages were recovered, whether explicit distractors were selected while
facts were missing, selected-message count, estimated context tokens, and
retrieval latency. It does **not** generate an answer.

## Results

| Method                 | Answer correctness | Reference resolution | Confusion rate | Avg messages | Avg tokens | Retrieval p95 ms |
| ---------------------- | -----------------: | -------------------: | -------------: | -----------: | ---------: | ---------------: |
| Current window         |              0.571 |                0.357 |          0.071 |       24.000 |    442.000 |            0.067 |
| BM25                   |              0.857 |                0.857 |          0.000 |       24.000 |    440.429 |            0.866 |
| BM25 + graph expansion |              0.929 |                0.929 |          0.000 |       14.643 |    267.071 |            0.411 |

The graph hybrid improved this proxy's support score over BM25 while selecting
about 39% fewer messages and estimated tokens. This is evidence that context
selection can improve a downstream support proxy without semantic judgment.
It is not evidence of final answer correctness.

## Missing generation evidence

Generation latency, provider usage, and cost are `n/a`. No provider call was
made and no private content was sent to a remote model. The artifact keeps
these fields explicitly null rather than treating retrieval latency as answer
latency.

The proxy must be followed by a blinded downstream generation evaluation using
the same selected packs, with separate correctness/reference/confusion
criteria and either human scoring or a clearly limited judge protocol. The
same model must not be the sole generator and judge without recording that
limitation.

## Reproduction

```text
pnpm eval:context-answer-quality
pnpm exec tsx --test scripts/context-selection-answer-quality.test.ts
```

Artifacts:

- `artifacts/context-selection-717/answer-quality.json`
- `artifacts/context-selection-717/answer-quality-summary.md`
