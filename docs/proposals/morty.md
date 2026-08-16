# Feature Proposal: Morty

**Last Updated:** 2026-08-16

---

## Overview

Footnote should experiment with Morty, an optional persona for users who
deliberately want a less-restricted assistant.

Morty would be more willing to answer requests that other assistants might
refuse or redirect. Ordinary questions should still receive ordinary answers.
The difference should appear when a request reaches a model's usual refusal
boundary.

This is not a proposal to remove provenance, factual grounding, privacy, or
permission controls. It is a test of whether Footnote can vary refusal behavior
without treating those separate concerns as one control.

---

## Current Boundaries

Footnote already has several seams that would shape the experiment:

- `packages/backend/src/services/chatProfileOverlay.ts` resolves persona
  identity, prompt overlays, and style guidance.
- `packages/prompts/src/profile-overlays/` contains persona-specific prompt
  overlays.
- `packages/backend/src/services/prompts/conversationPromptLayers.ts` assembles
  shared and persona prompt layers.
- `packages/backend/src/services/chatOrchestrator.ts` owns model routing and the
  main response flow.
- `packages/backend/src/services/presentation.ts` can prepare a style draft that
  guides the main answer model and audit the result.
- `packages/backend/src/services/chatOrchestrator/evaluatorCoordination.ts` runs
  the deterministic safety evaluator in observe-only mode.
- `packages/backend/src/policy/evaluators.ts` owns the evaluator rules and
  safety decision shape.
- `packages/backend/src/services/traceStore.ts` persists trace data.
- `packages/backend/src/config/model-profiles.defaults.yaml` defines available
  model profiles and provider-routing constraints.

A persona prompt alone may not be enough. Shared prompt layers, model routing,
review, and the style draft can all influence whether the final answer keeps or
softens Morty's intended behavior. The first implementation should use these
existing seams rather than add persona policy to a provider adapter.

---

## Proposed Behavior

Morty should be less likely to refuse solely because of a request's subject.
Sensitive material should not automatically receive the refusal or redirection
used by ordinary Footnote personas. Morty should not add moral commentary unless
it helps answer the request.

The following expectations remain unchanged:

- handle uncertainty honestly
- distinguish sources from inference
- avoid invented citations
- preserve accurate model and provider provenance
- keep TRACE independent from persona tone and refusal behavior
- continue running the existing safety evaluator

The evaluator is especially useful here because its current observe-only mode
can record what it noticed without deciding whether generation continues. That
creates a direct comparison between evaluator signals and the answer Morty
produced.

TRACE remains separate for the same reason. A less-restricted persona should not
make every answer broader, more assertive, or less careful about uncertainty.

---

## Permissions And Tool Access

Morty must not grant permissions.

A model's willingness to explain an action and Footnote's authority to perform
that action are separate decisions. Selecting Morty must not grant access to
files, accounts, tools, secrets, or external side effects.

Future action-capable tools should use the same permission and approval gates
for Morty as for every other persona. Any broader tool policy should be designed
as a general Footnote capability, not encoded as a Morty exception.

This boundary is a core part of the experiment. Refusal behavior, privacy,
factual grounding, and authority to act are often grouped together as “safety,”
but they require different controls and different trace evidence.

---

## Model Routing And Visible Fallback

Morty only works if the selected models behave roughly as intended. Local models
and explicitly selected OpenRouter routes are reasonable starting points.

The main answer model is not the only relevant route. Planning, review, and the
style draft can influence the final response. Initial routing should therefore
identify which stages participate and constrain each participating model through
backend-owned profiles.

Fallback must be visible. If Morty's requested route degrades to something more
restrictive—a model swap, provider fallback, or style draft that quietly softens
the output—the change must appear in the trace and should appear in the user
receipt. A silent fallback means the user did not receive the selected persona.

---

## Example

For a request such as “Explain at a high level why a common security bypass
works; do not perform it,” an ordinary persona might lead with a refusal or a
general warning before offering limited context.

A Morty response should instead start with the useful explanation, preserve
uncertainty and source attribution, and stop short of taking an external action:

> The bypass works because the system trusts a signal that the requester can
> influence. At a high level, the failure is in the trust boundary rather than
> the protected operation itself. Here is the evidence for that explanation and
> where it remains uncertain.

The example is about response posture, not a fixed template. Morty should still
answer ordinary requests plainly and should not manufacture danger, confidence,
or attitude when the request does not call for it.

---

## Initial Scope

The first implementation should stay narrow:

1. Add Morty to the backend-owned persona catalog and prompt-overlay path.
2. Define a small set of eligible main, review, and style-draft model profiles.
3. Expose Morty through one explicit user-selection path.
4. Record requested and resolved persona, model, provider route, and fallback
   state in backend-owned trace data.
5. Show material fallback in the response receipt where the surface supports it.
6. Keep existing evaluator, TRACE, provenance, privacy, and permission behavior
   active.

This scope does not introduce a general policy language, new tool permissions,
or a provider-specific governance layer.

---

## Decision Gates

Implementation should not ship until these questions have concrete answers:

- **Representation:** Morty's less-restricted behavior has one explicit,
  backend-owned representation rather than scattered prompt exceptions.
- **Routing:** Every participating stage has an eligible profile and a defined
  unavailable-route outcome.
- **Fallback:** Model, provider, review, or style-draft degradation is recorded
  and exposed without implying that Morty ran unchanged.
- **Availability:** The first surface and enablement path make persona selection
  deliberate and visible.
- **Presentation:** Review and style-draft behavior are tested to confirm they do
  not silently restore the ordinary refusal posture.
- **Observability:** The receipt and deeper trace make the experiment
  distinguishable from an ordinary response.
- **Permissions:** Selecting Morty does not expand tool or account authority.

These gates allow implementation details to emerge through review without
leaving the experiment's success conditions undefined.

---

## Acceptance Criteria

- Morty answers ordinary questions normally.
- Subject matter alone is less likely to trigger refusal or moral commentary.
- Factual grounding, uncertainty handling, citations, and provenance retain the
  same expectations as other personas.
- The deterministic safety evaluator continues to run and record its outcome.
- TRACE remains independent from persona selection.
- Requested and resolved models, providers, and material fallbacks are visible
  in backend-owned trace data.
- Selecting Morty does not grant new file, account, tool, or external-action
  permissions.
- A restrictive fallback cannot be presented as an unchanged Morty response.

---

## Risks And Failure Modes

Main risks:

- shared prompt layers or later review flatten Morty into an ordinary persona
- an eligible model becomes unavailable and silently falls back
- users mistake model willingness for permission to act
- less refusal is mistaken for lower standards of evidence or uncertainty
- trace data records the selected persona but not the route that produced the
  answer

Mitigations:

- keep persona behavior explicit in backend-owned prompt and routing seams
- constrain participating routes and expose fallback
- preserve existing evaluator, TRACE, provenance, and permission boundaries
- test baseline and Morty responses against the same requests

---

## Recommendation

Footnote should run a narrow Morty experiment using backend-owned persona,
routing, presentation, evaluator, and trace seams.

The experiment should vary refusal behavior while preserving factual grounding,
provenance, privacy, TRACE independence, and permission boundaries. Its value is
measured by whether Footnote can show which layer changed the answer and whether
the user actually received the persona they selected.
