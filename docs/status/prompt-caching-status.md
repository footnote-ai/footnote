# Prompt caching status

As of October 28, 2026, PR #955 contains the cache policy and measurement work.
The closing-work changes add a smaller paired economic comparison locally.
Deliberate caching remains disabled by default. OpenRouter tests observed
automatic cache reuse; direct OpenAI live behavior and incremental financial
savings remain unverified. The direct OpenAI comparison was attempted on
October 28, but every wire attempt returned HTTP 429 before any usage was reported.

See the [architecture](../architecture/prompt-caching.md) for configuration,
provider controls, measurement semantics, and privacy boundaries. The
[probe evidence](./prompt-cache-probe.json) contains the recorded measurements.
#936 can use the shared data; its Trace layout is separate work.

## Live experiment

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

The experiment confirms automatic cache reuse, including a changed suffix.
It does not establish savings from Footnote's controls: DeepSeek receives no
explicit controls, its backend pricing is unknown, two ordinary generation candidate
cells failed, and there is no direct OpenAI live result. Deliberate controls stay
disabled by default. No deployment or production settings were changed.

## Local validation

The October 27 provenance follow-up adds a separate provider-call outcome to
routing records, excludes routes explicitly marked `not_called` from cache
summaries, and groups measurements by actual provider/model attribution when
available. This follow-up preserves the existing route status and cache-key
identities. The focused cache/routing/trace tests passed (29), workflow-record
tests passed (30), and the two targeted planner fallback regressions passed.
Contracts and backend builds, OpenAPI link validation, formatting, and
`pnpm review --changed-only` also passed.

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

## Outstanding verification

The follow-up retry of `pnpm test:build` remained at `Image footnote:dev-local
Building` without further output. A separate `docker version` check also returned
no output after about 39 seconds. Both commands were interrupted; container
packaging remains unverified. Direct OpenAI live behavior and causal financial
savings also remain unverified; the checked-in experiment is limited to the
synthetic OpenRouter observations above. No production enablement, publication,
or deployment was performed.

The October 27 PR follow-up retry again found no Docker server response, and
`pnpm test:build` remained at image building without further output before it
was interrupted. Compose packaging is still unverified. The planner accounting,
prompt-layer, and Git preflight regression tests pass; `pnpm review
--changed-only` reports no errors or warnings. A full rerun of the focused test
files did not finish in this session, so full-file status remains unverified.

## Paired economic comparison

The original [51-request experiment](./prompt-cache-probe.json), its metadata,
pricing snapshot, and allowance are immutable. Its SHA-256 in this checkout is
`dee1239dce2c5e083fadf2877676419e164e6232e2f50557bbeac7343f490a12`.
The current probe never writes that path and verifies its digest before running.
The old `upstreamReportedCostUsd` field came from OpenRouter `usage.cost`, which
is a router-reported account charge, not separately verified upstream cost.
This clarification does not change or relabel the archived artifact.

The new [comparison report](./prompt-cache-comparison.json) has its own experiment
identity, source digest, and allowance. Direct credentials were unavailable during
the October 27 preflight, which made no requests and reserved no spend. On October
28, the operator supplied a credential and explicitly authorized continuation of
that unspent checkpoint. The credential was loaded only into process memory;
it was not copied into the repository or recorded in artifacts.

The first automatic-arm cold request produced four actual wire attempts,
including SDK retries. All four returned **HTTP 429**, with no model or usage
receipt. The probe stopped before the deliberate-arm cold request. It retained
**$0.0145212 in conservative reservations**, not a measured charge, against the
16-request/$0.15 allowance. Actual provider charges remain unknown because usage
was absent. The original 51-request artifact's SHA-256 remains unchanged.

This result is **inconclusive: provider rejected the first request**, not a
negative caching result. No cache eligibility, reads, writes, latency comparison,
or incremental savings were measured. The checkpoint is now spent/terminal and
must not be reset or replayed. HTTP 429 alone does not establish whether quota or
rate limits caused the rejection; no specific cause was recorded. Provider
readiness and a separately authorized experiment are needed for another attempt.
Do not close #552's economic acceptance criterion on this evidence.

The fixed experiment uses direct `gpt-5.6-luna` and six matched pairs: both cold
requests, both exact repeats, then four matching changed-suffix requests. Automatic
goes first in even-numbered pairs (starting at zero); deliberate goes first in odd
pairs. The two existing Discord shared-system/persona layers supply approximately
6.4 KB of real reusable instructions. There is no repeated filler or production
prompt change. Distinct `A`/`B` experiment markers appear at the very beginning and
stay fixed within each arm. A fixed synthetic clock and user suffix follow the
stable prefix. All other request material and model settings match.

Both arms use identical adapter serialization. The automatic arm removes cache
controls at the existing probe fetch boundary; the treatment retains the real
Footnote key and explicit 30-minute breakpoint after the persona. Text-free wire
hashes verify equivalent matched requests and stable, distinct prefixes. This
isolates controls rather than comparing different prompt-building paths.

