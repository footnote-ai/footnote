<!--
@description: Offline semantic-difference matrix for Footnote assess parsing and the pinned BAML prototype.
@footnote-scope: test
@footnote-module: BamlAssessSemanticEquivalenceReport
@footnote-risk: high - Parser differences can change workflow admission and fail-open behavior.
@footnote-ethics: high - The matrix uses synthetic outputs and keeps provider and private-content boundaries explicit.
-->

# BAML assess semantic-equivalence matrix (#726)

Status: **offline text matrix complete; live provider-path comparison remains
unresolved**.

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
```
