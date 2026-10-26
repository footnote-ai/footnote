# Model Behavior Baseline

Status: the corpus has twenty-six cases: seven initial planner/generation/review
cases, eight synthetic Assess-coverage cases for #941, and eleven temporal
relevance cases for #942. Integrity tests
validate case structure and labels; they do not execute a model. A one-off
Assess-decision comparison has now run through the existing generation
runtime; a general runner remains deferred until it can exercise the normal
planner, generation, and review seams without reconstructing chat orchestration.

## Goal

This baseline exists to support later comparisons of prompts, reasoning,
routing, and structured output. It is observational only: nothing here
changes model profiles, prompts, routing, provider contracts, or review
behavior.

The corpus and its tests live here:

```text
packages/backend/test/fixtures/modelBehaviorBaseline.json   # corpus
packages/backend/test/modelBehaviorBaseline.test.ts         # integrity tests
```

## Initial Cases

The seven initial cases keep first-pass behavior isolated:

1. direct generation with retrieval forbidden
2. planner selection on an ordinary message
3. planner selection on a retrieval request
4. structured planner schema validity
5. planner selection on a difficult routing request
6. review finalizing a clearly good draft
7. review revising a clearly defective draft

## Assess Coverage Cases (#941)

Eight synthetic review cases extend the corpus. They cover omissions with
available and missing evidence, an unevaluated trust claim, complete concise
multi-part answers, irrelevant quantitative proxies, ambiguity, and
appropriately bounded uncertainty. The Meta and Gemini examples are
representative patterns, not reproductions of the original incidents.

These fixtures specify expected outcomes and qualitative checks; by
themselves, they are not behavioral evidence. Direct reviewer calls can
measure the Assess decision, but do not establish that workflow recovery or
the delivered final answer improved.

### Focused Assess comparison

One pass per fixture compared the exact `origin/main` prompt at
`198c26384815d2530d93a2fdf2b0979e67d4bbd2` with the #941 prompt using the
existing `GenerationRuntime`, `composeAssessPrompt`, review schema, and
decision parser. Both variants used OpenRouter
`deepseek/deepseek-v4-flash-0731`, low reasoning, low verbosity, and the
workflow's 1,024-token assessment output limit. The fixtures' synthetic
review context was supplied as user-level context. This exercised the
reviewer decision, not backend context assembly, recovery execution, answer
regeneration, or the delivered answer.

| Measure                                         | `origin/main` | #941 prompt |
| ----------------------------------------------- | ------------: | ----------: |
| Expected decisions parsed and matched           |           7/8 |         8/8 |
| Material gaps detected                          |           4/4 |         4/4 |
| False revision/search on four negative controls |             0 |           0 |
| Searches requested                              |             2 |           1 |
| Median duration                                 |        3.50 s |      3.32 s |
| Prompt tokens                                   |         7,451 |       7,723 |
| Completion tokens                               |         3,657 |       3,990 |
| Total tokens                                    |        11,108 |      11,713 |

Twenty additional exploratory requests were consumed while correcting the
baseline source and an early parse-aborting script. Their outputs were
discarded and their usage was not persisted; the table covers only the 16
scored calls and does not represent total inference spend.

| Case                                | `origin/main` decision | #941 decision | Reasoning summary                                                                                                                     |
| ----------------------------------- | ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Meta operational evidence available | search                 | revise        | Baseline saw the requested effect as missing and searched; candidate directed revision from the supplied compliance/process evidence. |
| Meta operational evidence missing   | search                 | search        | Both identified the material evidence gap and requested targeted retrieval.                                                           |
| Gemini grounding claim              | revise                 | revise        | Both noted that the draft described grounding without evaluating the trust claim and its limits.                                      |
| Complete multi-part comparison      | finalize               | finalize      | Both found the cost, speed, and trade-off addressed.                                                                                  |
| Irrelevant quantitative proxy       | revise                 | revise        | Both rejected market capitalization as a substitute for the requested liquidity/cash-flow analysis.                                   |
| Concise sufficient answer           | finalize               | finalize      | Both accepted the correctly computed 40 ms difference.                                                                                |
| Bounded ambiguity                   | finalize               | finalize      | Both accepted the stated interpretation and its relevant limitation.                                                                  |
| Legitimate uncertainty              | finalize               | finalize      | Both accepted the specific evidence limit without requiring prohibited research.                                                      |

The baseline sent an unnecessary search for the Meta case whose context already
contained operational evidence; the #941 prompt revised from that context.
Both variants chose search when the same Meta evidence was absent. Both caught
the Gemini and proxy omissions, finalized the complete/concise answers, and
passed ambiguity and uncertainty controls. The prompt therefore improved the
available-versus-missing evidence route in this single sample, but did not
increase omission detection. Token and latency figures are descriptive only:
one call per case and variant on one model is not enough to attribute output
variation to the prompt or establish a general effect. Delivered-answer
quality and factual support remain unmeasured.

