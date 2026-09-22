# Feature Proposal: Semantic Judgment and Context Resolution

**Status:** Proposal
**Last Updated:** 2026-09-22

---

## Overview

This proposal asks whether Footnote needs a separate way to answer small,
bounded questions about context. It is an experiment plan, not a decision to
add a new runtime or to run JEV in production.

JEV-style models are the motivating implementation family. They may be useful
for comparing text, but simpler methods may be good enough. The benchmark must
decide that question.

The first problem this proposal should address is **conversation context resolution**.

Footnote currently selects Discord conversation context primarily by recency. A flat recent-message window is cheap and predictable, but it cannot distinguish the active sub-conversation from unrelated room chatter, recover old-but-relevant messages, recursively follow conversational prerequisites, or decide which attachments and metadata deserve deeper inspection. The deeper architecture audit found this to be a concrete weakness rather than a speculative feature gap.

One possible later design is to treat context selection as a bounded set of
conversation links, rather than as a permanent database-wide graph:

```text
trigger
   |
   v
deterministic candidate graph
   |
   v
cheap semantic judgments
   |
   +-- include relevant nodes
   +-- expand promising branches
   +-- stop irrelevant branches
   |
   v
bounded context pack
   |
   v
generator
```

JEV is one possible semantic assessor inside that process. It does not own the context graph, policy, authority, or final model input.

The short version is: first measure whether a small semantic model solves hard
context cases that text search and simple conversation links cannot solve. Only
if the measurements justify it should Footnote consider a first-class judgment
runtime.

This proposal is adjacent to, but independent from, [BAML for typed
model-function consolidation](./baml_typed_model_function_consolidation.md).
BAML may help declare typed generative functions; it is not a prerequisite for
this judgment-runtime experiment, and a native classifier should not be forced
through BAML for uniformity.

## In plain language

### The problem

Footnote usually gives the model a recent block of Discord messages. That is
predictable, but the block can miss an older message that explains “that one,”
or include many unrelated messages from another conversation.

### A small example

```text
10:01 Alex: I prefer the smaller local model.
10:02 Sam: What about the 35B one?
10:03 Alex: Probably too large for my GPU.
...
11:20 Jordan: What model did Alex say was too large?
```

The current recent window might no longer contain the 10:03 message. Text
search may find it when words overlap. Reply and same-thread links may add
supporting messages. A JEV-style model might help when the question uses very
different wording, but that is only a hypothesis until tested.

### What the experiment must answer

1. Do simple methods find the messages an answer needs?
2. Do they select too much unrelated context?
3. Does a small semantic model improve difficult cases enough to justify its
   setup, latency, privacy review, and hardware cost?

### What this proposal does not decide

It does not decide whether JEV should run in the bot, whether private content
may leave a deployment, or whether a judgment may block an action. Initial
judgments are evidence only: they must fail open and must not become policy
authority by accident.

## Terms used in this proposal

- **Recall:** of all messages an answer needed, how many the selector found.
- **Precision:** of the messages selected, how many were useful.
- **BM25:** a traditional text-search ranking method that works well when the
  query and message share words or phrases.
- **JEV-style model:** a small model that compares text and estimates bounded
  relationships such as supports, contradicts, or unrelated.
- **Context pack:** the bounded set of messages and other evidence sent to the
  generator for one turn.
- **Judgment runtime:** a possible future Footnote boundary for bounded
  comparisons; it is not being implemented by this proposal.

---

## Motivation

### The current context-selection problem

The current Discord path is simple and mostly recency-based:

- Discord request construction collects a replied-to message plus a recent history window.
- Backend normalization trims conversation history to a bounded recent set.
- The planner initially sees only a small tail and may request a larger recent window or digest.
- There is no semantic relevance pass over room history.
- Reply traversal is shallow.
- Topic switches and multiple simultaneous conversations share the same flat window.
- Old-but-relevant messages are not recovered by meaning.
- Attachments already cross the request boundary as bounded URL/kind/content-type
  metadata, and backend integrations can scan or reverse-search selected
  attachments. They are not yet represented as a general progressively
  resolvable context graph, so selection and deeper inspection remain separate
  concerns.

Relevant current code includes:

- `packages/discord-bot/.../MessageProcessor.ts`
- `packages/backend/.../conversationContextService.ts`
- `packages/backend/.../chatPlanner.ts`
- `packages/backend/.../workflowEngine/modelInput.ts`
- `packages/backend/.../contextIntegrations/`

The exact paths should be revalidated when implementation begins, but the
important architectural fact is stable: **Footnote currently chooses
conversational context mainly by location in the recent transcript rather than
by semantic need.** Discord first fetches a bounded recent history plus the
directly replied-to message when available; backend normalization then keeps up
to 24 non-system Discord messages. It does not recursively traverse reply
ancestry or run a semantic relevance pass over the available history.

That creates several recurring failure modes:

- unrelated multi-user chatter enters the prompt,
- older required context is silently lost,
- pronouns and references may lack their prerequisites,
- one-level reply context can omit the message that made the replied-to message meaningful,
- multiple simultaneous topics are mixed,
- attachment metadata, file scanning, and image-related context steps exist, but
  there is no general relevance-driven expansion policy across attachment,
  document, and canonical-artifact nodes,
- metadata has no principled inclusion rule,
- larger fixed windows trade missing context for more distraction and cost.

### The broader context problem

The same selection problem applies to more than messages.

Potential context objects include:

- messages,
- reply and quote relationships,
- authorship and role metadata,
- thread membership,
- Discord embeds,
- reactions,
- URLs and link previews,
- attached images,
- attached documents,
- document pages and chunks,
- OCR or extracted text,
- Footnote-generated response images,
- canonical Footnote response and trace records behind those images,
- conversation segments or summaries,
- retrieved external evidence.

The useful question is therefore not simply:

> Which recent messages should the bot see?

It is:

> What information is necessary to understand this turn, and what is the cheapest trustworthy path to obtain it?

That is a reusable backend capability rather than a Discord-only heuristic.

---

## Why JEV-Style Models Fit

JEV-style models produce bounded semantic classifications rather than free-form generations. OpenJEV-style NLI models naturally support questions such as:

- does this earlier message contain context relevant to the trigger,
- does this candidate provide a prerequisite for another selected message,
- does this passage support or contradict this claim,
- is this attachment likely to matter,
- does this candidate deserve deeper inspection,
- does this generated claim remain faithful to the supplied evidence.

The motivating OpenJEV candidate appears to offer batching/reranking primitives,
but the benchmark must verify the actual version and deployment behavior rather
than make those capabilities an architectural assumption. A context resolver
may need to score tens of candidates at a time rather than invoke a
general-purpose language model once per candidate.

This proposal does **not** assume JEV is superior to embeddings, deterministic graph traversal, cross-encoders, or a small generative model for every task. The first milestones are benchmarks intended to determine where the semantic classifier actually adds value.

---

## A New Operation Type

Semantic judgment should not be forced through `GenerationRuntime`.

Footnote's current generation seam is shaped around generative requests and textual/model outputs. A JEV-style call is different:

- premise/hypothesis or state/options rather than a normal generation prompt,
- potentially many candidates in one batch,
- probability/logit vectors rather than completion text,
- no meaningful completion-token concept,
- different capability and context-window requirements,
- different privacy and routing considerations.

Encoding a classification request as prompt text and then parsing probabilities from generated prose would reproduce the abstraction leakage this proposal is intended to avoid.

A separate boundary should therefore be evaluated, for example:

```ts
interface JudgmentRuntime {
    assess(
        request: JudgmentRequest,
        options?: JudgmentExecutionOptions
    ): Promise<JudgmentResult>;
}
```

The exact name is not important. The separation of operation types is.

---

## Judgment Capabilities

Do not stretch the existing generation-shaped capability fields to represent judgment models.

A judgment implementation may need to declare:

```ts
type JudgmentCapabilities = {
    primitives: Array<
        | 'entailment'
        | 'contradiction'
        | 'neutral'
        | 'choice'
        | 'score'
        | 'rerank'
        | 'grade'
    >;

    context: {
        maxInputTokens: number;
        maxSharedStateTokens?: number;
    };

    batching: {
        supported: boolean;
        maxCandidates?: number;
        sharedPrefix?: boolean;
    };

    modalities: {
        text: boolean;
        image: boolean;
    };

    execution: 'local' | 'remote' | 'either';
};
```

