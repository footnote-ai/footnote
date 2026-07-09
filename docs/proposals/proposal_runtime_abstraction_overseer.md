# Feature Proposal: Runtime Abstraction and Overseer Harness

**Last updated:** 2026-07-09

## Purpose

VoltAgent can remain Footnote's first runtime and the default path. Footnote
should still be able to use other runtimes over time without giving them the
authority to define what a trustworthy Footnote response means.

Footnote should own the contract around authority, provenance, review, and
final response construction. A runtime adapter should own the mechanics of
executing a task inside those bounds.

This is an exploratory plan. It does not replace VoltAgent or commit the repo
to a universal agent framework.

## Current baseline

The repo already has part of this split:

- `packages/agent-runtime` exposes a narrow `GenerationRuntime` seam for
  text generation.
- `createGenerationRuntime` currently creates the VoltAgent-backed adapter.
- `packages/backend` owns the public API, model routing, response metadata,
  cost recording, trace persistence, and the reviewed workflow path.
- `workflowEngine` owns transition checks, hard limits, review/revision
  execution, fail-open outcomes, and workflow termination reasons.

That is a useful starting point, but it is not yet an overseer contract. The
current text-generation seam does not ask a runtime to describe a whole
delegated run, its authority, or its structured events. Image and voice
runtimes are separate seams and should not be pulled into the first change.

## Three different layers

| Layer                  | Examples                                                   | Main question                                                    | Footnote boundary                                                              |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Model provider adapter | OpenAI, Ollama                                             | Which model or API produced text?                                | Provider selection and cost remain backend-governed.                           |
| Runtime adapter        | VoltAgent, future graph runtime, local agent service       | How was work planned, delegated, executed, and observed?         | It operates inside a bounded request and returns structured facts.             |
| Footnote overseer      | Backend workflow, policy, trace, review, response assembly | What was allowed, what happened, and what can be shown publicly? | It owns authority, acceptance, termination, provenance, and the final receipt. |

Runtime choice should be explicit. A provider adapter is not automatically a
runtime adapter, and a runtime should not silently take over provider, policy,
or trace decisions.

## Design boundary

Runtimes are useful execution engines, not blindly trusted control planes.
The overseer gives each run scoped authority and decides whether its result is
acceptable.

Footnote owns:

- the task contract and allowed context;
- tool, network, delegation, provider, budget, and retention permissions;
- model routing policy and cost authority;
- canonical trace and provenance semantics;
- review/revise policy, legal transitions, and stop conditions;
- final acceptance, public response metadata, and the receipt; and
- the decision to accept, retry, degrade, or reject an incomplete result.

A runtime adapter owns:

- declaring what it can do;
- accepting a bounded task request;
- executing only within the granted authority;
- reporting structured events, results, uncertainty, and failure;
- surfacing delegated work instead of hiding it; and
- preserving any native trace as a derived artifact when it is useful.

A runtime that cannot provide enough structured information can still be used
for a narrow generation task. It is not a candidate for a broader delegated
workflow until Footnote can reconstruct the externally meaningful actions.

## Minimal adapter direction

Do not force API names yet. The first adapter contract needs to carry:

- `RuntimeTask` says what work is requested and what evidence/context is
  available;
- `RuntimeAuthority` says what the runtime may do;
- `RuntimeEvent` reports meaningful steps in a normal form; and
- `RuntimeResult` returns a candidate result, uncertainty, native-artifact
  references, and a final event summary.

The first proof should wrap the current VoltAgent reviewed text path, emit a
bounded structured event list, and show that the response and canonical trace
shape stay the same. Do not add subagents, runtime selection, image, or voice
work to that branch.

## Authority model

Each request should carry explicit authority. The first contract can represent
the following permissions as a compact policy object instead of a loose bag of
runtime options.

| Authority            | Examples                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| Tools                | Named tools, allowed arguments, and call limits                                 |
| Context              | Which messages, evidence, files, and memory may be passed in                    |
| Models and providers | Eligible provider/model profiles and routing limits                             |
| Delegation           | Whether subagents are allowed, which roles they may have, and depth limits      |
| Network and search   | Whether external access is allowed and through which Footnote-owned seam        |
| Budget               | Token, time, step, tool-call, and cost limits                                   |
| Retention and export | Whether native artifacts may be kept, locally projected, or externally mirrored |
| Answer authority     | Whether the runtime may propose final text or only intermediate evidence        |