## Temporal relevance investigation and pilot (#942)

The implementation baseline was `6c8032713ecfc19e0c3d7155ac84a2868164c0fb`,
which includes #920/#926 evidence guidance and #941/#953 coverage guidance.
Inspection confirmed that conversation creation timestamps remained in the
context envelope rather than model messages; there was no shared effective
request clock. Web-search adapters also discarded provider date fields.
Generation and Assess mentioned dates generally but did not distinguish event,
announcement, planned release, and confirmed availability. Assess already had
bounded search recovery and adequate-evidence finalization; neither needed a
new service, compulsory model call, or changed decision contract.

Text chat now shares one backend clock reference across planning, generation,
recovery and assessment. An explicit conversational timezone can determine the
local date; missing timezone metadata remains unknown, with UTC as the stated
reference. Provider date text survives as publication/update metadata in
user-role evidence, without date parsing, inferred precision, or citation
contract changes. The shared generation and existing assessment prompts now
cover temporal distinctions, supersession and historical controls.

The original October 22 Meta/Gemini requests, drafts, retrieval payloads and
traces were not available in the issues or checkout. Every added case is
synthetic, not an incident reproduction. Ten cases were frozen before prompt
changes. Independent review found that one expected `search` label was wrong:
an explicitly later correction already resolved the older status. Its inputs
were retained and its oracle changed to `revise` before scoring. An eleventh
case separately supplies genuinely unordered, contradictory same-day reports.
It was evaluated in both variants without changing the candidate prompt.

### Paired assessment results

The October 25, 2026 pilot used the existing `GenerationRuntime`, assessment
composer, review schema and parser. Baseline and candidate used OpenRouter
`deepseek/deepseek-v4-flash-0731`, pinned to `wafer/fast`, with provider fallback
disabled, low reasoning/verbosity, and a 1,024-token output limit. The observed
model/provider were the same for scored calls. Source context and drafts were
identical in each pair; the candidate changed only temporal guidance in this
direct assessment comparison. This does not test backend clock injection or
provider date mapping, which have separate deterministic tests.

| Measure                                             |    Baseline |   Candidate |
| --------------------------------------------------- | ----------: | ----------: |
| Expected decisions matched                          |       10/11 |       10/11 |
| Searches requested                                  |           2 |           2 |
| Unnecessary work on three finalize controls         |           0 |           0 |
| False stale warnings on historical/current controls |           0 |           0 |
| Transport attempts, including retries               |          14 |          12 |
| Prompt tokens                                       |      11,584 |      10,819 |
| Completion tokens, including reasoning              |      10,548 |       8,005 |
| Median logical assessment duration                  |     3.676 s |     3.312 s |
| Provider-reported cost                              | $0.00392044 | $0.00323226 |

Both corrected the timezone boundary, newer Meta judgment, publication/event
confusion and unconfirmed scheduled release, and accepted historical,
sufficient-current and honestly undated answers. Both used the explicit later
postponement correction without searching. The baseline's undated-release
revision incorrectly proposed attributing a "newest" claim to an excerpt that
did not establish it; the candidate requested missing chronology instead.
Conversely, the baseline requested retrieval for the genuine conflict while
the candidate only proposed stating the conflict. That candidate answer would
be supported but misses useful allowed recovery. Equal decision scores conceal
this trade-off; the pilot does not establish an overall decision improvement.

### Delivered workflow results

Five paired runs exercised the real reviewed workflow after injecting the same
fixed initial draft, using synthetic evidence and a synthetic retrieval
executor. Planning and initial live generation were not exercised. Both used
the same bounds: seven steps, one tool call, two review cycles, three
deliberation calls, 20,000 tokens, 90 seconds and one recovery cycle. Assessment
kept its normal 1,024-token output limit; regeneration allowed 600 tokens.
Baseline/candidate generation and review prompts came from their respective
versions. Reassessments and transport fallbacks remained active and recorded.

| Case                        | Baseline delivered result                                                         | Candidate delivered result                                                                |
| --------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Meta supersession           | Wrong older judgment retained after assessment failure                            | Same failure and retained wrong judgment                                                  |
| Gemini stale rollout        | One search; regenerated supported availability, then reassessment failed          | No search; replaced unsupported status with a specific unresolved-availability limitation |
| Historical question         | Correct answer; no search                                                         | Correct answer; no search                                                                 |
| Sufficient current evidence | Correct answer; no search                                                         | Correct answer; no search                                                                 |
| Undated newest release      | One search, but recovery generation failed and unsupported initial draft survived | No search; removed invented date/newest claim and stated the missing chronology           |

