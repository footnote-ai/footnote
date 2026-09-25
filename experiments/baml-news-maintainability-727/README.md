# BAML ordinary typed-function maintainability experiment (#727)

This is an isolated, non-production comparison for the internal `news` typed
model function. It does not change backend code, prompt registry entries,
routing, provider selection, usage/cost recording, cancellation, provenance,
TRACE, or the `/api/internal/text` boundary.

## Question

Does BAML make an ordinary typed model function easier to change and review
when Footnote keeps runtime and product authority?

The BAML side co-locates a `NewsResult` type and `GenerateNewsResponse` prompt.
The current `InternalNewsItem.image` field is intentionally not copied: BAML
0.226.2 treats `image` as a reserved field name. That failed prototype is part
of the result because preserving the public field would require a naming
adapter or a different source contract.
The Footnote side remains the real `createInternalNewsTaskService` path. The
comparison feeds the same raw fixtures to the production service and the
generated BAML parser, without making a provider call.

## Pinned toolchain

- `@boundaryml/baml`: `0.226.2`
- generator version: `0.226.2`
- generated `baml_client/`: ignored and regenerated from `baml_src/`

Run from this directory after installing the isolated package:

```text
pnpm install --frozen-lockfile
pnpm run generate
pnpm exec tsx compare.ts
```

The experiment deliberately does not upgrade BAML. The official docs describe
generated typed clients, `.parse`, `.request`, and version matching; this
experiment uses only `.parse` so Footnote's runtime remains the request owner.

## Scope of the comparison

Fixtures cover valid output, malformed JSON, schema-invalid output, optional
nulls, timestamp normalization, and fenced JSON. The report distinguishes
model-facing declaration changes from the Footnote-owned validation and
normalization that remains necessary.
