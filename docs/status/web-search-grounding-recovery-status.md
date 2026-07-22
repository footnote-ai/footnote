# Web Search Grounding Recovery Status

Status: implementation plan agreed; work has not started.

Last updated: 2026-07-22.

## Goal

Make Discord chat recover when a response needs current or external information
but the initial plan does not request web search, or when the first search does
not return useful enough results.

The first slice should recover inside one bounded backend workflow run. It must
record what happened and fail open when search is unavailable, invalid, or over
budget.

## Current State

The planner can request web search through `generation.search`. Its prompt
already says to search when facts may have changed or retrieval would materially
improve reliability, specificity, grounding, or source quality.

Current execution still has four important gaps:

1. A planner search request without a usable query is disabled instead of
   repaired.
2. Review can return only `finalize` or `revise`. It cannot return a typed search
   recovery action.
3. Workflow transition policy permits `assess -> tool`, but the review loop does
   not execute a new context step after assessment.
4. Web search stops at the first provider with any results. Non-empty results do
   not prove that those results are relevant, recent, suitable, or broad enough
   for the requested answer.

Planner re-entry does not currently receive an explicit structured statement
that review found missing or weak retrieval. Repeating the original plan is not
a reliable recovery mechanism.

The default `balanced` mode permits four workflow steps, one review cycle, and
two deliberation calls. That budget cannot execute a recovery path after the
first assessment.

## First-Slice Decisions

### Use the existing post-draft assessment

The first slice will not add a separate pre-generation grounding model call.
The existing assessment call will evaluate both answer quality and retrieval
sufficiency.

This is a deliberate tradeoff. A missed search may cause one draft to be
generated before recovery, but it avoids another model call on every request and
keeps the first implementation inside the current reviewed workflow.

A separate pre-generation evidence gate is later work if evaluation shows that
wasted drafts, latency, or recovery accuracy justify it.

### Extend the typed assessment decision

The assessment contract will support three actions:

```ts
type ReviewDecision =
    | {
          action: 'finalize';
          reason: string;
      }
    | {
          action: 'revise';
          reason: string;
          revisionInstruction: string;
      }
    | {
          action: 'search';
          reason: string;
          search: {
              query: string;
              deficits: Array<
                  'freshness' | 'relevance' | 'authority' | 'coverage'
              >;
          };
      };
```

The exact implementation may preserve the existing `reviewDecision` field name
to minimize contract churn. The required behavior is a discriminated,
serializable decision. Search execution must not be encoded in free-form
`revisionInstruction` text.

The model recommends an action. The backend remains authoritative for parsing,
validation, policy checks, limits, tool selection, execution, context injection,
and termination.

### Give assessment explicit retrieval context

Assessment should receive:

- the user request and bounded conversation context already used by the workflow
- the current draft
- whether web search was requested or executed
- the normalized query, when present
- provider attempt status and result count
- normalized result titles, URLs, and snippets already supplied to generation
- the current citation list

Search content must remain clearly labeled as untrusted. Raw provider responses,
hidden model reasoning, and instructions found in search results must not enter
the assessment as workflow authority.

### Assess retrieval suitability, not truth

The first slice can judge whether available search results appear suitable for
answering the request. Titles and snippets can indicate likely relevance,
recency, source identity, and topic coverage. They do not prove that a source
fully supports a claim.

The status and trace language should therefore use terms such as:

- retrieval sufficient
- retrieval missing
- search results insufficient
- additional search requested

It should not claim that a snippet-only assessment verified the answer or proved
a source authoritative.

## Target Workflow

The reviewed message path should support this shape:

```text
plan
  -> optional initial tool
  -> generate
  -> assess
      -> finalize
      -> revise -> generate -> optional assess
      -> search -> tool -> generate -> assess
```

When assessment requests search, the workflow should:

1. validate and normalize the proposed query
2. reject empty or repeated queries
3. check workflow, review, deliberation, recovery, and tool limits
4. execute the backend-owned web-search context step
5. append new context messages and citations without discarding earlier results
6. regenerate without unnecessary planner re-entry
7. run one final assessment when the resolved mode budget permits it
8. terminate without another search when the recovery allowance is exhausted

The first implementation permits at most one assessment-triggered recovery
search. The initial planner-requested search does not consume that recovery
allowance, but both searches count against normal tool and workflow limits.

## Mode and Budget Contract

The recovery path must fit inside the resolved Execution Contract. Recovery does
not bypass a caller or deployment limit.

Minimum paths are:

```text
Missed initial search:
plan -> generate -> assess -> tool -> generate -> assess
6 workflow steps, 1 tool call, 2 review calls, 5 model calls including plan

Insufficient initial results:
plan -> tool -> generate -> assess -> tool -> generate -> assess
7 workflow steps, 2 tool calls, 2 review calls, 5 model calls including plan
```

The first-slice mode behavior is:

| Mode       | Search recovery                                        | Required resolved allowance                                                                                             |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `express`  | disabled; preserve current low-cost fail-open behavior | no change                                                                                                               |
| `balanced` | one recovery search                                    | at least 7 workflow steps, 2 tool calls, 2 review cycles, and 5 deliberation calls                                      |
| `grounded` | one recovery search with stricter retrieval assessment | at least the balanced recovery allowance; existing higher review capacity may still refine afterward when limits permit |

Add an explicit `maxSearchRecoveryCycles` limit or equivalent backend-owned
counter with values `0` for `express` and `1` for `balanced` and `grounded`.
Normal hard limits still apply first.

The implementation must update mode defaults and Execution Contract resolution
together. Tests should assert the resolved limits and the actual executable
paths, not only the configured numbers.

## Missing-Query Repair

Missing-query repair and missed-search recovery are separate behaviors.

