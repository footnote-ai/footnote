# Prompt caching

Footnote observes provider prompt-cache usage independently of whether deliberate
cache controls are enabled. Cached tokens are part of input usage. They are not
tokens avoided, and a missing cache field is not a measured zero.

## Configuration and request boundary

Model profiles may opt into backend-owned cache policy:

```yaml
promptCaching:
    enabled: true
    ttlSeconds: 1800
```

All bundled profiles leave deliberate caching disabled. Enable only a measured
profile/path after its write costs are understood. Omitting this section leaves
provider-managed automatic caching intact. No conversation history is shortened.

The backend selects an explicitly annotated, contiguous prefix of shared system
and default persona instructions. Profile overlays, request expression guidance,
the effective request clock, plans, memory, retrieved evidence, and conversation
remain outside that selected prefix. Presentation selects its fixed task prefix.
Retrieved material retains its existing advisory user role.

One backend helper resolves the identity after profile selection, including
fallbacks and typed-output transport changes. It hashes only selected trusted
prompt material, profile/provider/model, purpose, surface, and structured schema
or tool-presence configuration. The identity is versioned `v1`; changes to native
tool mapping require a version bump. Caller identities, user text, retrieved
material, and secrets never enter it. Keys stay internal and are not diagnostic
prompt storage. The old prompt-registry `cache` hints are retired; configure
model profiles instead.

## Provider translation and retention

| Path                                                  | Behavior                                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI GPT-5.6/6 family, direct or through OpenRouter | Explicit breakpoint at the selected stable prefix. Default minimum lifetime is 1,800 seconds; 43,200 seconds selects a 12-hour block override.                              |
| Supported earlier OpenAI GPT-5 family                 | Automatic caching with a stable key; supported profiles can request 86,400-second extended retention. Otherwise use in-memory retention without claiming an exact lifetime. |
| OpenRouter DeepSeek                                   | Automatic provider caching. No invented cache key or retention control is sent.                                                                                             |
| Other provider/model or unsupported setting           | Omit unsupported controls and emit `generation.cache_control_omitted`; continue generation.                                                                                 |

The pinned AI SDK accepts a 30-minute request default; a supported 12-hour
breakpoint overrides that default on its block. Wire conformance tests cover the
normal hosted adapters and the separate structured OpenAI planner transport.
Existing `store: false` and OpenRouter privacy/routing settings remain in force.
Requested cache lifetime is not proof of upstream storage, deletion, or routing.
See [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching),
[OpenRouter caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching),
and [provider retention](provider-retention.md).

## Measurements and economics

Raw provider fields are normalized before SDK placeholders can turn missing
cache reads into zero or discard writes. Attempts retain read/write counts,
reported 30-minute/12-hour write breakdowns, and a text-free request-side cache
receipt. Purpose, surface, and separate hashes of the trusted prompt/schema and selected profile configuration remain available with deliberate controls disabled (`mode: disabled`). Summaries group by these versions without exposing the cache key or profile name. Planner transport fallbacks and context expansion retain each logical provider call separately; SDK-internal wire retries have no independent usage receipt. The receipt describes applied controls, not an observed cache hit.
Its prefix-token count is a character-based approximation, not provider-confirmed
eligibility. Nothing is padded in production to reach a cache threshold.

The public Trace projection derives `workflow.cacheSummary` from canonical
Attempts, using nested routing attempts instead of also adding their parent
totals. Failed executed routes count; skipped routes do not. Coverage counts
accompany partial sums. Hit rate and input-share/write-read ratios are omitted
when their required observations are incomplete. Legacy traces without Attempts
have no inferred measurements. Public receipts omit keys, private profile names,
omission diagnostics, prompts, evidence, and hidden reasoning.