Manual source comparison found supported, temporally bounded delivered text in
3/5 baseline and 4/5 candidate runs. The undated case demonstrates a narrower,
better-supported delivered answer, not successful identification of the newest
release. The candidate did not resolve the missing current facts in either
recovery case. Neither variant repaired the Meta answer. These observations
are not a reliability estimate or a claim of end-to-end incident resolution.

Workflow median durations were 6.959 s baseline and 12.817 s candidate. Baseline
used 14 transports, 23,312 input and 11,228 completion tokens ($0.00558868);
candidate used 16 transports, 30,291 input and 12,609 completion tokens
($0.00678286). Eight transports in each variant reached the output limit,
often spending the allowance on reasoning without usable visible text. This
left three baseline workflows and one candidate workflow with
`executor_error_fail_open`. Fail-open preservation is truthful but can retain
an incorrect draft. No runtime budget or model-routing changes were made to
mask these failures.

### Attempts, cost and limits

All attempts, including setup failures, exploratory routes, retries and failed
workflow stages, were logged before scoring. The campaign had explicit approval
for $0.50. Each outbound transport reserved a conservative input-byte/output
ceiling at catalog rates before dispatch; retries were separately admitted and
failed calls received no reservation refund. Total reserved ceiling was
$0.36106048; provider-reported total was **$0.021428486**, not the reservation.

| Attempt group                                                                 | Transports | Input tokens | Completion tokens | Reported cost |
| ----------------------------------------------------------------------------- | ---------: | -----------: | ----------------: | ------------: |
| Local logger-stub failures (20 assessments, 8 workflow attempts)              |          0 |            0 |                 0 |            $0 |
| Exploratory unpinned-provider run, interrupted after repeated empty responses |         11 |        9,529 |             4,160 |  $0.001904246 |
| Scored direct assessments                                                     |         26 |       22,403 |            18,553 |  $0.007152700 |
| Scored workflows, including unsuccessful stages                               |         30 |       53,603 |            23,837 |  $0.012371540 |
| Total                                                                         |         67 |       85,535 |            46,550 |  $0.021428486 |

Every dispatched transport has a recorded response and usage; no interrupted
transport has unknown billing. The exploratory results are excluded from the
paired comparison but included in total spend. A sanitized per-attempt ledger
is retained in ignored `response-comparison/.local/temporal/usage-ledger.jsonl`.
The executing maintainer owns raw-capture cleanup after scoring/review under
the [evaluation retention policy](web-search-evidence-quality.md).

Deterministic checks establish propagation and authority boundaries, not model
compliance. The pilot supports preserving the missing temporal inputs and
more explicit guidance, but **does not justify closing #942**: useful search
recovery still varies, output-limit failures preserve wrong drafts, and the
original incident inputs and full public chat flow remain unverified. A future
approved run should repeat fixed cases through normal planning/generation with
complete attempt accounting before making a stronger claim.

Local validation used the focused web-search, review-composition, corpus and
review-loop/recovery tests, plus clock-plumbing and invocation-validation tests;
prompt/backend builds and `pnpm review --changed-only` also ran. Broader
service/orchestrator test attempts were interrupted after unrelated failures
and stalled progress. The incomplete-usage assertion (`records.length` 0 vs 1)
also failed when replayed with the original baseline chat-service source and
the same credential-disabled environment. This isolates that service-source
comparison, not a certification of the entire baseline suite. The full suite
and integrated browser flow were not verified.

## Check Classes

Each case separates three kinds of evidence:

- `deterministic`: contract and normalization checks suitable for CI
- `objective`: observable runtime outcomes such as the selected action,
  retrieval intent, schema validity, or review decision
- `qualitative`: answer or instruction quality, which still needs manual
  review. No model-based judge is part of this baseline.

## Planned Live Result Rows

Once a thin runner exists, it should write one JSONL record per case, per
repeat run. Each row should capture:

- run ID, timestamp, git SHA, and corpus version
- case ID, workflow mode, profile ID, provider, and requested/resolved model
- prompt and profile hashes, where existing metadata can provide them
- reasoning effort and verbosity
- duration, token categories, and provider-reported cost when available
- retrieval, citation, structured-output, review, and fail-open outcomes
- qualitative artifacts or references for manual review, without committing
  raw prompts or responses to the repo

Calculated cost should only appear once the pricing source behind it can be
tied to a version or date. Until then, token counts and provider-reported
cost are the factual baseline.

## Provider-Specific Observations

Provider-native response IDs, output item IDs, annotations, native
tool-call IDs, and provider routing details are diagnostic artifacts, not
contract material, and they should not be flattened into shared Footnote
contracts just for symmetry. The OpenAI Responses conformance tests
(`packages/agent-runtime/test/openaiResponsesConformance.test.ts`) already
pin this boundary: the provider's native response ID stays available
internally without becoming a public response field.
