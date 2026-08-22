# Model Behavior Baseline

Status: corpus and deterministic integrity checks are available. A
credential-gated live runner is intentionally deferred until it can invoke the
normal planner, generation, and review seams without reconstructing chat
orchestration.

## Purpose

This baseline supports later prompt, reasoning, routing, and structured-output
comparisons. It is observational. It does not change model profiles, prompts,
routing, provider contracts, or review behavior.

The source corpus is:

```text
packages/backend/test/fixtures/modelBehaviorBaseline.json
```

Its integrity tests are:

```text
packages/backend/test/modelBehaviorBaseline.test.ts
```

## Initial cases

The six cases isolate first-pass behavior rather than combining retrieval,
current-state judgment, and answer quality in one workload:

1. direct generation with retrieval forbidden;
2. planner ordinary-message selection;
3. planner retrieval selection;
4. structured planner schema validity;
5. review finalization of a clearly good draft;
6. review revision of a clearly defective draft.

Retrieval quality, source coverage, and current-state answer quality are later
cases. They should be added after a live runner can execute the normal backend
seams without bypassing policy or routing.

## Check classes

Each case separates three kinds of evidence:

- `deterministic`: contract and normalization checks suitable for CI;
- `objective`: observable runtime outcomes such as selected action, retrieval
  intent, schema validity, or review decision;
- `qualitative`: answer or instruction quality that requires manual review for
  now. No model-based judge is part of this baseline.

## Planned live result rows

When a thin runner is added, it should write one JSONL record per case and
repeat. Each row should include:

- run ID, timestamp, git SHA, and corpus version;
- case ID, workflow mode, profile ID, provider, and requested/resolved model;
- prompt/profile hashes where existing metadata can provide them;
- reasoning effort and verbosity;
- duration, token categories, and provider-reported cost when available;
- retrieval, citation, structured-output, review, and fail-open outcomes;
- qualitative artifacts or references for manual review, without requiring raw
  prompts or responses in committed files.

Calculated cost should only be added when the existing pricing source can be
recorded with a version or date. Token counts and provider-reported cost are
the factual baseline otherwise.

## Provider-specific observations

Provider-native response IDs, output item IDs, annotations, native tool-call
IDs, and provider routing details are diagnostic artifacts. They must not be
flattened into shared Footnote contracts merely for symmetry. The conformance
tests record the current OpenAI response identity boundary without exposing it
as a public response field.
