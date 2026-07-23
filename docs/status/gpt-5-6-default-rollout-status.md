# GPT-5.6 Default Rollout Status

Status: focused implementations integrated; verification in progress.

Last updated: 2026-07-22.

## Goal

Make GPT-5.6 the default OpenAI model family across Footnote while preserving
backend-owned routing, provenance, cost, review, and fail-open semantics.

Use GPT-5.6 Luna for fast and structured work, GPT-5.6 Terra for normal/default
OpenAI generation, and GPT-5.6 Sol at medium reasoning for quality-first
escalation.

Canonical guidance:

- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-luna

## Agreed Decisions

### Preserve existing profile identities

| Profile                 | Provider model  | Intended role                      |
| ----------------------- | --------------- | ---------------------------------- |
| `openai-text-fast`      | `gpt-5.6-luna`  | fast generation and planner work   |
| `openai-json-optimized` | `gpt-5.6-luna`  | structured planning and assessment |
| `openai-text-medium`    | `gpt-5.6-terra` | default OpenAI generation          |
| `openai-text-quality`   | `gpt-5.6-sol`   | quality-first escalation at medium |

`DEFAULT_PROFILE_ID` remains `openai-text-medium`. The legacy `DEFAULT_MODEL`
fallback becomes `gpt-5.6-terra`.

Curated profiles, pickers, traces, and pricing use explicit Sol, Terra, and
Luna IDs. The `gpt-5.6` alias is not a curated option. Existing raw-model
override behavior may continue to accept it, but final traces and cost records
must prefer the provider-returned concrete model.

### Reuse the quality escalation profile

`openai-text-quality` already represents the higher-quality route and advertises
the `expressive-generation` capability. Repoint it to Sol instead of adding an
overlapping preset.

Sol selection is limited to an explicit profile override, planner selection of
`expressive-generation`, or an Execution Contract carrying the existing
`verification` capability tag. Search, verbosity, conversation length, or a
transient Terra failure do not independently justify Sol escalation.

### Make reasoning support explicit

The shared reasoning vocabulary becomes:

```text
none, low, medium, high, xhigh, max
```

Remove `minimal` rather than preserving a pre-1.0 compatibility alias. Model
profiles declare supported/default reasoning behavior. Unsupported provider
settings are omitted with structured diagnostics so execution remains fail-open.

Sol starts at medium. Higher effort is opt-in and requires representative
evaluation evidence.

### Keep optional GPT-5.6 features separate

The baseline does not enable pro mode, persisted reasoning, explicit prompt
caching, Programmatic Tool Calling, or multi-agent execution. These features
change execution, latency, cost, or state semantics and require separate
evaluation.

### Record costs completely or label them partial

Backend cost accounting covers base input/output, cached input, cache writes,
and GPT-5.6 long-context multipliers. Calculations expose completeness and the
pricing rules applied. Missing usage details produce a partial estimate rather
than a falsely complete value.

Discord and web display backend-owned cost results.

### Send privacy-preserving safety identifiers

The backend derives `safety_identifier` with HMAC-SHA256, a dedicated optional
secret, a versioned namespace, the surface, and a stable user identifier. Raw
user identifiers are never sent or logged. Missing identity or configuration
omits the field and records a structured diagnostic without blocking execution.

## Worktrees

| Workstream         | Branch                             | Status     | Ownership                                      |
| ------------------ | ---------------------------------- | ---------- | ---------------------------------------------- |
| Integration        | `agent/gpt-5-6-integration`        | verifying  | tracker, integration, final validation         |
| Catalog/defaults   | `agent/gpt-5-6-catalog-defaults`   | integrated | models, profiles, defaults, OpenAPI            |
| Runtime management | `agent/gpt-5-6-runtime-management` | integrated | reasoning behavior and safety identifiers      |
| Cost accounting    | `agent/gpt-5-6-cost-accounting`    | integrated | pricing, usage, completeness, applied rules    |
| Prompt guidance    | `agent/gpt-5-6-prompt-guidance`    | integrated | planner prompt split and focused prompt review |

