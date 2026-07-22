# Feature Proposal: Execution Adapters and Workflow Authority

**Last updated:** 2026-07-10

## Purpose

VoltAgent can remain Footnote's first generation runtime and default path.
Footnote should still be able to delegate bounded work to VoltAgent or another
runtime without letting that runtime define policy, provenance, review, or what
counts as a completed Footnote response.

The backend workflow engine is already Footnote's execution authority. This
proposal strengthens the adapters beneath that engine. It does not introduce a
second overseer or move the reviewed workflow into a framework-owned control
plane.

This is an exploratory plan. It does not replace VoltAgent, change public API
shapes, or commit the repo to a universal agent framework.

## Current baseline

The repo already has the right top-level split:

- `packages/agent-runtime` exposes `GenerationRuntime`, a narrow seam for one
  text-generation attempt.
- `createGenerationRuntime` currently creates the VoltAgent-backed generation
  adapter.
- `packages/backend` owns the public API, Execution Contract, model routing,
  cost recording, response metadata, trace persistence, and review policy.
- `workflowEngine` owns transition checks, hard limits, review and revision,
  fail-open outcomes, workflow lineage, and termination reasons.

Keep `GenerationRuntime` narrow. It is an atomic execution seam used by the
backend workflow, not a contract for a whole delegated agent run. Image and
voice runtimes remain separate atomic seams.

A broader adapter should be introduced only when Footnote has a real task that
benefits from runtime-managed planning, tool use, or delegation.

## Canonical terms

Use existing Footnote terms for execution policy and W3C PROV-O terms where
they accurately describe provenance. PROV-O is a conceptual alignment and
export vocabulary; internal TypeScript types do not need to become RDF-shaped.

| Canonical term     | Meaning in Footnote                                                                | PROV-O alignment                                                              |
| ------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Execution Contract | The Footnote-owned rules and limits for a request                                  | Footnote-specific policy; PROV-O does not define authorization                |
| Workflow run       | One backend-governed execution of an accepted request                              | `prov:Activity`                                                               |
| Workflow step      | One bounded unit of work recorded in `StepRecord`                                  | Usually a related `prov:Activity`; `parentStepId` remains a Footnote relation |
| Entity             | An input, evidence item, plan, candidate result, final answer, or derived artifact | `prov:Entity`; use a more specific Footnote name in normal code               |
| Agent              | A person, organization, service, or software component bearing responsibility      | `prov:Agent`, including `prov:SoftwareAgent`                                  |
| Plan               | A recorded set of intended actions                                                 | `prov:Plan`, which is an Entity; a plan is not execution authority            |
| Association        | Responsibility of an Agent for an Activity, optionally in a role or under a plan   | `prov:wasAssociatedWith` or qualified `prov:Association`                      |
| Delegation         | A runtime Agent acts on behalf of Footnote for a specific delegated Activity       | `prov:actedOnBehalfOf` or qualified `prov:Delegation`                         |
| Usage              | An Activity consumes or consults an Entity                                         | `prov:used` or qualified `prov:Usage`                                         |
| Generation         | An Activity produces an Entity                                                     | `prov:wasGeneratedBy` or qualified `prov:Generation`                          |
| Derivation         | A new Entity depends on an earlier Entity                                          | `prov:wasDerivedFrom`; use `prov:wasRevisionOf` for a substantive revision    |
| Provenance bundle  | A named set of provenance descriptions                                             | `prov:Bundle`; a bundle describes a run but is not the run itself             |
| Execution report   | Adapter-reported facts about delegated execution                                   | A `prov:Entity`; its claims remain attributed until Footnote validates them   |
| Receipt            | Footnote's compact public summary of accepted run facts                            | May be a `prov:Entity`; it is not a replacement for the provenance bundle     |

Use PROV-O names in documentation and export mappings when they add precision.
Prefer concrete product names such as `candidateAnswer`, `evidenceItem`, and
`workflowStep` in application code instead of generic names such as `Entity`.

Do not use `Agent` as a synonym for model provider, model profile, runtime
framework, or adapter. Those components may be represented as Agents in a
provenance export only when the record is specifically assigning
responsibility.

