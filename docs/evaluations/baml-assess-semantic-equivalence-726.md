<!--
@description: Offline semantic-difference matrix for Footnote assess parsing and the pinned BAML prototype.
@footnote-scope: test
@footnote-module: BamlAssessSemanticEquivalenceReport
@footnote-risk: high - Parser differences can change workflow admission and fail-open behavior.
@footnote-ethics: high - The matrix uses synthetic outputs and keeps provider and private-content boundaries explicit.
-->

# BAML assess semantic-equivalence matrix (#726)

Status: **local Ollama comparison complete; cloud provider-path comparison
remains unresolved**.

## Scope and toolchain

The matrix feeds identical synthetic output fixtures to:

- the current Footnote `parseReviewDecisionOutputResult` parser; and
- the generated BAML TypeScript parser from `@boundaryml/baml 0.226.2`.

It covers success, optional fields, maximum shape, empty/malformed/invalid
JSON, invalid enums and primitives, unexpected structure, incomplete objects,
refusals, fenced/prose/multiple-object recovery, null/number coercion, enum
casing, nested shape errors, conditional `ReviewDecision` rules, and explicit
provider-failure rows. Provider-failure rows are intentionally `not_run`; a
text parser cannot prove transport, finish-reason, retry, usage, cost, or
attempt-lineage behavior.

Raw matrix: `artifacts/baml-assess-725/semantic-equivalence.json`.

## Local Ollama comparison

The same three synthetic fixtures were sent through both paths using the
already-installed local Ollama model `reap48-fixed:latest`:

- existing Footnote runtime: `ollama/reap48-fixed:latest`, with Footnote's
  normal runtime request construction and current parser;
- BAML prototype: BAML `0.226.2`, using its `openai-generic` client pointed at
  Ollama's local `/v1` endpoint.

This answers the narrower question “can both paths return typed assess values
when cloud-provider quota is removed?” It does **not** prove that their
prompts, runtime metadata, or policy behavior are equivalent.

| Fixture            | Footnote path       | BAML path             | Comparison                                                                 |
| ------------------ | ------------------- | --------------------- | -------------------------------------------------------------------------- |
| `ready_finalize`   | `finalize`          | `finalize`            | Same decision, but optional fields were populated differently.             |
| `missing_caveat`   | `revise`            | `revise`              | Same decision, but trace alignment and guidance fields differed.           |
| `bounded_revision` | success: `finalize` | `BamlValidationError` | BAML failed while evaluating a conditional assertion on an optional value. |

The first two calls show that BAML can produce typed values from this local
model, but they are not structurally equivalent to the current Footnote
results. The third call is a policy-relevant failure: the existing path
returned a decision while BAML returned an assertion-evaluation error.

The local run also replayed each captured Footnote JSON string through both
parsers. All three replayed strings parsed successfully in both parsers. That
smaller result is positive parser compatibility evidence, but it does not fix
the live-output differences or prove that BAML will preserve model omissions,
normalization, and conditional validation.

Raw artifacts:

- `artifacts/baml-assess-725/live-ollama-compare.json`
- `artifacts/baml-assess-725/local-parser-replay.json`

The local run used the existing machine-local Ollama service and added no
runtime dependency to Footnote.

## Cloud provider attempt

The live comparison harness ran three synthetic assess inputs through both
paths:

- existing Footnote runtime: provider `openai`, model `gpt-5-mini`, using the
  current native structured-output schema and parser;
- BAML prototype: the pinned `@boundaryml/baml 0.226.2` client using its
  `openai-responses` client and the same model.

The provider rejected all six requests with HTTP 429
`insufficient_quota` (`You have no credits remaining`). This is a real provider
availability result, not a parser result. The run produced no successful model
output, token usage, cost, or successful latency comparison.

The failure wrappers differed:

| Path                      | Observed failure                                                                         | What this proves                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Existing Footnote runtime | `GenerationRuntimeError` with the provider message                                       | The current runtime reaches the provider and exposes a provider/runtime error to Footnote.                                 |
| BAML prototype            | `BamlClientHttpError` wrapped in `BamlError`, with `openai-responses` collector metadata | BAML reaches the provider, but exposes its own error boundary and does not produce Footnote's attempt or failure envelope. |

This does not establish behavioral equivalence. It does establish that the
prototype uses a separate provider client rather than reusing Footnote's
routing/runtime path. A funded repeat would still need the same fixture set,
successful outputs, usage/cost facts, refusal or incomplete-response cases,
and comparison of retry and attempt records.

Raw sanitized artifact: `artifacts/baml-assess-725/live-provider-compare.json`.
The artifact contains synthetic inputs and provider error messages only. The
run did not include private conversation content.

