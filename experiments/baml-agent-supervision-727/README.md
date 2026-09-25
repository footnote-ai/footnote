# BAML agent-supervision experiment (#727)

This is a non-production A/B harness stacked on the completed #742 evidence.
The representative function is the real internal /news typed result path:

- prompt source: packages/prompts/src/defaults.yaml, key text.news.system;
- backend prompt and request construction: packages/backend/src/services/internalText.ts;
- shared output type/schema: packages/contracts/src/web/types.ts and schemas.ts;
- focused behavior tests: packages/backend/test/internalTextHandler.test.ts and
  packages/contracts/test/webSchemas.test.ts.

It is a reasonable ordinary typed model function because it has a prompt, a
structured output, strict URL/date validation, normalization for weak dates,
provider/runtime execution, usage recording, and replayable tests. It is not
the policy-sensitive ReviewDecision path, and it is bounded enough for
fresh-agent maintenance tasks.

The native-side agents work against the real Footnote files in their isolated
clones. The BAML-side agents work against the parallel source below, which
copies the same output shape and prompt intent without changing production.
No agent's branch is merged.

## BAML-side ownership being tested

BAML owns the model-function declaration, prompt/type co-location, generated
TypeScript client, and BAML-native checks/tests where they help. Footnote
continues to own provider/runtime selection, retries/fallbacks, cancellation,
attempts, usage/cost, workflow state, authorization/policy, strict domain
validation and normalization, provenance, TRACE, and failure semantics.

Generated files are not hand-edited. The pinned experiment toolchain is
@boundaryml/baml 0.226.2; run pnpm generate, pnpm check, pnpm fmt, and
pnpm test -- --list from baml/ when available. The current pinned CLI does
not expose the newer documented agent or describe commands; this difference is
part of the evidence, not an assumption.

## Agent protocol

Each task is run in a fresh isolated clone. Agents receive the same task file.
They must record:

- first-pass result and focused checks;
- meaningful omitted seams or wrong assumptions;
- whether tooling caught and enabled self-correction;
- files inspected and changed;
- any clarification requested;
- review-relevant ambiguity.

They must not edit generated code by hand, call live providers, use secrets,
change production behavior outside their isolated clone, or delegate the task.