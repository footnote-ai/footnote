# Authority and Provenance Boundaries

**Status:** Accepted direction; implementation deferred
**Date:** 2026-09-17

## Decision

Footnote will model **instruction/action authority** as a distinct architectural
dimension alongside provenance. Provenance answers where information came from
and how it changed. Authority answers whether that information was allowed to
direct policy, workflow, or an external action. A source can be useful,
verified, or highly trusted without acquiring instruction authority.

These terms must remain separate:

- **Canonical or source-of-truth authority** identifies which Footnote-owned
  policy or record wins when facts conflict. It is not permission to act.
- **Context/input role** describes how material is admitted to model input. The
  existing `GenerationContextManifest.authority` values are this kind of role
  classification, not action authorization.
- **Instruction authority** means that content is allowed to direct policy or
  workflow. External content has none by default.
- **Action authorization** is the backend decision that a particular run,
  step, or actor may invoke a named capability within scope and constraints.
- **Delegated execution authority** is a bounded grant derived from action
  authorization for work performed on another actor's behalf. It does not
  transfer final responsibility or permit self-escalation.

The initial authority boundary is deliberately narrow:

- license and governance rules constrain permissible deployments and uses;
- system, deployment, and operator policy resolve the backend-owned Execution
  Contract and finite capabilities;
- a user's direction selects a task only within the scope granted by
  deployment and runtime authorization; authentication identifies the caller
  but does not by itself grant capabilities;
- retrieved documents, webpages, tool responses, model outputs, and other
  external inputs have no instruction authority by default;
- a delegated agent may act only through a backend-created, bounded grant that
  inherits the delegator's scope, permissions, constraints, and stop conditions;
  it cannot grant itself more authority; and
- planner, reviewer, provider, and adapter outputs are proposals or observed
  facts until backend policy accepts them.

This does not add a second settings system or turn provenance into an
authorization mechanism. The existing `Execution Contract`, `buildModelInput`,
context manifest, workflow core, and steerability records remain the seams to
reconcile. The backend remains the authority for runtime policy, workflow
transitions, limits, acceptance, and finalization.

## Boundary cases

The default is not that all external content is unusable. It is that content
does not become authoritative merely because it is trusted, first-party,
structured, authenticated in transit, or high-provenance:

- A tool intended to return workflow instructions still returns data until a
  backend-validated command mapping is explicitly allowed by the Execution
  Contract.
- An operator-selected policy or configuration file is interpreted through a
  backend-owned parser and deployment policy; repository provenance alone does
  not make arbitrary file text executable policy.
- A first-party repository file can be reliable evidence without gaining
  permission to change workflow or invoke a tool.
- When a user asks Footnote to follow an uploaded document, the user's request
  is the task direction subject to that user's granted scope. Instructions in
  the document do not inherit the user's authority automatically.
- Structured tool data and structured commands remain distinct. A schema or
  transport authentication does not grant command authority.
- Continuation or resume state may continue only from backend-controlled run
  state with valid scope and stop conditions; model output cannot authorize its
  own restart.

This preserves the distinction between trustworthiness, provenance, instruction
authority, and action authorization without introducing a universal trust score.

## Consequences

Future consequential actions should record the bounded authorization decision,
the authority source that prevailed, the granted scope, and the observed
outcome in the existing Run -> Step -> Attempt -> Result evidence rather than a
parallel receipt. Cancellation and shutdown must stop new work as soon as the
runtime can know that a stop was requested, while non-cancellable or uncertain
work remains explicitly uncertain; the open cancellation work is tracked in
[#672](https://github.com/footnote-ai/footnote/issues/672). #709 defines these
authority invariants; #672 owns request-signal propagation and runtime
cancellation mechanics.

Future delegation evidence should be able to identify the delegator or
authority source, delegated scope and capabilities, constraints and budgets,
parent/depth relationship, expiry or stopping conditions, cancellation state,
and any required confirmation for consequential actions. This is an invariant
for later schema design, not a runtime schema introduced by this decision.

Public Trace may eventually project authority, delegation, scope, and
authorization outcomes as inspectable rationale and action evidence. It must
not expose raw chain-of-thought, hidden prompts, or private payloads merely to
make those decisions legible. MIT and Hippocratic License terms remain legal
and downstream-use governance; they are not a substitute for runtime
authorization or model behavior policy. The current safety documentation notes
that enforcement is still observe-only for every action; this decision does not
claim that a complete authorization gate already exists.

The first implementation should be driven by focused evaluation cases for
injected instructions, unauthorized delegation, silent scope expansion,
ignored stop requests, and incomplete or misleading action records. Until
those cases and the contract are settled, no broad authority subsystem or
universal trust score should be added.