## Execution layers

| Layer                       | Examples                                             | Responsibility                                                                   |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Provider adapter            | OpenAI, Ollama                                       | Performs a provider-specific model call selected by backend routing              |
| Atomic execution adapter    | `GenerationRuntime`, image runtime, voice runtime    | Performs one bounded operation and returns normalized results                    |
| Delegated execution adapter | VoltAgent agent, future graph runtime, local service | Performs one bounded delegated Activity using only injected capabilities         |
| Backend workflow engine     | Execution Contract, workflow, review, trace          | Owns permission, legal transitions, acceptance, termination, and canonical facts |

A delegated execution adapter is a sibling of `GenerationRuntime`, not an
expanded replacement for it. The backend may use both during one workflow run.
Runtime choice stays internal and explicit.

## Authority and responsibility

Permission and provenance answer different questions:

- The Execution Contract says what may happen.
- Workflow records say what Footnote observed happening.
- PROV-aligned relationships say what inputs, outputs, activities, and
  responsible agents formed the result.

The backend grants capabilities by construction. It should inject only the
approved tools, provider clients, context, storage handles, and network seams.
A policy object passed to an unrestricted runtime is documentation, not
enforcement.

The Execution Contract can bound:

- named tools, argument constraints, and call limits;
- messages, evidence, files, and memory available as input Entities;
- eligible provider and model profiles;
- whether delegation is allowed, including roles and depth;
- network access through Footnote-owned seams;
- token, time, step, tool-call, and cost limits;
- retention and export of runtime-native artifacts; and
- whether the adapter may produce a candidate answer or only intermediate
  evidence.

PROV-O delegation records responsibility after execution. They do not grant
permission. When a runtime acts on Footnote's behalf, Footnote retains
responsibility for the authority it granted and for the result it accepts.

## Delegated execution boundary

Do not force final API names before there is a concrete delegated task. The
smallest future contract should carry four concepts:

- a delegated task describing the requested Activity and available input
  Entities;
- a bounded capability grant derived from the Execution Contract;
- an execution report containing candidate outputs, failures, uncertainty,
  and runtime-reported provenance facts; and
- cancellation plus a bounded completion status.

The adapter may report internal activities and entities. Footnote remains the
author of boundary facts it can observe directly, including:

- which adapter was invoked;
- which capabilities and limits were granted;
- which input references crossed the boundary;
- when execution started, ended, failed, or was cancelled;
- which output references returned; and
- whether the report satisfied Footnote's acceptance requirements.

Runtime-reported events are attributed claims until validated. They must not be
copied into canonical `StepRecord` or `ResponseMetadata` fields as though
Footnote observed them directly.

## Review, acceptance, and incomplete reports

The runtime proposes work. Footnote decides what it can accept.

1. The backend resolves the Execution Contract and records the workflow start.
2. The workflow engine invokes an atomic or delegated adapter with bounded
   capabilities.
3. The adapter returns a candidate result and execution report.
4. Footnote validates the result, report, and granted-authority boundary.
5. The workflow engine performs any required review or bounded revision.
6. Footnote records termination and returns an accepted, degraded, or
   no-generation outcome.

The existing workflow engine remains the source of transition legality,
review policy, hard limits, and termination reasons. A runtime-native
`completed` state is evidence about adapter execution, not authority to mark
the Footnote workflow complete.

Use this fail-open rule when a runtime succeeds but its report is incomplete:

- A safe candidate answer may still be returned with degraded or incomplete
  trace status.
- Footnote must not claim that unverified runtime actions are canonical facts.
- An external side effect without adequate confirmation is not recorded as a
  successful audited action.
- Missing runtime detail never grants more authority or skips required review.

## Trace and PROV-O mapping

Footnote continues to store its current `WorkflowRecord`, `StepRecord`, and
`ResponseMetadata` shapes. A later provenance projection may express accepted
facts using a small PROV-O profile:

- the workflow run and meaningful steps as Activities;
- prompts, evidence, plans, candidates, revisions, and final outputs as
  Entities;
