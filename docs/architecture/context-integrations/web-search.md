# Web Search Context Integration

This document describes the optional `web_search` context integration.

`web_search` is an optional workflow context step. When enabled and configured,
it provides bounded, advisory search context before generation. If unavailable,
generation continues fail-open without retrieved context.

## Purpose and boundary

`web_search` helps with current facts and source discovery. It does not grant
direct authority to external providers.

- Providers can return candidate records (`title`, `url`, optional `snippet`
  and provider date text).
- Footnote decides how those records are used.
- If provider calls fail, workflow keeps fail-open behavior and continues
  without blocking the base response path.

Search discovery is not source reading. Results are candidate sources, not
verified evidence by themselves.

Provider dates are preserved as text and labeled as provider-reported
publication or update dates, not event dates. SearXNG supplies `publishedDate`,
Brave supplies `page_age` (or the relative `age` when absent), and SerpAPI
supplies `date`. No timezone, midnight timestamp, or event date is inferred.
Brave explicitly defines its [page date](https://api-dashboard.search.brave.com/api-reference/web/search/get)
as publication or last modification; [SerpAPI dates](https://serpapi.com/blog/how-to-parse-dates-from-google-search/)
can also be relative text. Missing dates stay unknown. Dates travel with the
same user-role evidence through generation, recovery, and reassessment, rather
than becoming citation authority or a new public contract field.

Text chat supplies a single backend request-time reference to planning,
generation, and review. The orchestrator captures it at entry; direct service
calls use service entry time. The reference is UTC, with no inferred user
timezone. An explicitly supplied conversational timezone can change the local
calendar date. This is distinct from an earlier conversation message's creation
time, which remains envelope metadata. Temporal guidance distinguishes event,
announcement, scheduled release, and confirmed availability; older historical
sources and sufficient current evidence do not require another search merely
because of their age. Decisive missing or contradictory current facts use the
existing bounded search-recovery path.

The model receives titles, URLs, and optional excerpts from the search provider,
not the full pages. The formatted input makes that clear and marks missing
excerpts. Search results stay in user-role messages: they can help support an
answer, but they cannot instruct Footnote. Generation and review guidance asks
the model to check dates, conflicting reports, and independent support rather
than treating repeated excerpts as verification.

This formatting takes up prompt tokens like any other retrieved context. The
workflow's existing token estimator considers the model's input messages before
admitting a step, and provider-reported usage is counted against the Run's
limits. Longer excerpts or instructions therefore reduce the budget available
for later calls; this change does not introduce separate token allowances.

The proposed behavioral checks and what they can establish are tracked in
[Web search evidence quality](../../status/web-search-evidence-quality.md).

For `repo_explainer`, the backend also carries the canonical repository identity
through retrieval. Each normalized provider record is classified as
`in_scope`, `out_of_scope`, or `uncertain` before it can become generation
context or a citation. Unknown web surfaces are not admitted merely because
their text contains a common project word. The bounded scope audit records the
decision and reason so an operator can distinguish filtered noise from an empty
search.

## Runtime shape

`chatOrchestrator` injects `web_search` into workflow context-step execution.
`workflowCore/reviewedChatWorkflow` executes it before `generate` when requested
and eligible.

Provider attempts are deterministic by configured priority and recorded as
attempt metadata:

- provider name
- status (`executed_with_results`, `executed_empty`, `skipped`, `failed`)
- reason code (when skipped/failed)
- duration and result count

If no provider returns records:

- all skipped -> `skipped/tool_unavailable`
- any failed -> `failed/tool_execution_error`
- otherwise -> `skipped/tool_not_used`

## Assessment-triggered recovery

The reviewed workflow can ask for one more search after assessment when
retrieval is missing or its returned sources appear stale, unrelated, or
incomplete. This reuses the existing `retrieve` Step and web-search executor;
the assessment decision is typed as `search`, not represented as a new Step.
The backend validates the query, rejects repeats, and checks the resolved
Execution Contract before running it. A recovery retrieval runs only that
approved query, not the initial request batch or unrelated integrations.
Assessment and recovery regeneration do not inherit a provider-native search
hint; an earlier native search counts as repeated work only when the runtime
reports that retrieval was actually used.

Results and provenance from earlier retrievals remain in the named `evidence`
Result, with follow-up results appended. The next generation and assessment
receive the combined untrusted context. Traces distinguish sources returned by
retrieval from citations emitted by the answer; neither a search result nor a
citation alone proves that a source supports a claim. If the provider is
unavailable, the request is cancelled, or a limit blocks recovery, the workflow
keeps the last successful draft and records the reason.
Assessment output is capped at 1,024 tokens; the existing cumulative token
reservation accounts for that allowance before recovery retrieval.

If the planner explicitly requests search but leaves the query blank or too
long, the backend may repair it deterministically from the latest
user-authored text. It does not call another model or infer search intent when
the planner did not request it. The query source is recorded as `planner`,
`backend_repair`, or `assessment` in private workflow lineage.

## Provider model

Supported providers:

- `searxng`
- `brave`
- `serpapi`

Default priority:

- `searxng,brave,serpapi`

All providers normalize into the same source schema and untrusted context
message format to keep downstream behavior provider-neutral.

The repository-scoped path uses the same provider-neutral normalization for all
providers. Query construction may add repository-specific hints, but query text
is not a scope guarantee; admission happens after provider retrieval. The
canonical GitHub repository and known project documentation surface can be
admitted structurally. Other records remain out-of-scope or uncertain unless a
future auditable scope rule proves otherwise.

Current SerpAPI mapping for web search:

- `organic_results[].link` -> normalized `url` (http/https only)
- `organic_results[].title` -> `title`
- `organic_results[].snippet` -> optional `snippet`
- `organic_results[].date` -> optional provider-reported `sourceDate` text

## Configuration

### Setup quick start

1. Turn on integration:

- `CHAT_CONTEXT_WEB_SEARCH_ENABLED=true`

2. Pick provider order (left to right fallback):

- `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY=searxng,brave,serpapi`

3. Configure at least one provider:

- SearXNG: set `CHAT_CONTEXT_WEB_SEARCH_SEARXNG_BASE_URL`
- Brave: set `CHAT_CONTEXT_WEB_SEARCH_BRAVE_API_KEY`
- SerpAPI: set `CHAT_CONTEXT_WEB_SEARCH_SERPAPI_API_KEY`

4. Set safety/perf bounds:

- `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_TIMEOUT_MS=12000`
- `CHAT_CONTEXT_WEB_SEARCH_MAX_RESULTS=6`

If a provider is in priority but missing credentials/config, it is skipped as
`tool_unavailable` and the next provider is tried.

### Environment variables

| Variable                                                   | What it controls                                                             | Typical value / notes                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CHAT_CONTEXT_WEB_SEARCH_ENABLED`                          | Master on/off switch for `web_search` context-step execution.                | `true` (default). Set `false` to disable integration globally.         |
| `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY`                | Ordered fallback list of providers.                                          | `searxng,brave,serpapi` (default).                                     |
| `CHAT_CONTEXT_WEB_SEARCH_SEARXNG_BASE_URL`                 | Base URL for SearXNG API calls.                                              | Example: `https://searxng.example`                                     |
| `CHAT_CONTEXT_WEB_SEARCH_BRAVE_API_KEY`                    | Brave Search API key.                                                        | Required only if `brave` is in priority and expected to run.           |
| `CHAT_CONTEXT_WEB_SEARCH_SERPAPI_API_KEY`                  | SerpAPI key for web search provider.                                         | Required only if `serpapi` is in priority and expected to run.         |
| `CHAT_CONTEXT_WEB_SEARCH_SERPAPI_ENGINE`                   | Optional SerpAPI engine override.                                            | Defaults to `google` if unset.                                         |
| `CHAT_CONTEXT_WEB_SEARCH_SERPAPI_GL`                       | Optional SerpAPI country hint (`gl`).                                        | Example: `us`                                                          |
| `CHAT_CONTEXT_WEB_SEARCH_SERPAPI_HL`                       | Optional SerpAPI language hint (`hl`).                                       | Example: `en`                                                          |
| `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_TIMEOUT_MS`              | Timeout budget per provider attempt.                                         | `12000` (default). Lower for stricter latency, higher for resilience.  |
| `CHAT_CONTEXT_WEB_SEARCH_MAX_RESULTS`                      | Max normalized results kept from a successful provider response.             | `6` (default). Keep small to avoid prompt bloat.                       |
| `CHAT_CONTEXT_WEB_SEARCH_OPENAI_NATIVE_FROM_HINTS_ENABLED` | Allows optional OpenAI-native follow-up search from generated `searchHints`. | `true` (default). Set `false` for stricter external-provider-only use. |

Set `chat-workflow.max-search-recovery-cycles` only in canonical
`footnote.yaml`. Values are `0` to `2`; mode defaults are Express `0`, Balanced
`1`, and Grounded `1`. There is no separate enable switch or recovery-specific
UI. Configuring `2` only permits two cycles when the resolved step, tool,
review, and deliberation budgets also leave room for them.

### Recommended setups

- SearXNG-first self-hosted posture:
    - `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY=searxng,brave,serpapi`
    - Set SearXNG base URL, keep Brave/SerpAPI as commercial fallback.
- API-only posture (no SearXNG):
    - `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY=brave,serpapi`
    - Set Brave and/or SerpAPI keys.
- SerpAPI-focused posture:
    - `CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY=serpapi`
    - Set SerpAPI key and optional `ENGINE/GL/HL`.

Missing provider credentials should degrade to `tool_unavailable` for that
provider attempt, not block the request.

## Operator and review expectations

- Keep env parser behavior and config-spec definitions aligned for every
  `CHAT_CONTEXT_WEB_SEARCH_*` variable.
- Keep provider outcomes visible via attempt metadata and reason codes.
- Keep provider output bounded and serializable for trace/provenance surfaces.
- Treat recovered search results as untrusted discovery context, not verified
  support; keep query and source detail behind existing trace privacy rules.
