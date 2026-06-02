# Trust Boundary Work Status

This file tracks the planned branches for making trust-boundary code easier to
inspect. Use explicit TypeScript shapes first. Use `neverthrow` for expected
failures that callers need to handle with a concrete reason.

## 1) review-routing

Branch: `chore/trust-boundary-neverthrow-review-routing`  
Status: `done`

This branch cleaned up the review path where expected failures were still a
little too implicit.

The important cases are review decision parsing and routing-chain exhaustion.
Before this branch, review parsing could collapse to `null`, and some routing
failures moved through `throw new Error(reasonCode)` before being mapped back
into workflow metadata. That worked, but it hid useful meaning from the type
system and made the reader chase string comparisons.

`neverthrow` now returns those outcomes directly. A parse failure carries the
parse reason. A routing-chain failure carries its reason code as data, not as an
exception message. The workflow still fails open in the same situations it did
before.

Keep this branch small. It should touch review parsing, the review loop, initial
generation routing, and only the profile wiring needed to support the new return
types.

## 2) context-step-outcomes

Branch: `chore/trust-boundary-neverthrow-context-step-outcomes`  
Status: `done`

This branch is about context steps: web search, weather, reverse image search,
and similar tool-backed work.

Make the outcome shape state the actual result: executed, failed, skipped, or
needs user clarification. Do not leave these states as loose objects where
unrelated fields can appear together by accident.

Keep the current behavior. Tool failures should still be non-blocking. If a tool
needs clarification, the workflow should still stop before generation and return
that clarification to the caller. This change should make those states harder to
misuse and easier to inspect.

Keep public contracts serializable. Anything crossing package boundaries must
remain plain data.

Completed by adding a serializable context-step outcome union for executed,
failed, skipped, and needs-clarification results. Workflow and chat consumers
now branch on that outcome instead of inferring control flow from optional
fields, while fail-open failures and clarification short-circuit behavior stay
unchanged.

## 3) metadata-normalization

Branch: `chore/trust-boundary-metadata-domain-normalization`  
Status: `done`

This branch should make response metadata easier to reason about.

The metadata builder currently does several things at once: it classifies
provenance, normalizes execution reason codes, derives TRACE fields, logs missing
data, and fills defaults. That makes the function harder to test and harder to
audit.

Pull out pure helpers for the parts that are real domain decisions. For example:
given this execution status and reason code, what generation reason should be
recorded? Given this TRACE target and final value, should a finalization reason
be stored?

Do not change the meaning of provenance, TRACE, review labels, or cost fields in
this branch. Keep the same behavior and move each decision into a smaller typed
function.

Completed by extracting pure response-metadata decisions into a dedicated helper
module. Provenance input shaping, TRACE target/final normalization,
finalization-reason selection, retrieved chip derivation, and execution-event
construction now have named typed helpers. The metadata builder still owns
response ids, timestamps, structured logging, review-runtime summary wiring, and
the final public metadata shape. Behavior stayed unchanged, with regression tests
added for partial retrieved chip derivation and invalid TRACE axis normalization.

## 4) step-signal-typing

Branch: `chore/trust-boundary-step-signal-typing`  
Status: `todo`

This branch should reduce the places where workflow step data is stored as a
generic signal bag.

Signals are useful because they keep workflow records flexible, but some of them
have become important enough that they deserve names and types. Assess decisions,
routing-chain details, clarification signals, and receipt-facing values are good
places to look first.

Do this gradually. This is not a redesign of every workflow record. Type the
fields that readers and UI code already depend on, so future changes cannot
drift silently.

## 5) runtime-boundary-service-reduction

Branch: `chore/trust-boundary-runtime-boundary-service-reduction`  
Status: `todo`

This branch should reduce the stale `openaiService` naming and provider-specific
surface now that normal text generation runs through the selected
`GenerationRuntime` seam, currently VoltAgent.

Do not move Footnote metadata authority into VoltAgent. VoltAgent should provide
generation facts: text, model, usage, citations, retrieval facts, and optional
tool execution facts. Backend remains the authority for provenance, TRACE,
review, cost, trace storage, incident, and final response metadata semantics.

Prefer renaming and boundary cleanup over behavior changes:

- move response metadata assembly and decision helpers out of the
  `openaiService` namespace into a provider-neutral metadata module
- rename assistant/provider metadata input types so they no longer imply OpenAI
  ownership
- quarantine or remove the legacy direct `SimpleOpenAIService` adapter if it has
  no production caller
- deduplicate citation fallback normalization between the old OpenAI request
  path and the VoltAgent runtime path
- keep public contracts serializable and preserve existing response metadata
  output

This branch should not change the selected runtime behavior. It should make the
module layout match the architecture: runtime adapters execute generation;
backend-owned metadata builders interpret generation facts.
