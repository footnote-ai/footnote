# BAML assess prototype (#725)

This directory is an isolated, non-production prototype. It is not included
in a Footnote package and does not change the backend assess path.

## What this experiment asks

BAML puts an LLM function, its prompt, and its expected typed output in one
place, then generates TypeScript client code. This experiment checks whether
that removes duplicated Footnote maintenance or only adds another layer.

For example, the prototype can parse an object with `tightness: 6` because the
field is numeric. Footnote's current contract rejects that value because its
allowed range is smaller. A successful BAML parse is therefore not enough:
Footnote may still need its own semantic validation and failure classification.

The prototype can prove typed parsing, request rendering, and local
cancellation behavior. The local comparison below exercises one already
installed Ollama model, but it does not prove cloud-provider compatibility,
retries, cost recording, attempt lineage, or TRACE parity. Those remain
Footnote-owned questions.

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

## Live provider comparison

`live-provider-compare.ts` runs three synthetic assess inputs through the
current Footnote runtime and the BAML prototype. Both use the already-installed
local Ollama model `reap48-fixed:latest`. The current runtime keeps Footnote's
structured-output schema and parser; BAML uses its generated client and
collector through Ollama's OpenAI-compatible `/v1` endpoint.

Run it while the local Ollama service is available:

```text
pnpm exec tsx experiments/baml-assess-725/live-provider-compare.ts --local-ollama
```

The saved local artifact is
`artifacts/baml-assess-725/live-ollama-compare.json`. It records fixture-level
success, typed decisions, parser errors, latency, and usage where the runtime
reports it. `parser-replay.ts` feeds the exact captured Footnote JSON strings
through both parsers without making another model call.

Without `--local-ollama`, the same harness runs the preserved cloud comparison
using `openai/gpt-5-mini`. It requires an existing `OPENAI_API_KEY` with
provider credit and is not required to reproduce the local result.

The command is evaluation-only. It does not change routing, retries, cost
recording, cancellation ownership, attempt lineage, or TRACE behavior. Live
provider calls are not part of normal CI.

## Modular parser/request probe

The pinned generated client also exposes:

```text
b.parse.Assess(rawOutput)
b.request.Assess(draft, reviewContext, options)
```

The parser replay uses the exact raw output captured by Footnote and makes no
model call. The request probe builds, but does not send, a BAML `HTTPRequest`.
Its result is provider-bound (`url`, headers, model, messages, and BAML schema
text), so it is not a drop-in replacement for Footnote's provider-neutral
`GenerationRequest`.

```text
pnpm exec tsx experiments/baml-assess-725/parser-replay.ts
pnpm exec tsx experiments/baml-assess-725/request-probe.ts
```

The report concludes that this modular boundary is not enough to justify BAML
adoption: Footnote would still need its current validation, failure mapping,
routing, retry, cost, cancellation, and provenance machinery.
