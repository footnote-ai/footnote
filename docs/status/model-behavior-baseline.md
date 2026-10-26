# Model Behavior Baseline

Status: the corpus has fifteen cases: seven initial planner/generation/review
cases and eight synthetic Assess-coverage cases for #941. Integrity tests
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
