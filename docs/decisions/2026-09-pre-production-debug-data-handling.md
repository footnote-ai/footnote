# Pre-production Debug Data Handling

**Decision:** During pre-production, Footnote may keep rich, bounded debug data
when it materially helps contributors understand and improve an execution.
**Date:** 2026-09-01

---

## 1. Why this is useful now

Footnote is still changing quickly. Useful evidence is spread across execution
records, traces, SQLite, and console logs while workflows, routing, context,
review, model controls, and timing are being built. Rich diagnostics let us see
what a model actually received and returned instead of debugging from guesses.

## 2. Current pre-production posture

For the current development deployment, Footnote may retain the bounded
diagnostic information needed to understand a run. This can include:

- the user's request;
- the model-visible input assembled for an Attempt;
- system, developer, and persona instructions, plus retrieved context;
- tool exchanges and intermediate model outputs;
- candidates, reviews, and revisions;
- provider, model, routing, and fallback information;
- timing, usage, cost, limits, and termination facts; and
- the final answer delivered to the user.

This is sensitive debugging data. It is intended for authenticated,
operator-authorized debugging use, not ordinary users or public links. Public
traces, public proof, normal logs, telemetry, and other outward-facing surfaces
remain narrower projections.

## 3. What is not debug data

Known secrets must not be persisted as diagnostic data. This includes
passwords, API keys, provider credentials, session cookies, bearer or other
authorization tokens, CSRF values, private keys, and equivalent authentication
material. This decision records the boundary; it does not design a universal
secret-scanning system.

Footnote must not try to capture or expose hidden chain-of-thought. Provider-
reported reasoning-token counts, reasoning settings, and safe provider-supplied
summaries are different structured facts and may still be useful.

## 4. Retention is temporary

For this development deployment, keeping these diagnostics until they are
manually deleted is acceptable. We need enough history to investigate failures
while the system is still taking shape, and we do not yet know what a sensible
hosted default would be.

“Until manually deleted” is a temporary pre-production development posture. It
is not Footnote's permanent privacy promise or a future hosted-service default.

Before broad production use, Footnote still needs decisions about:

- default hosted retention periods;
- user erasure beyond current account data, including anonymous-user deletion;
- backup and snapshot expiry;
- exports;
- optional no-retention or reduced-retention modes;
- whether capture levels should be configurable; and
- how the active privacy posture is disclosed to users.

Those are future questions, not implementation requirements for this decision.

## 5. Keep the execution record separate from diagnostic content

The canonical, backend-owned `Run -> Step -> Attempt -> Result` record from
[#578](https://github.com/footnote-ai/footnote/issues/578) remains the
structured source of truth for what happened: the workflow path, step outcomes,
attempts, results, timing, usage, limits, and termination.

Associated diagnostic material can explain what content was involved. Large
assembled prompts, model outputs, and similar bodies should live alongside or
be referenced from the canonical execution record, not turn the `Run` into a
transcript archive. This document does not choose the storage mechanism.

The later implementation work owns that boundary: [#587](https://github.com/footnote-ai/footnote/issues/587)
defines operator-only access, [#589](https://github.com/footnote-ai/footnote/issues/589)
provides the run report, [#590](https://github.com/footnote-ai/footnote/issues/590)
records model inputs and outputs, and [#591](https://github.com/footnote-ai/footnote/issues/591)
shows them in the report. Debug content must not become a second workflow or
provenance authority.

## Related work

- [Workflow architecture](../architecture/workflow.md) describes the current
  execution vocabulary and projection boundaries.
- [Footnote philosophy](../Philosophy.md) covers user control, reversibility,
  transparency, serious-failure evidence, ownership, and self-hosting.
- [#450](https://github.com/footnote-ai/footnote/issues/450) owns provider-side
  retention; [#523](https://github.com/footnote-ai/footnote/issues/523) and
  [#524](https://github.com/footnote-ai/footnote/issues/524) own current account
  export and deletion.
- [#574](https://github.com/footnote-ai/footnote/issues/574) owns public proof,
  and [#584](https://github.com/footnote-ai/footnote/issues/584) owns the
  privacy-safe telemetry projection.