- the Footnote backend and delegated runtime as SoftwareAgents when
  responsibility matters;
- `used` and `wasGeneratedBy` for input and output lineage;
- `wasDerivedFrom` and `wasRevisionOf` for candidate and revision lineage;
- association for the Agent responsible for an Activity; and
- delegation when a runtime acted on behalf of Footnote.

Do not infer `prov:wasInformedBy` from timestamps alone. Do not expose hidden
reasoning, raw prompts, tool bodies, or sensitive context merely to make the
PROV graph more detailed. A smaller truthful graph is better than a complete-
looking speculative one.

Runtime-native traces may be retained as derived local artifacts. The local
observability projection may reference them safely, but it remains derived
from Footnote-owned records and attributed runtime reports.

## TrustGraph and local observability

TrustGraph remains a source of bounded evidence and, later, a possible index
over derived provenance. It has no policy or terminal authority. If a
provenance export represents it as a SoftwareAgent, that only assigns
responsibility for its evidence production. When TrustGraph-derived context is
used, the workflow records the relevant input Entity and Usage relationship.

Local observability makes adapter behavior comparable. It should project
canonical Footnote facts and clearly attributed runtime reports. It must not
promote a runtime dashboard or native event format into the public provenance
contract.

## Phased plan

1. Document VoltAgent-specific assumptions in the current atomic text path.
2. Keep `GenerationRuntime` narrow and separate framework mechanics from
   backend policy, trace, review, and response assembly.
3. Choose one concrete delegated task. If no task needs runtime-managed
   planning, tools, or delegation, stop here.
4. Define the smallest sibling delegated-execution contract and prove it first
   with a fake adapter and contract tests.
5. Add a VoltAgent delegated adapter without moving the reviewed workflow out
   of the backend engine.
6. Record boundary-observed facts and validated runtime reports using existing
   workflow records and the small PROV-O mapping above.
7. Add local observability projection after the canonical records are stable.
8. Evaluate a second real runtime only when it offers a concrete capability or
   deployment benefit.
9. Consider exposing runtime choice only after equivalent acceptance,
   cancellation, incomplete-report, and fail-open behavior is proven.

## Evaluation criteria for another runtime

Use the boundary and a real use case, not feature count alone:

- open-source posture and local or offline support;
- a clean TypeScript or service boundary;
- capability injection and tool controls;
- structured, attributable execution reports;
- failure, timeout, and cancellation behavior;
- dependency weight and fit for the server-plus-local-nodes model; and
- how clearly Footnote can explain the run to a user or reviewer.

## Non-goals

- Replacing VoltAgent immediately.
- Expanding `GenerationRuntime` into a universal agent interface.
- Creating a second overseer beside the backend workflow engine.
- Moving review, acceptance, or termination authority into VoltAgent.
- Treating PROV-O as an authorization model or requiring RDF internally.
- Letting each runtime choose its own public trace format.
- Making TrustGraph, Langfuse, or a runtime-native dashboard authoritative.
- Adding subagents, image, or voice work to the first delegated-execution slice.

## Decisions still needed before implementation

- Which concrete task is the first delegated Activity?
- Which adapter-reported facts are required for that task?
- Which facts can Footnote observe or independently validate?
- What is the smallest capability grant needed for that task?
- Which PROV-aligned facts belong in the public receipt, developer trace, or
  derived provenance bundle?

## Standards and related code

- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/)
- [PROV-DM: The PROV Data Model](https://www.w3.org/TR/prov-dm/)
- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/src/voltagentRuntime.ts`
- `packages/backend/src/services/executionContract.ts`
- `packages/backend/src/services/workflowEngine.ts`
- `packages/backend/src/services/chatService.ts`
- [Workflow](../architecture/workflow.md)
- [VoltAgent Runtime Adoption](../decisions/2026-03-voltagent-runtime-adoption.md)
- [TrustGraph](../architecture/context-integrations/trustgraph.md)
- [Rejected: Local Observability With agent-inspect](./rejected/local_observability_agent_inspect.md)
