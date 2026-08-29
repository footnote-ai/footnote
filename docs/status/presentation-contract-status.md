# Presentation Flow Status

Status: the current runtime uses the authority-first presentation flow. The
optional DeepSeek V4 Flash 0731 profile is enabled only by the canonical Fly
settings; fresh installs remain disabled.

The current flow is:

1. Normal generation creates the authoritative answer from the collected
   context.
2. An optional presentation model drafts a faithful wording rewrite.
3. Footnote checks that the returned draft is usable prose. This small check
   does not judge facts, grounding, safety, policy, or persona correctness.
4. The normal assessment/revision loop reviews the candidate or authoritative
   fallback for correctness, grounding, posture, TRACE, and needed corrections.

There is no separate presentation-validator model call. The second step is
called `candidate admission` in the code and serialized contracts, but that
name means only the prose-usability check above. The presentation draft never
owns facts, policy, provenance, safety decisions, or the final answer. If
presentation fails after authority succeeds, the authoritative answer remains
available and the failure is recorded separately.

New receipts record the actual presentation attempt, model attribution, and
skip or failure reason. Old traces remain readable, but new runs do not create
validator or audit records. Old YAML validator settings may still be loaded
only to produce explicit deprecated-and-ignored warnings; they do nothing and
are not copied into runtime configuration.

Related work:

- [Presentation contract drift issue #563](https://github.com/footnote-ai/footnote/issues/563)
- [Model-strength escalation follow-up #564](https://github.com/footnote-ai/footnote/issues/564)
- [Workflow budget review #548](https://github.com/footnote-ai/footnote/issues/548)