Backend `cacheSavingsUsd` is the uncached price of the same input-token count
minus its cache-adjusted input estimate. It includes writes, can be negative,
and requires complete supported usage/pricing. Modern 30-minute writes cost
1.25 times ordinary input; 12-hour writes cost 2.5 times ordinary input. Missing
positive-write tier details make the estimate partial and withhold savings.
Router-reported charges stay separate. Unknown model pricing never establishes
financial savings, even when cache hits are observed. Output variation and
request latency are separate measurements, not input-cache savings.

## Reproduce the bounded experiment

Run `pnpm cache:probe --check` first. It reads credential availability and pricing
without generating model output. `pnpm cache:probe --live` uses the existing
runtime and prompt composers with synthetic fixtures for planner, generation,
assessment, revision, and presentation, plus long-prefix, changed-suffix, and
invalidation controls. These are adapter/prompt experiments, not full workflow
quality evaluations or production hit-rate measurements.

The allowance is 60 actual wire requests and $2 conservatively estimated spend.
SDK retries reserve from that same allowance before network I/O; unknown rates
or unbounded outputs stop the request. Credentials come from normal process/env
loading and are never printed. Missing credentials leave that provider unverified.

The text-free report is [the checked-in probe evidence](../status/prompt-cache-probe.json).
Re-running live mode resumes its experiment and cumulative allowance, skipping
already recorded cells. Do not delete the checkpoint to bypass the allowance.
It retains raw reported counts, separately attributed router charges, pricing
inputs, latency, failures, and the report writer source digest. Earlier resumed
measurements can predate bookkeeping changes; the recorded commit is the
implementation base, not a claim that an uncommitted candidate was deployed. No prompts or model
responses are written to the report. A transient failed cell remains failed;
later independent cells may still run within the allowance.

#936 can consume these measurements without inventing browser-side accounting.
The Trace layout, production enablement, and unavailable provider verification
remain separate from this implementation.

## Recorded experiment result

The October 27 synthetic experiment used 51 wire requests including retries,
reserving $0.149365 conservatively. OpenRouter produced 23 measured cells and
three failed cells. Direct OpenAI was skipped because its key was unavailable.

Automatic DeepSeek caching reported 768 cached tokens out of 945 planner input
tokens, 1,024 out of 1,051 generation input tokens, and 512 out of 684 assessment
input tokens on warm baseline calls. Short revision and presentation fixtures
reported zero reads. Both long-prefix arms reported 10,752 cached tokens out of
10,781 on warm calls; changing the suffix retained those reads. Changing the end
of the stable reference still reused an earlier partial prefix, as automatic
provider caching permits.

This proves observed automatic cache reuse, including a changed suffix. It does
not prove that Footnote's controls improve spend: DeepSeek receives no explicit
controls, its backend pricing is unknown, two ordinary generation candidate
cells failed, and there is no direct OpenAI live result. Deliberate controls stay
disabled by default. No deployment or production settings were changed.

## Local validation

The implementation was checked on October 27, 2026, with 250 passing focused
checks: 242 runtime/backend/contracts/probe checks, two orchestrator regressions
(including expansion, routed failure, exhausted fallback, and pre-provider
failure scenarios), and six planner-record checks. `pnpm review`,
`pnpm validate-openapi-links`, and the complete `pnpm -r build` passed.
Standards and spec reviews were completed, and the accounting findings were
fixed and re-reviewed.

Broader runs reproduced existing failures on the unchanged main checkout:
five orchestrator cases depend on the locally enabled provider catalog, one
planner-reentry case fails, and one ModelInput fixture assertion fails. Those
unrelated cases remain outside this change. The new native fallback regression
now enables its synthetic profile explicitly rather than relying on credentials.

`pnpm test:build` could not finish: Docker remained at image-building startup,
and a separate bounded Docker version check could not obtain server information.
Container packaging remains unverified. Direct OpenAI live behavior and causal
financial savings also remain unverified; the checked-in experiment is limited
to the synthetic OpenRouter observations above. No production enablement,
publication, or deployment was performed.
