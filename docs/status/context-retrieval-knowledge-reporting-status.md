# Context Retrieval and Knowledge Reporting

Status: implementation complete on this branch; source-code retrieval remains a follow-up.

Issue: [#533](https://github.com/footnote-ai/footnote/issues/533)

Branch: `agent/issue-533-context-retrieval-cleanup`
Base: `origin/main`

## Review decision

Issue #533 should **not** add repository source-code retrieval. The current
architecture has a real gap there, but adding a new code/file retrieval
capability would turn this cleanup into a repository-indexing feature.

#533 can meet its invariant with the capabilities Footnote already has if it
does three things reliably:

- select an existing source when that source can answer the question;
- report the selected source, scope, and result status from backend-owned
  execution facts; and
- say that source-code inspection was not performed when no source can perform
  it, instead of asking for pasted material as though that were the only
  available path or implying that the repository was checked.

The source-code gap should become a separate follow-up, related to #493. It can
then decide whether bounded file retrieval, code search, TrustGraph loading, or
a curated source is appropriate.

## Hard review findings

### The existing retrieval capabilities are narrower than the first plan implied

The current sources are useful but not interchangeable:

- `project_context` retrieves approved, Git-tracked documents selected by
  `.footnote/context-files`, with commit-aware citations. It is not web search
  and it does not browse arbitrary repository files.
- `github_context` retrieves repository metadata, open issues, open pull
  requests, releases, and recent commits through fixed endpoints. It does not
  retrieve file contents, code search results, or complete repository or PR
  history.
- `generation.search` is provider-mediated web search. The repo-explainer hint
  prefers DeepWiki and then broader web context. That is a separate source,
  not project context or GitHub repository inspection.
- TrustGraph is an optional advisory retrieval path with scoped external
  evidence. Its repository-context path is about loading selected files; it is
  not an existing chat-time source-code search mechanism.

There is therefore a genuine source-code retrieval gap. Nothing inspected
provides a safe, bounded, revision-aware way to answer “read this repository
file” or “search the repository source.” The gap is not evidence that the
persona overlays should be added to the project allowlist.

The earlier plan was too close to making that gap part of #533. The corrected
scope is to make the limitation explicit and truthful. A source-code question
may still use project documents, GitHub metadata, or web search when those are
relevant, but the answer must not call that source-code inspection.

### Routing is distributed, but the observed failure is not fully attributable to routing

`chatPlanner.ts` normalizes planner output. `chatGenerationHints.ts` derives a
Footnote project-context route for `repo_explainer` requests and derives a
bounded GitHub route for current-state patterns. The orchestrator then creates
the requested context steps. This already covers common stable-document and
current-work questions.

The weakness is that source choice is spread across planner output, query
patterns, backend-derived routes, and the web-search hint. There is no compact
capability record saying “this route can answer metadata, but not source
files.” A planner can also request web search while backend routing adds
project and GitHub context, without one source-selection result explaining the
combination.

However, the pasted conversation does not include planner or workflow logs. It
proves the assistant made an unhelpful source claim; it does not prove which
planner branch ran. The implementation plan must not claim that a particular
route was skipped without runtime evidence. The substantiated defect is the
missing capability/scope reporting and the absence of a source-code route, not
a proven single regex or planner branch failure.

### The runtime already carries much of the needed structure

The first plan proposed a broad replacement context-block model. That is more
scope than #533 needs. Current code already carries:

- conversation messages plus a `ConversationContextEnvelope` with
  `visibility` and `authority: 'conversation'`;
- system, persona, and trusted guidance as separate system-role messages;
- context-step `outcome` values for executed, failed, skipped, and
  clarification states;
- integration-scoped serializable metadata in `integrationContext`, including
  project/GitHub status and reason codes;
- citations and response metadata for project and GitHub results; and
- retrieval requested/used signals and workflow execution records.

The missing piece is at the generation boundary. Retrieved project/GitHub
content is reduced to ordinary user-role text, while its source and status
remain in backend telemetry. “Not queried” is usually represented by the
absence of a step, and the model does not receive a single source manifest
that distinguishes that from an empty or failed retrieval.

The smallest durable fix is not a new memory system or entity index. Add a
small backend-owned, serializable **generation context manifest** derived from
the existing conversation envelope and context-step results. It should carry,
for each relevant source:

- source identity and authority;
- requested/not requested state;
- available, empty, partial, stale, failed, skipped, or unavailable result
  state; and
- a bounded capability/scope label, such as “approved project documents” or
  “five recent open-issue records.”

The manifest should be rendered deterministically at the prompt boundary when
generation needs the distinction, while the same facts remain in trace and
response metadata. Retrieved text stays untrusted user-level evidence. This is
structured runtime state rendered into the prompt, not a new prose-only rule,
and it does not require changing the provider runtime or tracking named
entities.

Conversation content itself remains the source of truth for what the user said.
The manifest must not summarize or extract names from it. It only tells the
model that the conversation is available as conversation content and that a
missing retrieval record is not evidence that a name was absent.

### The Danny/Myuri asymmetry remains a regression, not a retrieval feature

No current code path inspected removes Danny while retaining Myuri. Both names
occur in one user message and are passed as ordinary conversation content. The
failure is a model claim enabled by weak source-state separation, not a
persona-specific lookup or deterministic entity-filter bug.

The regression should use arbitrary names in the general test and retain the
Danny/Myuri/Winter transcript as a fixture. It should assert that the
conversation source remains intact and that the generated source manifest does
not turn “no retrieved profile” into “not mentioned.” It should not extract,
store, or special-case names.

## Revised scope for #533

### Defects that must be fixed

1. **Truthful source selection and scope.** Make the existing planner/backend
   route explicit about the capabilities of project context, bounded GitHub,
   and web search. Preserve the current backend authority and fail-open
   behavior. When no source can inspect source files, report that limitation
   instead of requesting pasted public material as a substitute for a check.
2. **Generation-time source state.** Add the narrow context manifest described
   above, derived from existing context-step and conversation structures. Use
   it to keep conversation, prompt/persona guidance, retrieved evidence, and
   unchecked/unavailable sources distinct where generation makes claims.
3. **Truthful reporting.** Derive traces and user-facing source summaries from
   actual execution results. Keep project documents, GitHub records, web
   results, and any future source-code retrieval visibly separate. Do not let
   persona strength change evidence labels or source scope.

### Cleanup that belongs with those defects

- Refine `repo_explainer` guidance so DeepWiki/web search is not described as
  project context or complete repository inspection.
- Preserve and reuse existing project/GitHub status, citation, and boundedness
  metadata instead of creating parallel status vocabularies.
- Make “not requested” distinguishable from “requested but failed/unavailable”
  in the manifest or trace where the user’s question makes that distinction
  relevant.
- Keep the existing `conversation_context_boundary` proposal as design
  precedent, but do not implement its full generalized context-block model in
  this issue.

### Follow-up work, not #533

Create a separate issue for bounded repository source-code retrieval. It should
decide, rather than assume, whether the source is:

- revision-pinned file/content retrieval;
- bounded code search;
- selected-file loading through TrustGraph; or
- a curated public reference that is intentionally not raw implementation
  source.

That issue needs its own access rules, limits, citations, freshness semantics,
and tests. Persona overlays and `docs/architecture/prompt-resolution.md`
should be decided there or in a separate prompt-source design, not added to the
project allowlist to satisfy this regression.

Also out of scope are claim-level factual verification and any change to #530.
The former would be a larger model-evaluation or response-review feature; the
latter concerns persona expression, not evidence authority.

## Implemented state

The branch was rebased onto `origin/main` at the merge commit for PR #532
without conflicts. The #532 persona-expression path remains unchanged and is
covered by the existing presentation workflow test.

The implementation adds a backend-derived `GenerationContextManifest` at the
generation prompt boundary. It reuses the conversation envelope and context
step results to label conversation and prompt context separately from returned
integration evidence, and to distinguish retrieved, empty, partial, stale,
failed, skipped, unavailable, not-requested, and requested-without-results states. The
manifest is deterministic prompt input; it does not inspect message entities,
create a second persisted provenance record, or change provider adapters.

Planner and prompt guidance now describe project documents, bounded GitHub
metadata, and web search as separate sources. They explicitly avoid treating
bounded GitHub metadata or web results as source-code inspection. No source-code
retrieval capability or persona-overlay allowlist change was added.

Focused regressions cover arbitrary names in one conversation turn, the
Danny/Myuri/Winter example, source-state projection, empty and failed
retrieval, unavailable GitHub context, source-boundary guidance, and
persona-expression preservation.

## Main implementation seams

- `packages/contracts/src/policy/types.ts` and related policy helpers: define
  the small serializable manifest/status shape, reusing existing integration
  status vocabulary where possible.
- `packages/backend/src/services/chatGenerationHints.ts`: describe the
  existing planner routes and their source boundaries without adding a
  source-code route. `chatPlanner.ts` and
  `chatOrchestrator/plannerResultApplier.ts` remain the inspected routing
  authorities.
- `packages/backend/src/services/workflowEngine.ts`,
  `workflowEngine/contextStepHelpers.ts`, and
  `workflowEngine/contextManifest.ts`: derive and render the
  manifest at the prompt boundary while preserving trusted-system versus
  untrusted-evidence roles.
- Existing `packages/backend/src/services/chatService.ts` context reporting
  remains the response/trace authority; this issue does not create a second
  response provenance shape.
- `packages/prompts/src/defaults.yaml` and prompt tests: describe the manifest
  and source boundaries accurately. This is supporting guidance, not the sole
  fix.

Do not modify `packages/agent-runtime` unless implementation proves that the
provider-neutral text boundary cannot carry the deterministic rendering. The
current runtime intentionally accepts normalized text messages, and #533 does
not require a provider-native context protocol.

## Revised test plan

- **Routing:** generic project explanation, current Footnote work, explicit
  public repository questions, source-file questions, and web-search questions.
  Assert the selected source and declared scope. Assert that a source-file
  request does not claim code inspection when only metadata/doc sources ran.
- **Manifest derivation:** conversation, prompt/persona guidance, successful
  retrieval, empty results, partial/stale results, skipped, failed,
  unavailable, and not-requested states. Use arbitrary integration fixtures,
  not persona names.
- **Prompt boundary:** verify deterministic source/status rendering, preserved
  role and trust boundaries, and unchanged conversation content. Verify that
  retrieved user-role text cannot be mistaken for trusted instructions.
- **Danny/Myuri/Winter regression:** use the supplied transcript plus a
  generalized two-name conversation fixture. Assert both names remain in the
  conversation input and that no source-state record treats one as absent.
  Do not assert exact LLM wording as the only test.
- **Reporting:** verify that traces and response metadata name only sources
  actually requested/executed, distinguish bounded results from totals, and
  distinguish unavailable/failed/not-requested outcomes.
- **Prompt behavior:** verify source-boundary guidance and that changing
  persona/TRACE strength does not change the manifest. A model-output fixture
  may be useful, but it should supplement deterministic contract and assembly
  tests.

## Remaining human decisions

1. Should the generation context manifest be model-visible on every request,
   or only when retrieval is requested or a source boundary matters? Always
   showing it is clearer; conditional rendering reduces prompt noise.
2. Should #533’s acceptance criteria require only truthful source state and
   prompt assembly, or a separate claim-level check that rejects every model
   sentence contradicting conversation content? The current architecture has
   no general claim verifier; adding one would materially expand this issue.
3. When a repo-explainer request can use project context, bounded GitHub, and
   web search together, should the backend intentionally run all applicable
   sources or choose one based on the requested fact type? The answer affects
   latency and evidence presentation, but does not justify adding source-code
   retrieval here.

## Validation

Validation completed with:

- focused backend tests: 39 passing;
- `pnpm --filter @footnote/contracts build`;
- `pnpm --filter @footnote/backend build`;
- `pnpm --filter @footnote/prompts build`;
- `pnpm format:write`;
- `pnpm review --changed-only`; and
- `pnpm validate-openapi-links`.

The broader existing chat-service suite still has a known baseline failure on
`origin/main` in the #532-era reviewed workflow path; it was confirmed before
this implementation and was not changed here.