## Difference matrix

| Case                                                       | Footnote                                  | BAML                                  | Recovery or loss                            | Policy significance                                                      |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| valid finalize/revise/optional/max shape                   | success                                   | success                               | equivalent                                  | Basic typed shape is compatible.                                         |
| empty output                                               | `empty_output`                            | generic `BamlError`                   | failure taxonomy lost                       | Empty output must remain distinct.                                       |
| malformed or invalid JSON                                  | `non_json_object` / `invalid_json`        | generic `BamlError`                   | taxonomy lost                               | Syntax and object-shape failures are not preserved.                      |
| non-object JSON                                            | `non_json_object`                         | generic `BamlError`                   | taxonomy lost                               | Must not be treated as a provider/runtime failure.                       |
| invalid enum                                               | `schema_invalid`                          | generic `BamlError`                   | issue path/code lost                        | Unknown decisions must not enter normalization.                          |
| wrong primitive type                                       | `schema_invalid`                          | success with coerced string           | extra recovery                              | BAML accepted `42` as `"42"`; this changes strict policy semantics.      |
| unexpected nested structure                                | success via passthrough                   | success with omission                 | semantics differ                            | Adapter must define whether unknown fields are retained or dropped.      |
| incomplete object/refusal                                  | `schema_invalid` / `non_json_object`      | generic `BamlError`                   | taxonomy lost                               | Refusal and incomplete output need runtime-aware classification.         |
| fenced JSON                                                | `non_json_object`                         | success                               | extra recovery                              | Adoption would change compatibility behavior.                            |
| incomplete revise                                          | `schema_invalid` at `revisionInstruction` | `BamlError` from assertion evaluation | conditional rule is not cleanly represented | The current contract's field dependency remains Footnote-significant.    |
| misaligned without reason/temperament                      | `schema_invalid`                          | `BamlError` from assertion evaluation | conditional rule is not cleanly represented | Optional null handling produced an evaluation error.                     |
| misaligned without temperament                             | `schema_invalid`                          | `BamlError` from assertion evaluation | conditional rule is not cleanly represented | The error is not Footnote's bounded failure envelope.                    |
| invalid temperament axis                                   | `schema_invalid`                          | success with `tightness: 6`           | range validation lost                       | BAML primitive type alone does not preserve 1–5 bounds.                  |
| numeric string temperament                                 | `schema_invalid`                          | success with `tightness: 3`           | primitive coercion and original lexeme lost | A post-parse validator sees `3`, not the rejected string input.          |
| negative temperament axis                                  | `schema_invalid`                          | success with `tightness: -1`          | range validation recoverable                | A Footnote-owned validator can still reject the parsed number.           |
| invalid nested concern enum                                | `schema_invalid`                          | success with concerns omitted         | nested validation/recovery differs          | BAML accepted a malformed nested object instead of preserving the issue. |
| fenced/prose/multiple JSON                                 | `non_json_object` / `invalid_json`        | success                               | extra recovery                              | BAML's forgiving parser changes the current compatibility boundary.      |
| null optional revise field                                 | `schema_invalid`                          | generic `BamlError` from assertion    | assertion evaluation error                  | Null handling is not a Footnote-equivalent conditional failure envelope. |
| unsupported/incomplete/transport/runtime provider failures | outside parser                            | `not_run`                             | unresolved                                  | Requires live provider-path fixtures and Footnote attempt metadata.      |

The detailed artifact records 33 rows, including exact BAML error detail where
available, the parsed value for permissive recoveries, and a second
Footnote-parser pass over successful BAML values. Four provider rows remain
explicitly unresolved rather than being counted as parser parity.

## Conditional validation investigation

The prototype adds three BAML block assertions:

- `revision_instruction_when_revising`;
- `trace_reason_when_misaligned`; and
- `temperament_when_misaligned`.

Current BAML documentation supports block `@@assert` expressions that can
reference fields on `this`, including cross-field conditions, and `@check`
expressions that preserve values while exposing non-throwing check results.
The experiment confirmed that assertions can reject the tested
conditional-invalid inputs, but optional `null` values caused
assertion-evaluation errors rather than a clean Footnote-equivalent validation
result. The generated client still emits generic BAML errors, not
`ReviewDecisionParseFailure` values. BAML also did not preserve Footnote's
primitive range, primitive-type, or nested-enum behavior in these fixtures.