The integration branch receives focused commits in this order: catalog,
runtime, costs, then prompts. Runtime work begins after the shared catalog and
reasoning metadata settle. Only the integration worktree edits this tracker.

## Prompt-Guidance Target

Preserve domain context, governance requirements, provenance rules, success
criteria, structured output contracts, and product-specific style. Review only
repeated instructions, duplicated schemas, unnecessarily long tool descriptions,
and prompt wording already enforced by `text.verbosity`.

The known planner contradiction must be removed: structured planner execution
forces a function call while the shared planner prompt currently prohibits one.
Structured mode should receive a lean tool-oriented prompt. Text-JSON fallback
retains the JSON-format instructions it needs. Both modes continue to share
routing, retrieval, safety, and TRACE semantics.

## Cost Requirements

Canonical base rates per 1M tokens:

| Model         | Input | Cached input | Output |
| ------------- | ----: | -----------: | -----: |
| GPT-5.6 Sol   | $5.00 |        $0.50 | $30.00 |
| GPT-5.6 Terra | $2.50 |        $0.25 | $15.00 |
| GPT-5.6 Luna  | $1.00 |        $0.10 |  $6.00 |

Cache writes cost 1.25 times ordinary input. Requests above 272K input tokens
apply the documented full-request long-context multipliers: two times input and
1.5 times output.

## Acceptance Criteria

### Model selection

- Terra is the default OpenAI response model.
- Luna backs fast and structured OpenAI profiles.
- Sol at medium backs the quality profile.
- Expressive and verification routing can reach Sol.
- Explicit profile overrides continue to work.
- Disabled or unavailable profiles preserve existing fail-open policy.

### Runtime behavior

- Every active GPT-5.6 path uses intentional reasoning behavior.
- `minimal` is removed from active public and runtime contracts.
- Unsupported reasoning values are handled by backend/profile policy rather
  than silently remapped by adapters.
- Existing tool-calling and structured-output paths remain functional.
- The actual returned model ID is recorded.
- Safety identifiers are pseudonymous, optional, and never logged raw.

### Cost transparency

- Sol, Terra, and Luna have verified base and cached-input pricing.
- Cache-write and long-context rules are represented.
- Cost output reports completeness and applied rules.
- Discord and web consume backend-owned cost data.

### Prompt behavior

- Structured planner instructions no longer contradict forced tool calling.
- Text-JSON fallback remains usable.
- Representative planner and response cases do not regress.
- Prompt changes remove measured duplication without weakening governance.

## Verification Plan

Run focused contracts, configuration, backend, agent-runtime, prompt, planner,
routing, and cost-recorder tests. Build every package whose public types or
exports change. Also run:

```text
pnpm validate-openapi-links
pnpm test:build
pnpm format:write
pnpm review --changed-only
```

Representative model comparisons should record task success, structured-output
validity, selected model, reasoning effort, token categories, latency, and
calculated cost. Sol must show a material correctness or completeness gain on
quality-gated tasks; tone or length alone does not justify escalation.

## Progress Log

- 2026-07-22: Created the integration worktree and branch.
- 2026-07-22: Completed initial repository and OpenAI guidance investigation.
- 2026-07-22: Agreed on Terra as default, Luna for smaller profiles, and Sol at
  medium for quality escalation.
- 2026-07-22: Agreed on shared reasoning values, complete-or-partial pricing,
  HMAC safety identifiers, and explicit family IDs.
- 2026-07-22: Created focused catalog, runtime, cost, and prompt worktrees.
- 2026-07-22: Started catalog, cost, and prompt implementation in parallel.
- 2026-07-22: Integrated all four focused workstreams into the integration
  branch.
- 2026-07-22: Built contracts, config-spec, prompts, agent-runtime, backend,
  api-client, and discord-bot with the workspace TypeScript compiler.
- 2026-07-22: Passed the integrated orchestrator suite, focused GPT-5.6
  catalog test, Discord news tests, and OpenAPI link validation. Three
  pre-existing model-profile catalog tests also fail on unchanged `main` and
  remain outside this rollout's scope.
- 2026-07-22: Passed changed-file review and the full Docker build check.