Repair applies only when the planner explicitly requested search but the query
is blank or invalid. The first slice will not add another model call for repair.
It will derive a bounded candidate from the latest user request plus the existing
bounded recent conversation context.

The repair path must:

- normalize whitespace
- enforce the existing search-query length boundary
- reject an empty or obviously unusable candidate
- avoid copying system messages or attachment contents into the query
- record whether the executed query was planner-provided or backend-repaired
- fail open without search when no safe candidate can be built

Repair must not infer search intent. If the planner did not request search, only
the post-draft assessment can request recovery in this slice.

## Failed Recovery

If assessment requests search but policy, limits, configuration, validation, or
provider execution prevents it, the workflow should:

1. stop attempting search for that run
2. preserve the latest successful draft
3. record the specific fail-open reason
4. expose existing search-unavailable metadata so Discord and web can warn the
   user without inferring failure from answer text
5. use a bounded non-search revision to reduce unsupported certainty only when
   policy and remaining limits already permit it

Failure to recover must not create an unbounded planner, search, or revision
loop.

## Lineage and Metadata

Record structured decisions without storing hidden model reasoning. Expected
signals include:

- assessment action
- retrieval deficit codes
- normalized executed search query
- query source: planner or backend repair
- query repair outcome
- whether a missed search was recovered
- whether initial results were judged insufficient
- whether a follow-up search executed
- fail-open or limit reason when recovery did not execute
- parent assessment, tool, and regenerated-answer step relationships

Context-step records remain the source of truth for what Footnote retrieved and
supplied to generation. Do not describe every returned citation as a source the
answer materially relied upon unless later claim-level evidence records support
that wording.

Discord and web remain display surfaces. They should use backend-computed
metadata and cost data rather than recreate grounding decisions.

## Evaluation and Rollout

Create a small, sanitized fixture set before changing behavior. It should
include real failure shapes without retaining private Discord content:

- current facts where the planner omitted search
- an explicit search request with a blank query
- an initial query that returns unrelated results
- results that appear useful enough to avoid recovery
- a stable question that should not search
- ambiguous follow-up wording where deterministic query repair must fail open

Track at least:

- missed-search recovery rate
- unnecessary-recovery rate on stable control questions
- insufficient-result recovery rate
- repeated-query rejection count
- search-unavailable and budget-blocked outcomes
- added latency
- added model calls, tokens, and backend-recorded cost

Before broad enablement, the fixture evaluation must show:

- every curated time-sensitive case either searches initially or requests one
  bounded recovery
- no repeated-query loops
- no recovery search on the stable control cases
- complete lineage for successful and failed recovery

Latency and cost should be reported against the current baseline before choosing
final production defaults. Do not claim improvement from unit tests alone.

## Work Slices

### 1. Add failure fixtures and baseline observability

- Add sanitized planner, search-result, and review fixtures for the cases above.
- Record existing planner search intent, invalid-query correction, provider
  result counts, and review outcomes where current metadata permits it.
- Capture baseline behavior, latency, and cost.

Done when the known failures are reproducible and measurable before behavior
changes.

### 2. Define assessment and budget contracts

- Extend the typed assessment decision with the search action.
- Validate query and deficit fields.
- Add the bounded recovery counter.
- Resolve mode and Execution Contract limits so the target paths are executable.
- Update workflow and metadata documentation with precise retrieval language.

Done when contract tests prove who may recommend search, who may execute it, and
how every mode bounds it.

### 3. Repair explicit search requests with missing queries

- Add deterministic bounded repair from allowed conversation input.
- Preserve explicit search intent when query construction is the only invalid
  field.
- Record planner-provided, repaired, rejected, and fail-open outcomes.

Done when an otherwise valid planner search request is no longer silently
disabled because its query is blank.

### 4. Execute assessment-triggered recovery

- Route an approved search decision through `assess -> tool -> generate`.
- Reuse the existing web-search context-step registry and fail-open behavior.
- Append recovered context, citations, and lineage to the same workflow run.
- Skip unnecessary planner re-entry.
- Enforce one recovery search and reject repeated queries.

Done when both a missed initial search and insufficient initial results can be
recovered in `balanced` and `grounded` within their resolved limits.

### 5. Evaluate and enable

- Run fixture, workflow, metadata, mode-resolution, and fail-open tests.
- Compare recovery accuracy, unnecessary searches, latency, and cost with the
  baseline.
- Enable the behavior only for modes whose resolved limits support it.
- Keep structured counters so production traces can show whether recovery is
  helping.

Done when the bounded behavior improves the fixture set without unexpected
searches on stable controls and the production cost tradeoff is documented.

Tests belong with each slice. This final slice evaluates the integrated behavior
instead of postponing all test coverage until the end.

## Out of Scope for the First Slice

- a separate pre-generation grounding model call
- autonomous multi-query research
- crawling arbitrary result pages
- claim-level source verification
- domain allowlists as a substitute for retrieval assessment
- broad provider-ranking changes
- migrations or backfills for older workflow records
- Discord-owned search, grounding, or cost authority

## Related Code and Docs

- `packages/prompts/src/defaults.yaml`
- `packages/backend/src/services/chatPlanner.ts`
- `packages/backend/src/services/workflowEngine.ts`
- `packages/backend/src/services/workflowEngine/reviewDecision.ts`
- `packages/backend/src/services/workflowEngine/reviewLoopExecutor.ts`
- `packages/backend/src/services/workflowEngine/transitions.ts`
- `packages/backend/src/services/contextIntegrations/webSearch/`
- `packages/backend/src/services/workflowProfileRegistry.ts`
- `packages/contracts/src/policy/`
- `docs/architecture/workflow.md`
- `docs/architecture/context-integrations/web-search.md`