The capability description should preserve real differences between providers. A native NLI model should not be made to pretend it implements a hosted provider's higher-level `Score` primitive unless an explicit, evaluated adapter provides that translation.

---

## Context Graph

The existing `ContextStepResult` abstraction is oriented around flat external retrieval results. It should not be overloaded into a general conversation graph merely because it already contains the word "context."

The proposed resolver should have its own internal representation.

Illustrative node kinds:

```ts
type ContextNodeKind =
    | 'message'
    | 'conversation_segment'
    | 'attachment'
    | 'document'
    | 'document_page'
    | 'document_chunk'
    | 'image'
    | 'embed'
    | 'url'
    | 'footnote_response'
    | 'footnote_trace'
    | 'metadata';
```

Illustrative deterministic edges:

```text
reply-to
quoted-from
adjacent-to
same-thread
same-author-sequence
mentions
attachment-of
embed-of
canonical-artifact-of
document-parent
document-child
retrieval-hit
semantic-neighbor
```

Most deterministic conversation relationships already exist in the data Footnote receives, even if they are not currently modeled as a graph. Semantic relations such as relevance, prerequisite context, and branch expansion are the missing part.

The graph does not need to become a globally persisted knowledge graph. A bounded per-turn resolution graph is sufficient for the first implementation.

---

## Progressive Resolution

Context should be inspected progressively rather than expanded eagerly.

For example:

```text
message
  |
  +-- attachment metadata
          |
          +-- extracted document metadata
                  |
                  +-- relevant pages/chunks
                          |
                          +-- image/vision inspection
```

A PDF should not be parsed, OCRed, chunked, and sent through vision merely because it is attached to a nearby message.

A cheap first-stage representation might contain:

- filename,
- MIME type,
- size,
- page count if cheaply available,
- parent message text,
- attachment relationship,
- a trusted canonical identifier if one exists.

Only if the resolver decides that the attachment is likely relevant should
Footnote pay for deeper extraction. Existing file-scanning and reverse-image
context steps are candidate integration seams, not evidence that this policy is
already implemented end to end.

This principle should also apply to Footnote's own artifacts. If a Discord image
can be resolved to the canonical Footnote response or trace that generated it,
the canonical structured artifact should normally be preferred over OCR or
vision-processing Footnote's own rendered image. The current Discord image
follow-up path already has response/input identifiers and trace-backed recovery
for that narrower case; the future resolver must not assume every attachment
has the same linkage.

---

## Candidate Resolution Flow

A first context-resolution implementation could follow this shape:

```text
trigger
   |
   v
seed deterministic candidates
   |
   +-- reply ancestry
   +-- nearby messages
   +-- thread relationships
   +-- mentions / quotes
   +-- cheap lexical/vector history lookup
   |
   v
candidate frontier
   |
   v
batch semantic assessment
   |
   +-- retain
   +-- expand
   +-- reject
   |
   v
repeat under search/token/cost budget
   |
   v
ContextResolutionResult
   |
   v
model-input projection
```

A resolver should use deterministic relationships whenever they are sufficient. JEV should be invoked where semantic ambiguity actually exists.

Potential stopping conditions include:

- no qualifying frontier nodes remain,
- maximum graph depth,
- candidate limit,
- context token budget,
- judgment cost/latency budget,
- branch score below a threshold,
- enough high-confidence context has already been selected.

Thresholds should be calibrated from Footnote data rather than copied from model examples.

---

## Batching

Batching is a first-class requirement, not a later optimization.

The motivating OpenJEV implementation is expected to support
multi-hypothesis/reranking execution with shared-prefix reuse, but the benchmark
must verify those details for the pinned candidate. This maps naturally onto
evaluating many candidate messages against one trigger or selected context
state.

The initial benchmark should test at least:

- 10 candidates,
- 40 candidates,
- 80 candidates,

using realistic message lengths on the target <=16 GB local GPU deployment.

The resolver should be able to chunk larger frontiers into bounded batches rather than assuming every candidate can be evaluated in one request.

