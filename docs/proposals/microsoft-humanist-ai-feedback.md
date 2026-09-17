# Draft: Feedback on Microsoft's Humanist AI Code of Conduct

**Status:** Draft for human review; not submitted
**Date:** 2026-09-17

Microsoft's [Humanist AI Code of Conduct](https://microsoft.ai/code-of-conduct/)
and its [public consultation announcement](https://microsoft.ai/news/mai-code-of-conduct/)
are useful prior art. They articulate model-level goals around human control,
pluralism, uncertainty, non-manipulation, bounded scope, tool use, delegation,
interruption, reversibility, and legible action records. The documents are
explicitly a work in progress and are intended to guide Microsoft's MAI models,
not Footnote or other models.

## Potential Footnote contribution

The most useful distinction Footnote can offer is an engineering one:

> Declared behavioral principles, actual authorization/control flow, provenance
> of information, and reconstructible runtime evidence are different things.

An instruction in a retrieved document or tool response may be relevant data
without being authorized direction. A provenance record can show where that
instruction-like text came from without proving that the system was permitted
to act on it. Likewise, a model's explanation is not sufficient evidence that
the action happened as described. The surrounding system should retain the
backend-owned authorization decision, bounded delegation, stop state, and
observed action result, while presenting only an appropriate projection to each
audience.

This also suggests a question for future consultation: how will evaluations
distinguish a model that states the right chain of command from a system that
actually prevents untrusted content, delegated agents, or model outputs from
acquiring authority and can reconstruct the difference after a failure?

Footnote would preserve pluralism and firm human-rights constraints without
adopting one comprehensive moral philosophy, and would avoid claims about
model consciousness or rights. This note is not an endorsement, dependency,
submission, or statement on behalf of Footnote.
