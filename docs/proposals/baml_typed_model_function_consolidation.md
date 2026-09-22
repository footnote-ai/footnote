# Feature Proposal: BAML for Typed Model-Function Consolidation

**Status:** Proposal
**Last Updated:** 2026-09-22

---

## Overview

This proposal asks whether BAML can make Footnote's typed model calls easier to
maintain. It is an experiment plan, not a decision to move production work to
BAML.

BAML is a tool for declaring an LLM function, its prompt, and its expected
typed output together, then generating TypeScript client code. That may remove
some duplicated contract plumbing, but it may also accept output that Footnote
currently rejects. The experiment must measure both sides.

Footnote should evaluate BAML as a **possible replacement and consolidation
layer for existing typed model-function machinery**, not merely as another
adapter behind the current abstractions.

The deeper architecture audit found that Footnote has already built many of the concepts BAML provides, but in fragmented form. Planner and assessment operations each maintain multiple representations of the same contract across prompt text, JSON Schema, Zod or allowlist validation, parsing, normalization, transport compatibility, and failure classification. Provider-specific structured-output behavior is also mixed into abstractions that appear more capability-driven than they really are.

The proposal is therefore not:

> Add BAML because Footnote needs typed outputs.

Footnote already has typed outputs.

The proposal is:

> Determine whether BAML can replace enough duplicated prompt/schema/parse machinery to make Footnote materially simpler and safer, while leaving Footnote-specific execution policy, cost authority, provenance, and workflow admission in Footnote.

One possible later outcome, if experiments succeed, is a **moderate
consolidation** of the typed-step cluster: planner, assess, and future
structured model functions declared in BAML; generation, routing policy, cost
accounting, workflow admission, and canonical trace remain backend-owned.

## In plain language

### The question

Today, one model output can be described in several places: the prompt, a JSON
schema, runtime validation, parsing and cleanup code, provider handling, and
failure classification. BAML may let Footnote describe some of that once and
generate part of the client. The experiment succeeds only if Footnote can then
delete enough duplicated code without losing important behavior.

### A concrete warning

Suppose a model returns:

```json
{ "tightness": 6 }
```

The TypeScript shape may say that `tightness` is a number, so a permissive BAML
parse can succeed. Footnote's current contract also checks the allowed range
and rejects this value. A successful BAML parse therefore does not prove that
the output is valid for Footnote. Footnote may still need a semantic validator
and its existing failure categories.

### What the experiment must answer

1. Which duplicated prompt, schema, parser, and adapter code can actually be
   removed?
2. Does BAML preserve distinctions Footnote uses, such as malformed JSON,
   refusal, incomplete output, unsupported transport, and provider failure?
3. Can Footnote keep its own retry, cost, cancellation, provenance, and
   operator-override behavior?
4. Does the smaller maintenance surface justify the new dependency and build
   step?

If BAML only adds a generated client while Footnote keeps nearly all of its
current validation and failure machinery, that is a useful negative result.

## Terms used in this proposal

- **Typed model function:** a model call with a declared input and output
  shape, rather than an unstructured text response.
- **Schema:** the rules describing which fields, types, and values are valid.
- **Failure taxonomy:** Footnote's distinctions between kinds of failure, such
  as malformed output, refusal, transport failure, and incomplete generation.
- **Generated client:** source code produced from the BAML declaration; it is
  still a build and dependency surface even though developers do not edit it
  by hand.
- **Footnote-owned semantics:** execution policy, retries, cost, cancellation,
  provenance, and workflow decisions that must remain understandable and
  controlled by Footnote.

This proposal is adjacent to, but independent from, [Semantic Judgment and
Context Resolution](./semantic_judgment_context_resolution.md). BAML is a
candidate declaration/parsing layer for typed generative functions; it is not a
required home for native semantic classifiers or a dependency of the judgment
runtime experiment.

---

## Current Problem

Footnote's current structured-model path is capable but duplicated.

### Planner

The planner contract is represented in several places, including:

