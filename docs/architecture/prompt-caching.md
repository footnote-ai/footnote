# Prompt caching

Footnote observes provider prompt-cache usage independently of whether deliberate
cache controls are enabled. Cached tokens are part of input usage. They are not
tokens avoided, and a missing cache field is not a measured zero.

See [prompt caching status](../status/prompt-caching-status.md) for experiment
results, validation, and outstanding checks.

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
receipt. The receipt describes applied controls, not an observed cache hit.
Its prefix-token count is a character-based approximation, not provider-confirmed
eligibility. Production prompts are never padded to reach a cache threshold.

Purpose, surface, and hashes of the trusted prompt/schema and selected profile
configuration remain available when deliberate controls are disabled
(`mode: disabled`). Summaries group by these versions without exposing cache keys
or profile names.

Planner transport fallbacks and context expansion retain each logical provider
call separately. SDK-internal wire retries have no independent usage receipt.

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

These measurements are available for #936 to display. The backend owns the
accounting; the Trace UI displays its results. Trace layout and production
enablement are outside this implementation.