The official error-handling documentation describes the parser as forgiving,
including recovery from minor formatting or thought-token noise. The current
documentation and the pinned `0.226.2` TypeScript runtime expose assertions,
checks, and generic `BamlValidationError`/`BamlError` boundaries, but no
parser-wide strict/coercion switch was located. Field assertions can reject a
coerced value such as `6` or `-1`; they cannot recover that the original input
was the string `"3"`, or that a fenced/prose wrapper was rejected by Footnote.

References checked on 2026-09-22:

- <https://docs.boundaryml.com/guide/baml-advanced/checks-and-asserts>
- <https://docs.boundaryml.com/ref/attributes/jinja-in-attributes>
- <https://docs.boundaryml.com/guide/baml-basics/error-handling>
- <https://docs.boundaryml.com/ref/baml_client/errors/overview>

This means “BAML parse + Footnote semantic validator” is technically possible.
The layered probe demonstrates a split result: a Footnote validator recovers
the negative-range failure, but cannot recover information BAML already
coerced, omitted, or recovered. The experiment therefore has not shown that
the layered stack removes substantial independently maintained semantics.

## Remaining custom surface

The offline matrix does not justify deleting current Footnote machinery. The
Footnote side still owns or would need to own:

- failure taxonomy and output envelopes;
- strict primitive/range/nested validation;
- conditional semantic validation and normalization;
- refusal/incomplete/finish-reason classification;
- provider capability and transport failures;
- attempt lineage, retries/fallbacks, usage, cost, cancellation, and TRACE.

The BAML source is shorter, but the matrix shows that cosmetic source-line
reduction is not semantic duplication removal. #727 remains unresolved.

## Adapter burden and client ownership

The local run did not require a custom transport adapter for BAML: its
`openai-generic` client called Ollama directly. That is also the problem for
production adoption. BAML owned a second provider client rather than using
Footnote's runtime boundary. Preserving current behavior would still require
Footnote-owned wrappers or coordination for:

- routing and provider/model identity;
- attempt records, retry lineage, and cancellation;
- usage and cost authority;
- translation into Footnote's failure taxonomy;
- trace and provenance metadata;
- strict and conditional semantic validation.

The prototype therefore replaces some declaration and parse authoring, but it
does not replace Footnote's assess runtime semantics. No clearly removable
Footnote parser, validator, provider adapter, or failure classifier has been
demonstrated yet.

### Why not keep both?

Adding BAML without deleting anything would leave Footnote maintaining the old
schema, parser, validator, failure classifier, and provider compatibility code
alongside BAML and its generated client. That would increase the number of
places a contract change can drift. The experiment only counts as a win if the
typed BAML layer lets Footnote remove enough duplicated work while preserving
the policy-sensitive distinctions above.

## Maintenance-surface and contract-change audit

The report records measured line counts from this checkout and a modeled
contract-change exercise. They are maintenance indicators, not a claim that
all lines are equally complex:

| Concern                                                 | Current Footnote |                     BAML + Footnote prototype |
| ------------------------------------------------------- | ---------------: | --------------------------------------------: |
| Hand-maintained contract/parser file                    |        383 lines |                         BAML source: 68 lines |
| Compatibility tests                                     |        132 lines |     Equivalence/adapter tests remain required |
| Generated code                                          |             none |                        1,077 TypeScript lines |
| Modeled independent semantic update points              |                6 | 5, plus regeneration and provider integration |
| Failure taxonomy, normalization, conditional validation |   Footnote-owned |                   Footnote-owned; not deleted |

The modeled change adds a `reviewConfidence` integer constrained to `1..5`
and required only for `revise`. The current path updates the contract/schema,
structured-output schema, prompt, normalizer/conditional validation,
failure-classification assertions, and compatibility fixtures. The BAML path
updates the BAML class/assertion, regenerates the client, updates the
Footnote adapter/semantic validator and failure mapping, checks any provider
schema integration, and updates fixtures. This is a change in declaration
location, not proof that the policy-sensitive update burden disappeared.

## Reproduction

```text
pnpm --config.enable-global-virtual-store=false dlx --package=@boundaryml/baml@0.226.2 baml-cli generate --from experiments/baml-assess-725
pnpm exec tsx --test experiments/baml-assess-725/offline-equivalence.test.ts
pnpm exec tsx experiments/baml-assess-725/offline-equivalence.ts
pnpm exec tsx experiments/baml-assess-725/live-provider-compare.ts --local-ollama
pnpm exec tsx experiments/baml-assess-725/parser-replay.ts
```

The `--local-ollama` comparison uses the local Ollama model named above and
does not run in normal CI. Without that flag, the same harness runs the older
cloud comparison and requires an existing `OPENAI_API_KEY` with provider
credit. Keep both comparisons separate from Footnote production routing.