The maximum is **12 planned calls, 16 actual wire requests including retries,
and $0.15 conservatively reserved**. Output is bounded at 64 tokens; serialized
requests are bounded at 12 KB. Every attempt reserves and persists before network
I/O, under an exclusive file lock. Failed persistence prevents dispatch. Unknown
pricing, unexpected endpoints/models, and changed source provenance stop the run.
An interrupted or spent experiment is terminal; the probe refuses to replay it.
A stale lock requires manual reconciliation, not automatic removal. Never delete
or modify an artifact to reset an allowance. Only a zero-reservation checkpoint
with matching source provenance may be retried.

Run `pnpm cache:probe --check` for credential availability and bounds without a
model call. Before a paid run, verify the model's ordinary/read/output prices and
30-minute write multiplier against the linked provider documentation. The current
approved rates per million tokens are $0.20/$0.02/$1.20, with 1.25x total write
pricing. The old checked-in Luna tariff was half those rates and is corrected in
the closing-work changes; the historical experiment's snapshot remains unchanged.

After explicit spending authorization and verification, run:

```text
pnpm cache:probe --live --pricing-verified-at=<ISO-8601-UTC-time>
```

The timestamp attests that the operator checked the sources, not that the probe
fetched them. It must be less than 15 minutes old. The probe also checks that the
table matches the authorized rates; changed rates require review before spending.
Credentials use normal environment loading and are never printed. There is no
automatic router fallback.

The primary result is automatic input cost minus deliberate input cost summed
over all six requests, including cold and subsequent writes. It is positive only
if treatment is cheaper, otherwise `no_improvement`. Missing raw usage or write
tiers, inconsistent/missing returned models, SDK receipt discrepancies, retries,
unexpected cold reads, unmatched input counts, insufficient prefix eligibility,
or invalid output make the result inconclusive. Provider-reported raw receipts
must support the accounting; requested settings and SDK fallbacks are not proof.

The report separates input costs, output costs, actual total-cost difference,
and the equal-output comparison. Backend `cacheSavingsUsd` remains a theoretical
uncached-input comparison, not incremental savings. These are usage-priced
estimates under verified tariffs, not reconciled invoice charges. Latency is
recorded without a performance claim. Any result applies only to this six-request
reuse pattern. Negative evidence is useful and the policy stays disabled.

Longer retention, repeated blocks, invalidation, production effectiveness, other
purposes/models, and routed billing reconciliation are follow-up work. Public
Trace visualization stays with #936.

## Closing-work validation

Comparison `cee0637d-699b-472d-8e49-aca3fda12bbb` recorded the credential-blocked
preflight on October 27, 2026 (local time), with zero requests/reservations. On
October 28, pricing was verified again immediately before the authorized live
attempt. The same checkpoint now records four HTTP 429 responses, one failed
logical sample, $0.0145212 reserved, and no model measurements. The CLI exited
successfully after persisting the inconclusive report; that exit status is not
evidence of a successful provider generation.

The closing-work focused run passed all 48 checks:

```text
pnpm exec tsx --test scripts/cache-probe.test.ts packages/contracts/test/pricing.test.ts packages/contracts/test/promptCachePricing.test.ts packages/agent-runtime/test/promptCaching.test.ts packages/backend/test/promptCaching.test.ts packages/backend/test/llmCostRecorder.test.ts
```

`pnpm exec tsc --noEmit --pretty false`, builds for contracts, agent-runtime and
backend, formatting, and `pnpm review --changed-only` passed. Standards/spec
reviews identified model consistency and raw-receipt attribution gaps; both were
corrected and regression-covered. A held checkpoint lock also rejected a second
actual CLI invocation without creating a report or making a provider request.

OpenAPI link validation passed. Bundle freshness initially failed on unchanged
inputs because the generated health-description wrapping differed from the
source bundler's output. Regeneration changed only those two description lines;
no source contract or endpoint changed.

The October 28 Docker server check timed out after 15 seconds with no output;
only that check process was stopped, and no local Compose build was started.
CI's successful server-image build is useful separate
evidence, but does not complete `pnpm test:build`'s local Compose/runtime-image
check. The seven documented broader baseline failures were not rerun in this
closing-work pass. No deployment or production cache enablement was performed.

## Closeout and deferred checks

PR #955 delivers caching infrastructure, accounting, and measurement capability.
It does not prove incremental financial savings. Deliberate caching remains
disabled by default. The economic acceptance criterion in #552 remains open and
is assigned to [Verify prompt caching savings](https://github.com/footnote-ai/footnote/issues/957).

No complete direct OpenAI two-arm experiment was completed. The October 27
missing-key preflight made zero requests and reserved $0; a later credentialed
attempt on October 28 made four wire requests, all HTTP 429, and reserved
$0.0145212 conservatively. No usage or model receipt was returned, so actual
charges are unknown. This closeout made no provider requests. The original
51-request experiment and its provenance remain unchanged.

The local Compose/runtime-image verification remains unverified and is tracked
in [Verify local Compose packaging build](https://github.com/footnote-ai/footnote/issues/958).
CI's Docker image build did not execute `pnpm test:build`'s in-container context
check.