- prompt text,
- hand-written JSON Schema,
- an allowlist/tree used to detect out-of-contract fields,
- schema adaptation logic,
- TypeScript normalization/application logic,
- provider-specific transport paths.

Relevant code includes:

- `packages/backend/src/services/typedModelOutput.ts`
- planner structured-output services,
- `chatPlannerOutputContract.ts`
- `plannerSchemaAdapter.ts`
- `chatPlannerDecisionContract.ts`
- `chatPlannerStructuredOpenAi.ts`
- `chatOrchestrator.ts`
- `@footnote/prompts`

The architecture audit found three parallel planner execution paths: direct OpenAI structured transport, the generic runtime structured-output path, and a text/JSON compatibility path.

### Assess

The assessment contract similarly exists across:

- prompt text,
- Zod schema,
- JSON Schema,
- parser logic,
- typed-output validation,
- routing/fallback handling,
- signal projection.

Relevant code includes:

- `workflowEngine/reviewDecision.ts`
- `workflowCore/reviewedChatWorkflow.ts`
- `typedModelOutput.ts`
- `@footnote/prompts`

The assessment path can combine routing-chain fallback with a transport-downgrade
loop inside a routing candidate, giving Footnote two nested recovery mechanisms
with different semantics. The prototype must measure that interaction rather
than assume BAML can replace either policy.

### Prompt registry

The prompt registry provides useful validation, shared prompt keys, and deployment overrides, but typed model prompts are separated from the schemas and parsers that define their meaning.

That separation makes prompt changes reviewable as text while making contract changes harder to review as one coherent unit.

---

## What The Audit Changed

The earlier BAML framing was too conservative. It assumed Footnote's current typed-output seam was the stable architecture and BAML should sit behind it.

The audit found reasons to challenge that assumption.

### `typedModelOutput.ts` is useful but not fully generic

It provides deterministic failure classification and bounded validation, but native-schema path selection is partly provider-identity-gated rather than purely capability-driven. It sits beneath several step-specific layers that reimplement similar prompt/schema/parse/fallback concerns.

### Contract definitions are duplicated

Changing one structured output safely can require coordinated edits across several representations. That is exactly the maintenance problem BAML's prompt/type co-location and generated clients are intended to address.

### Footnote has two kinds of abstraction mixed together

Some current code expresses **Footnote semantics**:

- workflow admission,
- declared outcomes,
- attempt bounds,
- model/profile policy,
- cost authority,
- fail-open behavior,
- canonical provenance.

Other code expresses **structured LLM plumbing**:

- prompt formatting,
- JSON Schema declaration,
- provider output mode selection,
- parsing,
- schema validation,
- repair/recovery,
- generated TypeScript result shape.

The proposal should protect the first group while being willing to replace the
second. Presentation is deliberately not treated as another typed contract in
the first experiment: the current candidate flow is prose generation plus
backend-owned presentation metadata, not a separate structured-output parser.

---

## Proposed Boundary

BAML should be evaluated as the declaration and parsing layer for **typed model functions**.

A useful conceptual split is:

```text
Footnote workflow/policy
        |
        v
Typed model-function boundary
        |
        +-- BAML function definition
        |      prompt
        |      input types
        |      output types
        |      tests/assertions
        |
        +-- Footnote-owned execution wrapper
               routing profile
               admission
               timeout/cancellation
               attempt provenance
               cost recording
               provider availability
        |
        v
BAML parse / generated typed result
        |
        v
Footnote canonical domain/result type
```

BAML may define and parse the model-mediated contract. It should not own whether the call was authorized, which fallback attempt is allowed, what the run may spend, or what becomes canonical provenance.

---

## Target Scope

### In scope

Evaluate BAML for:

- planner structured outputs,
- assess/review structured outputs,
- future structured model functions,
- prompt + schema co-location,
- generated TypeScript clients/types,
- parser/recovery behavior,
- model-function regression tests,
- exact prompt/request rendering during development,
- provider-specific structured-output compatibility where BAML can remove custom Footnote code.

### Explicitly out of scope initially

Do not move these responsibilities into BAML:

- normal prose `generate`,
- workflow topology,
- execution admission,
- routing-chain policy,
- provider availability policy,
- retry/fallback authority,
- cost authority,
- canonical `WorkflowRecord`/trace storage,
- deterministic safety/provenance evaluators,
- context integration execution,
- token-budget policy.

This exclusion is not based on conservatism. These are Footnote-specific semantics that BAML does not model.

---

## Why Not Use BAML's Retry/Fallback Layer

BAML offers convenient retry and fallback composition, but Footnote's routing behavior has stronger semantics:

- routing candidates are policy-selected,
- attempts are individually admitted,
- transient and non-transient failures have different consequences,
- generation provider availability can feed later routing, with behavior that is
  step-specific rather than universal,
- cost must be admitted before execution,
- every attempt belongs in canonical provenance.

A BAML fallback wrapper that silently moves from one client to another would either hide those facts or force Footnote to reconstruct them after the fact.

Therefore:

> BAML may describe the typed function. Footnote must remain the owner of attempt creation and provider/model resolution.

---

## Preferred Integration Mode

The most promising BAML mode for Footnote is the modular request/render and parse boundary rather than handing orchestration wholesale to BAML.

Conceptually:

```text
BAML function
    |
    v
render provider request
    |
    v
Footnote execution layer
    |
    +-- route model/profile
    +-- admit cost/authority
    +-- attach cancellation
    +-- execute attempt
    +-- record timing/provider/failure
    |
    v
raw model response
    |
    v
BAML parser
    |
    v
typed candidate
    |
    v
Footnote domain/result validation
```

This mode should be proven in a prototype rather than assumed to cover every provider detail Footnote currently handles.

---

## What BAML Could Replace

If the prototype validates the current BAML behavior, a moderate adoption could remove or substantially simplify:

### Planner

- hand-written planner JSON Schema,
- planner schema-adaptation logic,
- the separate out-of-contract allowlist tree,
- portions of parser/normalizer glue,
- provider-specific prompt instructions whose only job is to restate the structured schema.

### Assess

- duplicated Zod + JSON Schema definitions for the same review contract,
- prompt text that manually restates the same output shape,
- custom parser glue that BAML can replace with one generated typed function,
- portions of transport-specific structured-output handling if BAML proves more robust across the supported provider set.

### Prompt registry

Typed model-function prompt bodies may move out of generic YAML and into `.baml` definitions so prompt and output contract live together.

The prompt registry should not necessarily disappear. It still provides useful operator/deployment semantics such as validated override behavior and may remain the right home for:

- persona text,
- deployment-owned instructions,
- system text not coupled to a structured return type,
- configurable presentation wording,
- non-BAML generation prompts.

A successful BAML migration should reduce the prompt registry's responsibilities rather than replace it indiscriminately.

---

## What Should Remain Footnote-Owned

### Workflow engine

The serializable workflow engine enforces declared outcomes, attempt bounds, execution admission, and result validation. Those are stronger guarantees than a typed LLM client provides.

### Routing chains

`stepRoutingChains` / `stepRoutingExecutor` express model/profile policy rather than transport convenience. Preserve them unless a future architecture review independently replaces them.

### Cost authority

The backend must continue to decide whether a call is affordable before it is made and record actual usage afterward. BAML usage telemetry can inform the recorder; it cannot replace admission.

### Canonical provenance

`WorkflowRecord`, step/attempt records, and `traceStore` remain canonical. BAML Collector data, if used, is an instrumentation source or debugging aid.

### Deterministic evaluators

Cheap deterministic rules remain valuable precisely because they are deterministic and explainable. BAML does not replace them.

---

## BAML Collector and Raw Request Visibility

If the evaluated BAML toolchain can expose rendered requests, raw responses,
usage, and call metadata, that visibility could be useful because Footnote
currently has limited ability to inspect the exact provider request at runtime.

However, this feature intersects with Footnote's privacy posture.

Do not start persisting raw BAML prompts/responses simply because the Collector makes them available.

Possible policy:

- allow raw request/response inspection in local development and explicit evaluation harnesses,
- keep production canonical traces metadata-oriented by default,
- project only provider/model/timing/usage/failure details needed for audit,
- require a separate privacy/governance decision before retaining raw user/model content.

The existing trace remains authoritative regardless of whether a BAML collector
or equivalent instrumentation is enabled.

---

## Adoption Shapes

### A. Minimal prototype

Use BAML for one constrained typed operation, preferably `assess`.

Goals:

- port the existing `ReviewDecision` output contract,
- reuse current fixtures,
- compare parser/failure behavior,
- measure code removed versus code added,
- leave routing and execution untouched.

This is the required first step.

### B. Moderate typed-step consolidation

If the prototype is clearly beneficial, make BAML the normal declaration layer for structured model functions such as:

- planner,
- assess,
- future bounded structured judgments implemented by generative models.

Expected result:

```text
.baml source
  -> prompt + type + tests
  -> generated TS
  -> Footnote execution wrapper
  -> canonical Footnote result
```

This is the preferred target of the proposal.

### C. Aggressive BAML-centered model layer

A broader adoption could eventually move most prompt interpolation and structured model interactions into BAML.

This should not be planned now. It is justified only if the moderate migration demonstrates substantial maintenance benefit and the BAML toolchain proves stable enough for Footnote's supported providers.

Normal streamed/prose generation should remain outside this migration unless independently proven advantageous.

---

## First Prototype: Assess Contract

The assessment contract is the best initial falsifiable test because it is bounded, already structured, and lower-risk than the planner.

Prototype steps:

1. express the current `ReviewDecision` shape as one BAML function,
2. co-locate the prompt and output type,
3. port existing parser/schema fixtures into BAML parse/tests,
4. render requests without sending them and compare with current requests,
5. execute against representative supported providers,
6. map the typed BAML output back into the existing Footnote review result,
7. preserve the current routing chain and attempt provenance,
8. compare failure taxonomy with the current implementation.

The prototype should answer:

- Can BAML distinguish malformed output from structurally invalid output as well as Footnote needs?
- Does BAML make native/JSON/parser downgrade logic unnecessary, or merely hide it?
- Does it behave consistently across OpenAI, OpenRouter, and local/OpenAI-compatible paths?
- Does cancellation propagate correctly?
- Is the generated TypeScript ergonomic enough that application code becomes simpler?
- Can Footnote still record the actual resolved provider/model and attempt path exactly?

---

## Evaluation Criteria

Do not adopt BAML because the implementation looks cleaner in one file. Measure the replacement honestly.

### Complexity

Measure:

- production lines deleted/added,
- number of schema representations removed,
- number of prompt/contract files touched for a typical change,
- number of provider-specific branches removed,
- number of custom parser/repair functions removed.

### Correctness

Test:

- valid structured output,
- malformed JSON,
- valid JSON with wrong shape,
- missing required fields,
- extra fields,
- refusals,
- incomplete outputs,
- provider transport failures,
- models that only support compatibility parsing,
- schema differences across providers.

### Provider behavior

Run the same function through the provider/model families Footnote actually supports rather than relying on BAML's generic compatibility claims.

### Operability

Verify:

- exact rendered request visibility,
- cancellation,
- timeout behavior,
- build/codegen reproducibility,
- CI behavior,
- generated-file churn,
- version pinning,
- local development ergonomics.

### Provenance

Verify that BAML does not obscure:

- resolved model,
- provider,
- attempt identity,
- routing reason,
- fallback/downgrade path,
- usage/cost,
- failure class.

If BAML makes any of those materially harder to reconstruct, the integration boundary is wrong.

---

## Failure Classification

The current typed-output layer has some distinctions worth preserving and others worth improving.

A BAML migration should explicitly model at least:

```text
transport failure
provider refusal
incomplete model output
empty output
malformed syntax
schema-invalid structured value
application/domain-invalid value
```

The current review parser distinguishes empty output, non-object JSON, invalid
JSON, and schema-invalid JSON, while the shared typed-output layer also tracks
empty, malformed, refusal, incomplete, and runtime failure. Do not collapse
"not parseable" and "parseable but violates the contract" if BAML makes the
distinction available.