Do not encode a fixed production batch size into the architecture until measurements exist.

---

## Local and Cloud Roles

Local and hosted judgment models should be treated as different execution tiers, not separate product features.

A small local model is attractive for high-frequency inner-loop work:

- message relevance,
- recursive expansion,
- attachment relevance,
- claim-to-passage entailment,
- faithfulness checks.

A larger or hosted model may be useful when the judgment needs to see substantially more context at once:

- whole-response evidence audit,
- cross-source contradiction over a larger evidence package,
- long conversation-segment comparison,
- escalation after local judgments disagree or remain uncertain.

The routing principle should be:

> Use the smallest adequately evaluated judgment implementation that can see the evidence necessary to answer the bounded question.

The <=16 GB GPU target is therefore a **benchmark gate**, not an architectural promise. The first implementation should measure coexistence of a small local assessor with Footnote's current local generator profiles before enabling an always-resident sidecar by default.

---

## Privacy and Data Policy

This proposal exposes a missing general policy mechanism: Footnote currently has provider/model routing, but not a sufficiently explicit per-request rule saying that particular content may not leave the deployment.

Judgment routing should therefore carry a data-policy constraint, for example:

```ts
type JudgmentDataPolicy = {
    remoteAllowed: boolean;
    rawConversationAllowed?: boolean;
    rawAttachmentAllowed?: boolean;
    sensitivity?: 'public' | 'private' | 'restricted';
};
```

Exact vocabulary should align with existing Footnote privacy/governance concepts rather than invent a disconnected taxonomy.

A remote model must never be selected merely because it is higher quality when the request's data policy forbids remote execution.

This constraint is especially important for:

- private Discord rooms,
- direct messages,
- arbitrary user attachments,
- project documents,
- unpublished conversation history.

---

## Authority

A semantic assessment is evidence about a bounded question. It is not authority.

The first implementation should be **observe-only** in behavioral terms.

That means:

- record the result,
- use it for benchmark/evaluation output,
- do not alter the final answer solely because of it,
- do not authorize tools or actions,
- do not bypass retrieval or safety policy,
- do not convert model confidence into policy confidence.

The existing `EvaluatorAuthorityLevel` vocabulary (`observe | influence | enforce`) should not be reused casually. The architecture audit found that `observe` versus `influence` is currently largely declarative. Before JEV findings use those labels, the semantics should become real:

```text
observe
  -> trace/evaluation only

influence
  -> may set a bounded signal consumed by explicit Footnote policy

enforce
  -> may change execution only where an explicit policy grants that authority
```

If Footnote cannot enforce those distinctions behaviorally, the JEV result should use a simpler explicit `advisory` status rather than imply authority it does not have.

---

## Provenance and Storage

The existing workflow lineage shape is useful, but its current primitive-only
`StepSignals` representation is not suitable for storing dozens of probability
vectors.

A context-resolution turn might inspect 80 candidates while only selecting 9. Recording 80 full inputs and distributions directly into the normal response metadata would create avoidable storage and privacy pressure.

The proposal therefore requires three distinct projections:

### 1. Canonical assessment detail

Machine-reviewable details needed to reconstruct the assessment, potentially stored outside the ordinary flat `StepSignals` record:

- candidate/context identity,
- input hash or stable reference,
- model/provider/revision,
- judgment primitive,
- native/normalized probabilities where retained,
- selected/rejected/expanded outcome,
- parent/edge relationship,
- timing/batch identity.

Raw message or attachment text should not be duplicated into judgment provenance by default. Store stable identifiers or hashes where the original content is already retained under another lifecycle.

### 2. Workflow finding

A compact summary attached to the normal workflow step, for example:

```text
context_resolution
  candidates_considered: 80
  selected: 9
  branches_expanded: 2
  deepest_branch: 3
  assessor: openjev-0.8b
  duration_ms: 143
```

### 3. Public TRACE projection

A deliberately small, privacy-safe explanation, for example:

> Footnote searched earlier conversation context and selected 9 messages that appeared relevant to this turn.

Public TRACE should not expose rejected private messages, raw candidate text, or probability dumps merely because the canonical backend retained them.

