# Model Behavior Baseline

Status: the corpus and its deterministic integrity checks are in place. A
credential-gated live runner stays deferred until it can drive the normal
planner, generation, and review seams directly, rather than reconstructing
chat orchestration around it.

## Goal

This baseline exists to support later comparisons of prompts, reasoning,
routing, and structured output. It is observational only: nothing here
changes model profiles, prompts, routing, provider contracts, or review
behavior.

The corpus and its tests live here:

```text
packages/backend/test/fixtures/modelBehaviorBaseline.json   # corpus
packages/backend/test/modelBehaviorBaseline.test.ts         # integrity tests
```

## Initial Cases

The six cases keep first-pass behavior isolated, rather than folding
retrieval, current-state judgment, and answer quality into one workload:

1. direct generation with retrieval forbidden
2. planner selection on an ordinary message
3. planner selection on a retrieval request
4. structured planner schema validity
5. review finalizing a clearly good draft
6. review revising a clearly defective draft

Retrieval quality, source coverage, and current-state answer quality belong
in later cases, once a live runner can exercise the normal backend seams
without bypassing policy or routing.

## Check Classes

Each case separates three kinds of evidence:

- `deterministic`: contract and normalization checks suitable for CI
- `objective`: observable runtime outcomes such as the selected action,
  retrieval intent, schema validity, or review decision
- `qualitative`: answer or instruction quality, which still needs manual
  review. No model-based judge is part of this baseline.

## Planned Live Result Rows

Once a thin runner exists, it should write one JSONL record per case, per
repeat run. Each row should capture:

- run ID, timestamp, git SHA, and corpus version
- case ID, workflow mode, profile ID, provider, and requested/resolved model
- prompt and profile hashes, where existing metadata can provide them
- reasoning effort and verbosity
- duration, token categories, and provider-reported cost when available
- retrieval, citation, structured-output, review, and fail-open outcomes
- qualitative artifacts or references for manual review, without committing
  raw prompts or responses to the repo

Calculated cost should only appear once the pricing source behind it can be
tied to a version or date. Until then, token counts and provider-reported
cost are the factual baseline.

## Provider-Specific Observations

Provider-native response IDs, output item IDs, annotations, native
tool-call IDs, and provider routing details are diagnostic artifacts, not
contract material, and they should not be flattened into shared Footnote
contracts just for symmetry. The OpenAI Responses conformance tests
(`packages/agent-runtime/test/openaiResponsesConformance.test.ts`) already
pin this boundary: the provider's native response ID stays available
internally without becoming a public response field.
