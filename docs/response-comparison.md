# Response comparison

`pnpm responses:compare` is an explicit experiment to compare how models write
the same responses and review what they preserve. It is not a production
setting and does not choose a winner automatically.

## Commands

```text
pnpm responses:compare --check
pnpm responses:compare --config response-comparison.yaml
```

`--check` validates the configuration, resolves catalog profiles, checks
credentials, preflights the automatic reviewer, and checks provider support
without generating responses. The default command runs every planned
comparison that is supported, records
`completed`, `not_tested`, or `failed` for every planned attempt, and continues
after individual failures. It writes one self-contained
`response-comparison-<run-id>.html` report.

The stable configuration hash identifies the comparison definition. A unique
run ID identifies each observation. An active incomplete run for the same
configuration resumes from the ignored checkpoint at
`.footnote/response-comparison/<run-id>/checkpoint.jsonl`; completed runs do
not get reused by the next invocation.

## Configuration rules

- Profile IDs must resolve from the real model catalog. Raw `name`/`provider`/`model`
  entries are ephemeral candidates and must not be added to that catalog.
- Each entry under `settings` is one independent variant. The runner does not
  create an implicit Cartesian product.
- A setting may have an optional name and several intentional controls. The
  name is a review label, not a runtime control; use it when a combination such
  as temperature plus verbosity is deliberately being compared.
- `default` means provider/model defaults. It is distinct from an explicit
  sampling or output-control request.
- `cases: core` loads the durable reviewed suite from
  `packages/backend/test/fixtures/responseComparisonCore.yaml`. Inline cases
  remain available for a separately scoped experiment.
- Personas and expression strength use existing backend persona machinery. The
  YAML names a persona; it does not duplicate persona prompt prose.
- Requirements are concrete preservation assertions. `mustKeep` categories
  describe invariants and are not combined into a winner score.
- The experiment does not expose a generic end-user temperature slider.

## Review and evidence

The initial report is blind when `review.blind` is true. It keeps the source
messages, resolved persona context, expression strength, requirements, and
candidate prose visible while hiding provider, model, settings, cost, latency,
automatic review, and saved human-review metadata. Reviewer identity and
blind human judgments are available without revealing model metadata. A
metadata reveal is persisted locally and recorded. Downloading a reviewed
report creates a new immutable HTML document and leaves the original report
unchanged.

Each response records source messages and resolved guidance, requested,
forwarded, omitted, and provider-observed settings separately, plus provider
support evidence, model attribution, completion, latency, usage, cost, and
output length when available. Unsupported settings are not run and are
recorded as evidence rather than being guessed. Automatic review records the
exact instruction and schema and is accepted only when every requested
must-keep requirement and rating dimension is present. Revealed summaries keep
automatic review coverage, automatic ratings, human ratings, generation cost,
review cost, and total cost separate.

This exercise is related to model-strength escalation in #564, but it does not
decide that separate question. Do not commit presentation defaults or close the
tracking issue until the fixed suite, review evidence, and a holdout confirmation
support the recommendation.