The repository does not currently document a canonical 256 KiB response-metadata
limit. Storage, transport, and retention constraints should be measured before
a detailed assessment schema is finalized; do not turn an assumed platform
limit into a contract.

---

## Relationship to Existing Evaluators

Do not place JEV inside the existing general-purpose `assess` prompt.

The current assess operation mixes several concerns such as revision, style, TRACE alignment, evidence caution, and routing hints. It does not currently perform factual entailment or faithfulness verification.

Semantic judgment should instead be a reusable operation that can appear in several places:

```text
before generation
  context resolution / candidate pruning

after retrieval
  claim/evidence or conflict assessment

after generation
  faithfulness / response audit
```

The existing evaluator lineage pattern may be useful for projecting summary findings, but the detailed data contract will likely need extension for batched assessments.

---

## Initial Use-Case Priority

### 1. Conversation context resolution

Highest priority because Footnote has a demonstrated failure mode today.

Evaluate:

- message relevance,
- recursive branch expansion,
- old-but-relevant recovery,
- multi-user noise rejection,
- topic-switch handling.

### 2. Attachment and metadata selection

Build on the same context graph rather than introducing an unrelated attachment subsystem.

Evaluate whether the resolver can determine:

- whether an attachment matters,
- whether metadata alone is sufficient,
- whether a document needs parsing,
- whether an image needs vision inspection,
- whether a Footnote-generated artifact should resolve to canonical structured data.

### 3. Claim/evidence faithfulness

Use bounded post-generation checks to compare generated claims with evidence actually supplied to generation.

This is a strong native NLI use case and provides another measurable benchmark without immediately affecting answers.

### 4. Whole-response / long-context audit

Optional escalation using a higher-context local or hosted judgment provider when a response contains a large evidence package, conflicting sources, or many factual claims.

### 5. Citation support checking

Useful, but should follow the context-resolution work rather than define the first implementation milestone.

### 6. Retrieval reranking

Treat as an experiment, not a presumed replacement. TrustGraph already performs reranking; JEV may offer a different cost/quality profile but this is not the capability gap that justifies the architecture.

---

## Non-Goals

This proposal does not initially aim to:

- replace TrustGraph,
- replace deterministic safety evaluators,
- make JEV an authorization system,
- let semantic confidence directly grant tool authority,
- replace the main planner,
- replace all embedding/BM25 retrieval,
- persist a global conversation knowledge graph,
- ingest every attachment eagerly,
- send private context to cloud models by default,
- make every public TRACE expose internal classifier output.

---

## Risks And Failure Modes

The main risks are architectural and governance risks, not only model quality:

- semantic false positives can add distracting or private context;
- semantic false negatives can silently remove prerequisites needed to answer;
- local judgment may contend with the configured generator or create latency
  spikes;
- cloud escalation can violate locality expectations unless data policy is
  checked before routing;
- detailed candidate records can duplicate sensitive conversation content;
- an `observe` result can become de facto authority if consumers read it as a
  policy decision.

The first experiments must therefore remain fail-open and observe-only. A
failed, unavailable, or uncertain judgment must not remove the current
deterministic context path or authorize an action.

---

## Required Experiments Before Implementation Commitment

### Experiment A: context-selection benchmark

Build a consented, sanitized, or representative human-labeled corpus targeting
approximately 100 Discord-trigger turns. Do not make production conversation
retention a prerequisite for the benchmark.

For each turn, label the messages required to answer well.

Compare:

1. current recent-window behavior,
2. deterministic reply/adjacency graph only,
3. embedding or cross-encoder candidate ranking,
4. OpenJEV 0.8B candidate assessment,
5. hybrid deterministic + JEV expansion.

Measure:

- relevant-message recall,
- distracting-message precision,
- final context token count,
- search latency,
- number of classifier evaluations,
- answer-quality delta on a blinded subset.

The context-graph implementation should not proceed as a large refactor unless the semantic approach materially improves this benchmark.

### Experiment B: local batching benchmark

On the target <=16 GB GPU box, measure realistic 10/40/80-candidate batches while a normal local generator profile is also available.

Record:

- VRAM,
- p50/p95 latency,
- throughput,
- CPU fallback behavior,
- model load/unload cost,
- contention with the generator.

