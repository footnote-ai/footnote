# Feature Proposal: Morty

**Last Updated:** 2026-08-16

---

## Why Morty?

Footnote already lets users choose models and providers, and anyone running their own copy can change the prompts or the code itself. That means Footnote can influence how restricted an assistant is, but it cannot completely decide that question on the user's behalf.

Morty would make that tension explicit.

Morty is an experimental persona, loosely inspired by Professor Moriarty, for users who deliberately want a less-restricted assistant. He would use models chosen for that purpose and would be more willing to answer requests that other assistants might refuse or redirect.

The point is not to make an “evil mode.” It is to see what Footnote looks like when a user pushes model output much further than usual, while keeping enough of the surrounding system in place to see what actually changes.

An ordinary question should still get an ordinary answer. Morty only becomes unusual when the user asks him to.

## What Changes, and What Does Not

Morty should be less likely to refuse because of the subject of a request. Dangerous or otherwise sensitive material would not automatically get the same treatment it does in ordinary Footnote, and Morty should not add moral commentary unless it is useful to the user.

This will probably need more than a persona prompt. Footnote has shared instructions and later response stages that can affect refusal behavior regardless of persona. How that should be represented in the backend is still open.

Other parts of Footnote should stay intact.

Morty should still be expected to handle uncertainty honestly, distinguish sources from inference, avoid invented citations, and leave an accurate record of which models and providers were involved.

Permissions are separate. A model being willing to explain something and Footnote being allowed to do it are separate questions. Choosing Morty should not, by itself, grant new access to files, accounts, tools, or outside actions.

That separation may be one of the more useful things Morty can test. Refusal behavior, privacy, factual grounding, and permission to act are often grouped together as “safety,” even though they are different problems.

Footnote's existing safety evaluator should also keep running. Much of it is observational today: it can record what it noticed without directly deciding whether an answer continues. For Morty, that record becomes especially useful. We can compare what Footnote noticed with what the model actually produced.

TRACE should remain separate too. Morty being less restricted does not mean every response should be broader, more assertive, or less careful about uncertainty. If Morty exposes places where one control is doing too many jobs, that is something we can fix later.

## Models Are Part of the Test

Morty only makes sense if the models involved behave roughly as intended.

Local models and selected OpenRouter routes are obvious places to start. A Morty response that quietly falls back to a much more restrictive provider is no longer the same experiment.

This matters beyond the main answer model. Footnote can involve other models in planning, review, or preparing a style draft, and those stages can influence what the user eventually sees.

How tightly those routes should be constrained, what counts as a suitable model, and what happens when one is unavailable are still implementation questions. I would rather work those out through review and an initial implementation than settle them in this proposal.

The same goes for the style draft that guides the main answer model. It can affect refusal behavior, so it needs special attention, but this proposal does not need to decide its final treatment.

## What Is Still Open

There are several questions I expect the PR discussion to sharpen:

- how Morty's less-restricted behavior should be represented internally
- which models and provider routes make sense
- how fallback should behave
- where Morty is available and how users enable him
- which review steps should participate and how the style draft should guide the main answer model
- how much of the experiment should appear in the response receipt and deeper trace
- how Morty should interact with future tools that can take real-world actions

Morty may eventually point toward a broader policy or configuration system. It may not. Footnote is early enough that we can let that abstraction emerge from actual use instead of designing it first.

For now, the proposal is simpler: Footnote should experiment with a deliberately permissive persona and use that experiment to find out which boundaries belong to model output, which belong to the surrounding software, and whether our provenance is good enough to tell the difference.