The runtime receives a narrower set of permissions than Footnote itself has.
For example, TrustGraph results remain bounded evidence inputs. They cannot
grant the runtime more authority, skip review, or mark a run complete.

## Trace and provenance

Every runtime-shaped execution must remain traceable in Footnote terms.

Footnote should map the events it accepts into the canonical workflow and
`ResponseMetadata` records. That lets the public trace describe consistent
facts across adapters: mode, steps, tool outcomes, review state, fallbacks,
model use, usage, cost, provenance inputs, and termination reason.

Runtime-native traces may be retained as derived local artifacts. The local
observability JSONL projection can include a safe reference to them, but it
must stay derived from Footnote-owned events. A public receipt does not need
to expose hidden reasoning or every internal detail. It does need enough
information to reconstruct externally meaningful actions and limits.

## Review and revise

The runtime can propose work. Footnote decides how that work is assessed.

1. Footnote gives the adapter a bounded task and records the run start.
2. The adapter returns a candidate result and structured events.
3. Footnote validates the result against authority, trace requirements, and
   the current workflow policy.
4. Footnote runs its review decision and may request a bounded revision.
5. Footnote enforces termination and surfaces an accepted, fail-open, or
   degraded result.

The existing workflow engine already owns much of this: transition legality,
hard limits, the assess/revise loop, and termination reasons. A future adapter
must not bypass those checks with a runtime-native terminal state.

## TrustGraph and local observability

TrustGraph remains a source of bounded evidence and, later, a possible graph
index over derived traces. It is not a runtime authority. When a runtime uses
TrustGraph-derived context, Footnote should record that lineage as a
provenance input.

Local observability makes adapter behavior comparable. A normalized JSONL
projection can show the same bounded run facts for VoltAgent and a future
runtime without promoting either runtime's native dashboard or trace format to
canonical status.

## Phased plan

1. Document the VoltAgent-specific assumptions in the current text path.
2. Separate runtime-shaped mechanics from Footnote policy, trace, review, and
   response-assembly code.
3. Define the smallest adapter contract that carries authority, events, and a
   result without changing public behavior.
4. Put VoltAgent behind that contract and prove existing reviewed-chat behavior
   is unchanged.
5. Add local observability events around adapter execution.
6. Select one second runtime as a design test, using the evaluation criteria.
7. Add comparison fixtures and tests for equivalent success, revision,
   incomplete-trace, and fail-open outcomes.
8. Consider exposing runtime choice only after the trace and review boundary is
   proven stable.

## Choosing a second runtime

Use the boundary, not a feature checklist, to choose the comparison target:

- open-source posture and local or offline support;
- a clean TypeScript or service boundary;
- structured events and tool-permission controls;
- failure and cancellation behavior;
- dependency weight and fit for the server-plus-local-nodes model; and
- how clearly Footnote can explain the run to a user or reviewer.

## Non-goals

- Replacing VoltAgent immediately.
- Building a universal agent framework from scratch.
- Letting each runtime choose its own public trace format.
- Making TrustGraph, Langfuse, or a runtime-native dashboard an authority.
- Adding a heavy dependency to the default local install without a clear need.
- Folding image and voice execution into the first text-runtime experiment.

## Open questions

- What is the smallest adapter contract that can wrap VoltAgent without
  distorting it?
- Which runtime should be the first comparison target?
- Which events are mandatory for auditability?
- Can a runtime produce final answer text, or should Footnote always assemble
  final responses?
- How much runtime-specific detail belongs in the public receipt versus
  developer observability?
- What should happen when a runtime succeeds but its trace is incomplete?

## Related code and docs

- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/src/voltagentRuntime.ts`
- `packages/backend/src/services/workflowEngine.ts`
- `packages/backend/src/services/chatService.ts`
- [Workflow](../architecture/workflow.md)
- [VoltAgent Runtime Adoption](../decisions/2026-03-voltagent-runtime-adoption.md)
- [TrustGraph](../architecture/context-integrations/trustgraph.md)
- [Local Observability With agent-inspect](./proposal_local_observability_agent_inspect.md)
