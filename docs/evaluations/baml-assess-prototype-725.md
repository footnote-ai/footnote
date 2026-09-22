<!--
@description: Evidence record for the isolated BAML assess-contract prototype.
@footnote-scope: test
@footnote-module: BamlAssessPrototypeReport
@footnote-risk: medium - Prototype results can influence typed-output architecture decisions.
@footnote-ethics: high - The harness must not move routing, cost, provenance, or workflow authority into BAML.
-->

# BAML assess-contract prototype (#725)

Status: **prototype complete; production adoption not recommended from this
slice alone**.

Run date: 2026-09-22

Base: `origin/main` at the experiment's starting revision

BAML: `@boundaryml/baml 0.226.2`

Raw artifact: `artifacts/baml-assess-725/probe-results.json`

## What was prototyped

The isolated harness expresses the current `ReviewDecision` shape as one BAML
function and generates a TypeScript client. It exercises generated parsing,
typed output, request rendering, and pre-aborted cancellation without a
provider call. The BAML client/runtime is not installed in the Footnote
workspace and the production assess path is unchanged.

The prototype preserves the existing fields, including TRACE alignment,
temperament, module hints, concerns, and routing hints. It does not model
Footnote workflow admission, routing chains, retries/fallbacks, cost
accounting, usage authority, cancellation ownership, or canonical TRACE.

## Failure and contract comparison

| Fixture                    | Current Footnote parser                     | BAML 0.226.2 result                          | Finding                                                                  |
| -------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Valid finalize/revise      | typed result                                | typed result                                 | parity for basic shape                                                   |
| Malformed JSON             | `invalid_json`                              | generic `BamlError`                          | failure taxonomy is not preserved automatically                          |
| Non-object JSON            | `non_json_object`                           | generic `BamlError`                          | mapping layer still required                                             |
| Unexpected enum            | `schema_invalid` with issue path/code       | generic `BamlError`                          | BAML validates the enum but does not provide Footnote's result envelope  |
| Missing revise instruction | `schema_invalid` via conditional refinement | **parsed** as `revise` with null instruction | current contract semantics are not expressible by this direct type alone |
| Refusal text               | `non_json_object`                           | generic `BamlError`                          | refusal classification still needs an adapter/policy boundary            |
| Markdown-fenced JSON       | current parser rejects non-object wrapper   | parsed                                       | BAML is more permissive, so adoption could change behavior               |
| Unexpected extra field     | passthrough then normalized away            | parsed then omitted                          | similar visible result, different parser semantics                       |
| Pre-aborted cancellation   | outside parser; workflow-owned              | `BamlAbortError`                             | BAML exposes a cancellation mechanism, but ownership remains Footnote's  |

The BAML parser's permissiveness is not automatically a compatibility win. In
particular, accepting an incomplete `revise` decision would weaken the current
bounded workflow contract unless Footnote retains a post-parse validation and
normalization layer.

The follow-on offline matrix in
`docs/evaluations/baml-assess-semantic-equivalence-726.md` adds BAML block
assertions for the conditional `revise` and `misaligned` rules. Those
assertions reject the tested invalid cases, but optional `null` values produce
assertion-evaluation errors rather than the current Footnote failure envelope.
The matrix also finds permissive coercion of a numeric `reviewReason`, an
out-of-range temperament axis, and a malformed nested concern object. These
are semantic differences, not cleanup opportunities.

## Request rendering

The generated request builder produced a synthetic OpenAI Responses request
with model `gpt-5-mini`, a system prompt containing BAML's rendered schema, and
the synthetic draft/context. The raw artifact records the request body and
header names only; it does not retain header values. This confirms that BAML
can render a typed prompt/schema pair, but it also shows that prompt text and
provider transport details are coupled to generated clients.

No usage, provider response metadata, cost, attempt identity, routing-chain
fallback, or Footnote TRACE facts were observed because no provider call was
made. Those facts therefore remain unresolved and must not be delegated to
BAML by inference.

## Complexity accounting

Measured line counts for this prototype run:

| Layer                                                       | Lines | Interpretation                                                           |
| ----------------------------------------------------------- | ----: | ------------------------------------------------------------------------ |
| Current `reviewDecision.ts`                                 |   401 | hand-maintained prompt, schema, normalizer, parser, and failure envelope |
| Current parser tests                                        |   153 | existing hand-maintained compatibility coverage                          |
| BAML source (`types`, `functions`, `clients`, `generators`) |    76 | hand-maintained typed function/prompt/client declarations                |
| Prototype probe and manifest                                |   114 | hand-maintained harness/tooling                                          |
| Generated TypeScript client                                 | 1,273 | generated dependency/build surface; not hand-maintained                  |

The BAML source is shorter than the current contract file, but the generated
client and runtime dependency are substantial. The follow-on 33-row matrix
also shows that the existing parser or an equivalent Footnote-owned layer is
still needed for conditional validation, Footnote-specific failure taxonomy,
normalization, routing, and provenance mapping. No current Footnote source can
be deleted safely from this evidence.

## Recommendation for #725

The prototype proves that BAML can co-locate a prompt and a basic typed output,
generate TypeScript types, parse some malformed/fenced output, render a request,
and surface cancellation. It does **not** prove deletion or meaningful
simplification of the Footnote assess machinery. The negative result is
successful evidence for the next gate:

- keep production assess unchanged;
- do not migrate planner or remove `reviewDecision.ts`;
- proceed to #726 only with a narrow provider-path comparison;
- compare BAML's transport/parser behavior against Footnote's OpenAI,
  OpenRouter/OpenAI-compatible, local, fallback, refusal, and failure paths;
- require Footnote-owned post-parse validation if the provider comparison ever
  supports adoption.

## Reproduction

```text
pnpm --config.enable-global-virtual-store=false dlx --package=@boundaryml/baml@0.226.2 baml-cli generate
node <pinned-tsx>/dist/cli.mjs probe.ts
```

The generation command writes ignored `baml_client/` output. The raw probe
artifact is committed separately from generated code so the experiment remains
reviewable without making generated files a new Footnote source of truth.
