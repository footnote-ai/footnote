# Web Search Grounding Recovery Status

Status: implemented, validated with deterministic fixtures, and demonstrated once with live recovery; [PR #916](https://github.com/footnote-ai/footnote/pull/916) is open against `main`.

Issue: [#451](https://github.com/footnote-ai/footnote/issues/451)

Last updated: 2026-10-21.

## Behavior

The reviewed workflow can now recover with fresh web grounding without adding a
new workflow step, planner call, or separate recovery engine:

```text
plan -> retrieve? -> presentation? -> generate -> assess
                                               | finalize -> finish
                                               | revise -> replan? -> generate -> assess?
                                               | search -> retrieve -> generate -> assess
```

The `search` outcome is a typed assessment recommendation. The backend validates
the query, rejects empty or repeated searches, and checks policy, provider
availability, and the existing Execution Contract before running the single
approved follow-up query. It does not rerun the initial retrieval batch or
unrelated integrations. Search snippets and source metadata remain untrusted
context, not proof that a claim is true or supported.

The resolved recovery-cycle allowance is recorded on the Run and public trace.
Before recovery, token admission reserves enough for a follow-up generation and
its assessment using the existing token-budget estimator. Step, tool-call,
deliberation, and elapsed-time limits continue through the shared workflow
admission checks. Elapsed time is admitted one step at a time because provider
duration cannot be predicted. A retrieval may complete near the deadline and
leave too little time for regeneration; then the last successful draft remains
available and the recovery is recorded as incomplete.
Assessment output is capped at 1,024 tokens, and that allowance is included in
the existing cumulative reservation.

Recovered results are appended to the same named `evidence` Result, preserving
prior content and provenance. The following generation and assessment receive
the combined retrieval context. Trace lineage records the assessment request,
query source and outcome, returned-source count, and generation that followed.
Retrieved sources and answer-provided citations are recorded separately; no
claim-level support verification is claimed. Existing public trace projection
continues to omit private search queries and detailed signals.
Provider-native search is shown to assessment only through the runtime-reported
query/use status and answer citations; the runtime contract does not expose its
full result records.

When the planner explicitly requests search with a blank or overlong query,
the backend repairs it deterministically from the latest user-authored context.
No model call is added, and no query is invented when search was not requested.

If a recovery is unavailable, cancelled, repeated, or blocked by a limit, the
latest successful draft is retained and the workflow records the failure or
limit reason. Chat delivery adds a note that current-fact claims depending on
the failed search are unconfirmed.

## Defaults and configuration

| Mode     | Default recovery cycles | Default Execution Contract limits                     |
| -------- | ----------------------: | ----------------------------------------------------- |
| Express  |                       0 | 3 workflow steps, 0 tool calls, 0 deliberation calls  |
| Balanced |                       1 | 7 workflow steps, 2 tool calls, 3 deliberation calls  |
| Grounded |                       1 | 10 workflow steps, 3 tool calls, 4 deliberation calls |

Set `chat-workflow.max-search-recovery-cycles` only in `footnote.yaml` to `0`,
`1`, or `2`. The configured value is clamped to the resolved step, tool, review,
and deliberation budgets; operators must raise the existing budget overrides
as needed for two cycles.
There is no separate recovery toggle or settings UI.

## Deterministic and live evidence

Sanitized, synthetic fixtures cover missed initial search, stale initial
results, blank-query repair, stable no-search control, limits `0/1/2`, repeated
queries, provider unavailability, cancellation, token/tool exhaustion, evidence
preservation, duration exhaustion after retrieval, lineage, and revise/search
interaction. These are deterministic
workflow and parser tests, not evidence of live model recovery accuracy.

The deterministic missed-search fixture uses four model calls and one
follow-up search with recovery enabled, versus two model calls and no search
when the allowance is `0`; the stable no-search control remains two model calls
with no retrieval. These fixtures omit provider usage, elapsed time, and
billable cost, so they do not provide a token, latency, or cost comparison.

A deterministic Balanced non-search revision fixture also compares the earlier
four-step/one-review limits with recovery-enabled defaults: both stop after two
model calls and perform no retrieval. The recovery allowance does not enable
extra revision work on that path.

On 2026-10-21, a bounded pre-fix production baseline ran two requests against
Fly v545 using the configured DeepSeek profile. The freshness request returned
HTTP 200 in 45.9 seconds, but assessment failed after 21.6 seconds with
`STRUCTURED_OUTPUT_NOT_GENERATED` at `response_parsing`; the provider reported
`finishReason=length`. No typed search decision or recovery retrieval followed.
Successful calls before the failed assessment used 13,234 tokens; assessment
usage was unavailable. The stable control finalized in 11.6 seconds and used
12,917 total tokens, including 5,524 for assessment. The planner still chose an
initial retrieval for that control. Both runs reported cost `0` with
`costCompleteness=unknown` and `unpriced_model`, so actual spend is unavailable
and the reported zero is not evidence of free usage. Private prompts and
response IDs are intentionally omitted. The deployed v545 image did not expose
a source commit label, so its exact source revision remains unverified.

The first cap-only deployment (v546) completed assessment on the same freshness
prompt, but finalized even though its draft acknowledged that the current
official schedule was not among the sources. This exposed an assessment-guidance
gap in addition to the 512-token truncation. The default review prompt now says
not to finalize when a key requested fact is missing, unverified, or inferred.

After that change, one repeat request on Fly v547 completed the intended path:
plan, initial retrieval, presentation, generation, assessment, recovery
retrieval, regeneration, and reassessment. The Run completed with one recovery
cycle allowed; its trace contains two `evidence` Results and no stopped
Execution Contract limit. The configured DeepSeek V4 Flash profile was used.
This is live evidence that the workflow can recover, not proof that the model
will request recovery reliably for all weak-evidence answers.

The pre-fix request took 45.9 seconds and the post-cap-only run took 52.8
seconds without recovery. The recovery run took 70.3 seconds and recorded six
model calls, two web-search calls, and 33,208 tokens. Against the same prompt's
cap-only run (four model calls, one search, 22,969 tokens), that is an observed
increase of 17.5 seconds, two model calls, one search, and 10,239 tokens. This
is a small observational comparison, not a controlled provider benchmark.
Per-call trace cost fields sum to `$0`; public traces do not expose cost
completeness, so actual billed cost is unknown and the zero must not be read as
free usage. Private prompts, search queries, and response IDs are omitted.

## Related documentation

- [Workflow architecture](../architecture/workflow.md)
- [Web search context integration](../architecture/context-integrations/web-search.md)