The goal is not merely to obtain a typed return value. It is to make failures more legible than they are today.

---

## Prompt Overrides

BAML prompt/type co-location conflicts somewhat with `PROMPT_CONFIG_PATH`-style runtime prompt replacement.

That is a real design question, not a reason to reject BAML automatically.

Before migrating planner or assess prompts, determine which override semantics Footnote actually needs:

- complete arbitrary replacement,
- deployment-specific prompt fragments,
- persona/system overlays,
- model-specific wording,
- emergency operator overrides.

Prefer keeping operator-owned policy/instruction overlays outside generated BAML source where practical.

Avoid re-creating the current split by moving the BAML prompt back into external YAML simply to preserve every existing override mechanism.

---

## Relationship to JEV / Judgment Runtime

JEV and BAML solve different problems.

BAML is a good candidate for **typed generative model functions**.

A native JEV/OpenJEV classifier should use a separate `JudgmentRuntime`, not be wrapped as a fake BAML text-generation function merely for architectural uniformity.

They may meet at the workflow level:

```text
plan                  -> BAML typed function
context relevance     -> JudgmentRuntime / JEV
retrieve               -> context integrations
assess style/revision  -> BAML typed function
faithfulness           -> JudgmentRuntime / JEV
```

A future bounded judgment implemented by an ordinary generative model may use BAML behind a `JudgmentRuntime` adapter, but native probability-producing classifiers should retain their native semantics.

---

## Architecture Debt This Work May Retire

A successful moderate migration should explicitly look for opportunities to remove rather than preserve:

- provider-identity checks masquerading as capability checks,
- parallel planner execution paths that exist only for structured-output compatibility,
- nested transport downgrade logic where BAML can own parsing/compatibility cleanly,
- duplicate JSON Schema/Zod/allowlist definitions,
- prompt text that manually restates machine-readable schemas,
- thin planner/parser wrappers whose responsibilities disappear after consolidation.

Do not bundle unrelated cleanup into the first prototype. Record deletion opportunities as follow-up issues once the replacement path is proven.

---

## Non-Goals

This proposal does not aim to:

- rewrite Footnote as a BAML application,
- adopt BAML's agent architecture,
- let BAML choose Footnote routing policy,
- let BAML own retries/fallbacks invisibly,
- replace canonical TRACE,
- replace backend cost admission,
- replace the workflow engine,
- migrate normal prose generation in the first phase,
- replace deterministic policy evaluators,
- force JEV/OpenJEV through BAML.

---

## Toolchain and Dependency Requirements

If adopted, Footnote should:

- pin the BAML package/toolchain version exactly,
- make code generation deterministic in CI,
- ensure generated code is reproducible across development platforms,
- document whether generated output is committed or produced during build,
- keep BAML source at a clear package boundary,
- prevent generated BAML types from becoming the canonical cross-package domain model,
- add a dependency-upgrade test checklist because BAML is evolving quickly.

The build should fail clearly if generated clients are stale or incompatible.

---

## Risks And Failure Modes

The main risks are replacement risks, not merely dependency size:

- BAML may add a second contract and compatibility layer without deleting the
  existing one;
- generated clients may obscure provider-specific failures or cancellation;
- parser normalization may collapse distinctions that current workflow lineage
  records separately;
- prompt/type co-location may accidentally remove operator override behavior;
- collector or debug output may retain sensitive prompts or model responses;
- a BAML retry/fallback abstraction may hide Footnote attempt, cost, or routing
  authority.

The first prototype must therefore be isolated, must not change production
behavior, and must fail open to the current implementation when its results are
unavailable or incomparable.

---

## Required Experiments Before Broader Adoption

### Experiment A: assess `Fn$parse` / typed-function prototype

Port the existing review-decision contract and its fixtures.

Compare current implementation with BAML on:

- source files touched,
- lines and conceptual layers,
- valid output handling,
- malformed output handling,
- schema-invalid output handling,
- provider refusal/incomplete output,
- transport downgrade requirements.

