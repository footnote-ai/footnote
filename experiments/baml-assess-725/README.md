# BAML assess prototype (#725)

This directory is an isolated, non-production prototype. It is not included
in a Footnote package and does not change the backend assess path.

## Pinned toolchain

- BAML CLI and generated runtime: `@boundaryml/baml 0.226.2`
- generator version: `0.226.2` in `baml_src/generators.baml`
- BAML source: `baml_src/types.baml`, `baml_src/functions.baml`, and
  `baml_src/clients.baml`

The generated `baml_client/` directory is intentionally ignored. Regenerate it
from the pinned source instead of treating generated files as the contract:

```text
pnpm --config.enable-global-virtual-store=false dlx --package=@boundaryml/baml@0.226.2 baml-cli generate
```

Run `probe.ts` with the repository's pinned `tsx` binary or an equivalent
TypeScript runner. The probe only parses synthetic outputs and renders an HTTP
request; it does not call a provider. It records header names, never header
values, and should be run with provider credentials unset when inspecting raw
artifacts.

The checked-in raw result is
`artifacts/baml-assess-725/probe-results.json`.
