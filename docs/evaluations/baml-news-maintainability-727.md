<!--
@description: Evidence record for the isolated BAML ordinary typed-function maintainability experiment.
@footnote-scope: test
@footnote-module: BamlNewsMaintainabilityEvaluation
@footnote-risk: medium - Parser differences can be mistaken for a production contract recommendation.
@footnote-ethics: high - The experiment keeps provider, cost, provenance, and runtime authority in Footnote.
-->

# BAML ordinary typed-function maintainability experiment (#727)

Status: **bounded experiment complete; selective use remains plausible, default
adoption is not justified by this slice**.

Experiment base: `68e1825ac442e5099a7fa2b74418c2d774816ed0`.

BAML: `@boundaryml/baml 0.226.2`, generated TypeScript client, 2026-09-25.

Source: `experiments/baml-news-maintainability-727/`.

Artifact: `artifacts/baml-news-maintainability-727/results.json`.

## Boundary tested

The representative function is the existing backend-owned internal `news`
task. The current path is `createInternalNewsTaskService` in
`packages/backend/src/services/internalText.ts`. The isolated BAML path
declares `NewsResult` and `GenerateNewsResponse` in BAML, generates a client,
and uses only `b.parse.GenerateNewsResponse` over the same raw strings.

No provider call was made. Production code, prompt registry entries, routing,
usage/cost recording, cancellation, provenance, TRACE, and the API boundary
are unchanged.

The pinned version was retained rather than upgraded. The official BAML docs
describe generated typed clients and `.parse`/`.request`; the current docs also
require the generated-client version to match the runtime package:

- <https://docs.boundaryml.com/guide/introduction/baml_client>
- <https://docs.boundaryml.com/ref/baml_client/client>
- <https://docs.boundaryml.com/guide/development/upgrade-baml-versions>

## Fixture result

The six synthetic fixtures were replayed through the actual Footnote service
and generated BAML parser:

| Fixture                        | Footnote | BAML    | Observable difference                                                                                                                  |
| ------------------------------ | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| valid                          | success  | success | Footnote normalizes the timestamp; BAML preserves the raw string and omits the unsupported `image` field.                              |
| malformed JSON                 | error    | error   | Both fail, but BAML exposes a generic coercion/parsing error rather than Footnote's descriptive JSON-object error.                     |
| schema-invalid empty title/URL | error    | success | BAML accepts values that Footnote's URL and non-empty-string schema rejects.                                                           |
| optional nulls                 | success  | success | BAML returns optional fields as `null`; Footnote omits the null timestamp after normalization and preserves its public optional shape. |
| date-only timestamp            | success  | success | Footnote strips the midnight placeholder; BAML preserves `2026-03-18`.                                                                 |
| fenced JSON                    | success  | success | Both recover this wrapper, but that is a behavior of the current news extractor, not evidence that BAML owns the boundary.             |

The BAML model could not declare the current optional `image` field: BAML
0.226.2 rejected `image` as a reserved field name. Renaming it would require
an adapter and would still not preserve the current raw contract automatically.

## Change-surface comparison

| Change                                  | Current Footnote update points                                                       | BAML-side update points                                                                       | What remains                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Add or rename an optional article field | `InternalNewsItem`, `InternalNewsItemSchema`, model JSON instruction, response tests | BAML class, prompt/schema generation, regenerated client; `image` also needs a naming adapter | URL/non-empty validation, normalization, public response compatibility, and tests remain Footnote-owned.                          |
| Change prompt wording                   | prompt registry `text.news.system`, `buildNewsJsonInstruction`, prompt tests         | `functions.baml` prompt and generated client                                                  | Prompt registry ownership and any future operator override still need an explicit bridge; BAML does not delete the registry seam. |
| Add an enum/choice                      | Not present on this function; no enum was invented for the experiment                | Not applicable                                                                                | A future bounded choice would need a real contract change first; this experiment does not claim enum ergonomics.                  |

The current source surfaces are intentionally distributed because they carry
different authority: `internalText.ts` assembles search inputs and timestamp
normalization, the contracts package owns the serializable schema, and the
prompt registry owns the shared prompt. BAML co-locates only the model-facing
shape and one prompt copy; it does not collapse those ownership boundaries.

## Surface accounting

| Surface                                                           |   Measured lines/files | Status                                             |
| ----------------------------------------------------------------- | ---------------------: | -------------------------------------------------- |
| BAML declarations (`types`, `functions`, `clients`, `generators`) |     40 lines / 4 files | Hand-maintained source.                            |
| Generated TypeScript client                                       | 1,048 lines / 14 files | Ignored; regenerated from the pinned source.       |
| Comparison harness                                                |     181 lines / 1 file | New experiment-only code.                          |
| Current backend service                                           |     532 lines / 1 file | Unchanged; still owns execution and normalization. |
| Current response schema/type/prompt/test surfaces                 |                5 files | Unchanged; no source was deleted.                  |

Handwritten code did not disappear. BAML adds a short declaration and a
generated client, while Footnote retains validation, normalization, failure
mapping, prompt-registry ownership, provider/runtime authority, usage/cost,
cancellation, attempt/retry behavior, provenance, TRACE, and the public
response contract.

## Conclusion

BAML is readable for the model-facing declaration and is useful as an isolated
typed parser. It is not a drop-in replacement for this function: it accepted
schema-invalid values, preserved timestamps Footnote deliberately normalizes,
could not represent one public field without a rename, and returned a generic
failure boundary. The smallest honest adoption shape would therefore be
BAML declaration plus a Footnote-owned adapter/validator, which adds rather
than removes a layer in this function.

Adopt for another typed model function only if that function has a stable,
provider-independent model-facing contract and the experiment first shows
that the adapter removes real duplicated policy code. Do not migrate the
production `news` path or the planner/assess paths from this result.
