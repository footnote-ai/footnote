# Presentation Flow Status

Status: the current runtime uses a simpler presentation flow. This cleanup
matters because older documentation described presentation as a style writer
followed by a separate validator or audit model. The workflow changed, but the
old configuration and terminology remained. Operators and contributors could
therefore think a review model was running when it was not.

The current flow is:

1. An optional presentation model drafts wording and style.
2. Footnote checks that the returned draft is usable prose. This small check
   does not judge facts, grounding, safety, policy, or persona correctness.
3. Normal answer generation may use the draft as a style suggestion while it
   works from the authoritative context and makes the answer.
4. The normal assessment/revision loop reviews that answer for correctness,
   grounding, posture, TRACE, and needed corrections.

There is no separate presentation-validator model call. The second step is
called `candidate admission` in the code and serialized contracts, but that
name means only the prose-usability check above. The presentation draft never
owns facts, policy, provenance, safety decisions, or the final answer.

New receipts record the actual presentation attempt, model attribution, and
skip or failure reason. Old traces remain readable, but new runs do not create
validator or audit records. Old YAML validator settings may still be loaded
only to produce explicit deprecated-and-ignored warnings; they do nothing and
are not copied into runtime configuration.

Related work:

- [Presentation contract drift issue #563](https://github.com/footnote-ai/footnote/issues/563)
- [Model-strength escalation follow-up #564](https://github.com/footnote-ai/footnote/issues/564)
- [Workflow budget review #548](https://github.com/footnote-ai/footnote/issues/548)