Success requires a meaningful simplification, not parity plus another toolchain.

### Experiment B: provider matrix

Execute the prototype against representative supported provider paths.

At minimum, cover:

- OpenAI native structured output,
- OpenRouter/OpenAI-compatible path,
- local/OpenAI-compatible or Ollama-backed path used by Footnote.

Record where BAML removes special cases and where provider-specific behavior remains.

### Experiment C: request/provenance comparison

Compare a current typed call with the BAML-backed equivalent and verify that Footnote can still reconstruct:

- the exact model/profile resolution,
- the rendered request when debugging is enabled,
- attempt/failure history,
- usage/cost,
- cancellation reason.

### Experiment D: planner migration dry run

Only after assess succeeds, port the planner contract on an isolated branch or harness and measure how much of the following can actually disappear:

- JSON Schema,
- allowlist tree,
- schema adapter,
- parser/normalizer glue,
- direct-provider structured path.

Do not merge the planner migration until its behavior matches the existing planner corpus and integration tests.

---

## Issue Decomposition

If the assess prototype is accepted, likely issues include:

1. **Prototype the assess contract as a BAML typed function**
2. **Build a provider-matrix regression suite for BAML structured output**
3. **Define Footnote's BAML execution wrapper and provenance boundary**
4. **Decide prompt-override semantics for BAML-owned typed functions**
5. **Consolidate planner contract definitions into BAML**
6. **Remove obsolete planner schema adapters and duplicate validators after migration**
7. **Consolidate typed-output failure taxonomy across BAML-backed steps**
8. **Document BAML codegen/version-pinning and CI policy**
9. **Audit remaining prompt-registry responsibilities after typed-step migration**
10. **Reassess whether `typedModelOutput.ts` still has a useful residual role**

The first issue should remain experimental. Later cleanup issues should not be created as guaranteed work until the prototype demonstrates a net benefit.

---

## Acceptance Criteria For Moderate Adoption

BAML should become the default typed-function declaration layer only if it demonstrates that:

- a structured contract has one clear source of truth,
- the current duplicate schema/prompt/parser layers are materially reduced,
- provider compatibility is at least as good as the current implementation,
- failure distinctions remain or improve,
- Footnote keeps ownership of routing, retries, cost, cancellation, and trace,
- code generation is reproducible and low-friction,
- prompt/test review is easier,
- the provider matrix remains supportable without accumulating a new BAML-specific compatibility layer,
- and the resulting codebase is simpler to change safely.

If BAML only relocates complexity into generated code, introduces a second routing/observability system, or requires Footnote to reconstruct hidden attempts, it should remain an experiment rather than a core dependency.

---

## Open Questions

- Can BAML's parser preserve the failure distinctions Footnote needs without custom post-processing?
- Should BAML-generated types map immediately into canonical Footnote types, or can some internal steps use generated types directly?
- How should existing `PROMPT_CONFIG_PATH` operator overrides interact with BAML source-controlled prompts?
- Can the direct OpenAI planner path be removed after BAML without losing behavior or latency?
- Which residual parts of `typedModelOutput.ts` remain useful for non-BAML generation results?
- Should generated BAML files be committed or generated in CI/build?
- What exact BAML version-upgrade policy is appropriate for a fast-moving dependency?
- Is BAML's request renderer sufficiently provider-faithful to let Footnote own transport without reimplementing provider adapters?

---

## Decision Posture

This proposal recommends a **falsifiable replacement experiment**, not unconditional adoption.

The architecture audit provides a concrete reason to test BAML: Footnote currently maintains multiple hand-written representations of the same structured model contracts and several provider-specific structured-output paths.

The proposed target is therefore intentionally asymmetric:

- let BAML compete aggressively with Footnote's duplicated typed-model plumbing,
- do not let it absorb Footnote's workflow, routing, cost, authority, or provenance semantics merely for uniformity.

If the assess and planner experiments show substantial deletion and better contract fidelity, a moderate BAML consolidation is justified. If they do not, Footnote should keep the current custom layer and use the audit findings to simplify it directly.