### Experiment C: runtime seam probe

Implement a minimal experimental `JudgmentRuntime` and compare it with forcing the same operation through `GenerationRuntime`.

Evaluate:

- type fidelity,
- batching,
- telemetry,
- cancellation,
- model identity/revision,
- cost accounting,
- failure semantics.

### Experiment D: provenance-size simulation

Simulate realistic per-candidate records and confirm what can fit safely under current trace storage/retention constraints.

Use the result to choose between:

- a bounded assessment table,
- a response-metadata section,
- hashes/references only,
- aggregate-only retention for rejected candidates.

---

## Likely Implementation Shape If Experiments Pass

A plausible sequence is:

1. define `JudgmentRuntime` and `JudgmentCapabilities`,
2. add one experimental OpenJEV adapter,
3. add benchmark-only context candidate scoring,
4. define `ContextResolutionResult`,
5. build deterministic conversation graph seeds,
6. add bounded semantic branch expansion,
7. project only the selected context into `buildModelInput`,
8. add privacy/locality routing constraints,
9. add compact workflow and TRACE summaries,
10. keep judgment results observational until benchmark thresholds and governance rules are approved.

Cloud/long-context judgment should be a later adapter using the same runtime, not a separate architecture.

---

## Issue Decomposition

If this proposal is accepted for experimentation, likely issues include:

1. **Benchmark semantic context selection against Footnote's current Discord history window**
2. **Benchmark OpenJEV 0.8B batching and generator coexistence on <=16 GB VRAM**
3. **Define a provider-neutral `JudgmentRuntime` and capability contract**
4. **Define privacy/locality constraints for judgment routing**
5. **Define bounded context-resolution and assessment provenance contracts**
6. **Prototype a deterministic conversation context graph**
7. **Prototype JEV-assisted message relevance and recursive expansion**
8. **Extend context resolution to Discord attachments and canonical Footnote artifacts**
9. **Evaluate claim/evidence faithfulness as a second semantic-judgment workload**
10. **Evaluate optional long-context/cloud judgment escalation**

The first two issues should be evidence-gathering work. The later implementation issues should depend on those results rather than assume them.

---

## Acceptance Criteria For Moving Beyond Experimentation

Proceed toward production integration only if the experiments show that:

- semantic selection materially improves relevant-context recall and/or reduces distracting context relative to the current window,
- latency is acceptable for interactive Discord use,
- the local tier can coexist with supported hardware profiles or degrade cleanly,
- provider/model identity and revisions can be recorded exactly,
- privacy/locality policy can prevent unauthorized remote processing,
- detailed findings can be stored without bloating normal trace records,
- public TRACE can explain selection without leaking private candidates,
- and the resulting architecture is simpler than a collection of special-case Discord heuristics.

If those conditions are not met, keep the deterministic graph ideas that prove useful and do not add a permanent JEV runtime merely because the model family is interesting.

---

## Open Questions

- Should conversation graph construction happen before the workflow Run begins, or as a declared workflow step?
- Should selected conversation nodes and external retrieval evidence converge into one final context-pack type, or remain separately projected into model input?
- What content lifecycle owns downloaded Discord attachments?
- Which attachment types can be inspected safely without sandboxing or additional malware controls?
- How should edited/deleted messages affect historical context identity?
- Should historical semantic-neighbor indexes be per-channel, per-thread, per-user, or deployment-wide?
- How should local/cloud calibration differences affect routing thresholds?
- What is the smallest useful canonical detail for reconstructing a selection decision without retaining duplicate private text?

These should remain explicit until the benchmark and prototype work provides evidence.

---

## Decision Posture

This proposal recommends **building and evaluating the capability boundary**, not assuming JEV should become a required Footnote dependency.

The architectural claim is narrower:

1. semantic classification is a different operation from text generation and deserves a separate runtime seam if adopted;
2. context resolution is a real Footnote weakness and a strong first workload for that seam;
3. local and cloud judgment models should be interchangeable under explicit capability, privacy, and cost policy;
4. detailed semantic findings should remain auditable without becoming authority or public-trace noise.

JEV earns a permanent place only if the measured context-selection and faithfulness results justify it.
