# Prompt caching status

As of October 27, 2026, the #552 implementation is committed locally. Deliberate
caching remains disabled by default. OpenRouter tests observed automatic cache
reuse; direct OpenAI live behavior and financial savings remain unverified.

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

`pnpm test:build` could not finish: Docker remained at image-building startup,
and a separate bounded Docker version check could not obtain server information.
Container packaging remains unverified. Direct OpenAI live behavior and causal
financial savings also remain unverified; the checked-in experiment is limited
to the synthetic OpenRouter observations above. No production enablement,
publication, or deployment was performed.

## Reproduce the bounded experiment

Run `pnpm cache:probe --check` first. It reads credential availability and pricing
without generating model output. `pnpm cache:probe --live` uses the existing
runtime and prompt composers with synthetic fixtures for planner, generation,
assessment, revision, and presentation, plus long-prefix, changed-suffix, and
invalidation controls. These are adapter/prompt experiments, not full workflow
quality evaluations or production hit-rate measurements.

The probe enforces a limit of 60 actual wire requests and $2 conservatively
estimated spend. The checkpoint already includes the recorded experiment.
SDK retries reserve from that same allowance before network I/O; unknown rates
or unbounded outputs stop the request. Credentials come from normal process/env
loading and are never printed. Missing credentials leave that provider unverified.

The text-free report is [the checked-in probe evidence](./prompt-cache-probe.json).
Re-running live mode resumes its experiment and cumulative allowance, skipping
already recorded cells. Do not delete the checkpoint to bypass the allowance.
It retains raw reported counts, separately attributed router charges, pricing
inputs, latency, failures, and the report writer source digest. The recorded
commit identifies the implementation base. Earlier resumed measurements can
predate bookkeeping changes. The report contains no prompts or model responses. A transient failed cell remains failed;
later independent cells may still run within the allowance.
