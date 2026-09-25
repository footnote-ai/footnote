# BAML agent-supervision experiment (#727)

## Why we ran this

PR #742 tested the implementation surface of the policy-sensitive ReviewDecision path. It found that BAML did not remove enough strict Footnote validation and runtime machinery there.

This experiment asks a different question:

> Does BAML materially reduce the human supervision cost of agentic development for typed model functions?

The target cost is context reconstruction, missed related seams, correction rounds, handoff failures, and review burden for a solo developer supervising Codex. Generated line count is not the primary measure.

## What we compared

The representative function was Footnote's internal /news structured result path.

It is a reasonable ordinary typed model function because it has:

- a real prompt in packages/prompts/src/defaults.yaml;
- backend request construction and normalization in packages/backend/src/services/internalText.ts;
- a shared TypeScript type and strict Zod schema in packages/contracts;
- provider-independent tests;
- meaningful but bounded drift risk around URLs, timestamps, optional fields, and article metadata;
- runtime, usage, and failure behavior that must remain Footnote-owned.

It is not the ReviewDecision path and does not carry the same policy sensitivity.

The native arm used the real Footnote source in isolated worktrees. The BAML arm used experiments/baml-agent-supervision-727/baml, a non-production copy of the same model-facing result shape. No production code was migrated.

The BAML arm was asked to own the function declaration, prompt/type co-location, generated TypeScript client, and BAML checks/tests where useful. Footnote remained responsible for provider/runtime selection, retries and fallbacks, cancellation, attempts, usage/cost, workflow state, authorization and policy, strict domain validation and normalization, provenance, TRACE, and failure semantics.

The pinned fixture had to call the Footnote image field imageUrl because BAML 0.226.2 reports image as a reserved language keyword. A real integration would need an explicit mapping for that field.

## Toolchain verification

The existing experiment and this harness pin @boundaryml/baml at 0.226.2. On 2026-09-25, pnpm view @boundaryml/baml version also returned 0.226.2.

The pinned CLI reported:

- baml-cli --version: 0.226.2;
- baml check: available and passed on the clean fixture;
- baml fmt: available; dry-run formatting was exercised;
- baml generate: available and generated 14 ignored client files from the clean fixture;
- baml test --list: available and reported zero tests on the clean fixture;
- baml agent --help: unsupported by the pinned CLI;
- baml describe --help: unsupported by the pinned CLI.

The current official BAML repository and canary documentation advertise baml agent install for supported coding agents and baml describe for inspecting definitions. That is useful paved-road evidence, but it was not available in the pinned npm toolchain used by this repository. The published tool and the current canary guidance therefore need version alignment before an adoption decision.

Relevant official sources:

- [BAML repository](https://github.com/BoundaryML/baml)
- [BAML coding-agent guidance](https://github.com/BoundaryML/baml/blob/canary/typescript2/app-developer-docs/content/baml/get-started.mdx)
- [generate](https://docs.boundaryml.com/ref/baml-cli/generate)
- [fmt](https://docs.boundaryml.com/ref/baml-cli/fmt)
- [test](https://docs.boundaryml.com/ref/baml-cli/test)
- [BAML tests](https://docs.boundaryml.com/ref/baml/test)
- [TypeScript/editor support](https://docs.boundaryml.com/guide/installation-editors/vs-code-extension)
- [generated client and source-of-truth guidance](https://docs.boundaryml.com/guide/baml-basics/prompting-with-baml)

The clean fixture was checked with the pinned CLI. Several fresh worktrees could not run the same commands because pnpm attempted to fetch a managed version whose registry signature could not be verified, or stalled before starting. Those are recorded as environment/tooling blockers, not as successful checks.

## Maintenance tasks

Each task was started in a fresh Luna high-reasoning Codex thread. Agents were kept in separate native or BAML worktrees and were not given the other arm's implementation.

| Task                     | Native observations                                                                                                                                                                                                                                                                | BAML observations                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: optional publisherUrl | The native handoff agent found the shared type, Zod schema, prompt, OpenAPI, backend test, and Discord local type. The actual diff required several files. An earlier native agent also found the same spread. Focused tests were blocked by the missing/stalled pnpm environment. | The BAML task changed one model-function source. The fresh BAML handoff agent found NewsItem as the source of truth, added the optional field and prompt guidance, and corrected an initial newline/edit mistake. It did not have a generated client or strict validator to update. Pinned checks were blocked in that worktree.  |
| B: bounded coverageKind  | The native agent added the enum to the shared contract/schema, prompt, and tests. Its diff covered the expected native seams.                                                                                                                                                      | The BAML agent wrote an enum and a BAML test, but used lowercase enum values and a test form rejected by the pinned CLI. Running the pinned baml check caught both classes of error before human review. The agent did not complete a self-correction before the package-manager blocker stopped it.                              |
| C: prompt-only change    | The completed native agent changed the shared prompt and one existing request assertion. It did not touch the result contract.                                                                                                                                                     | The BAML prompt-only change was one source-file edit and the equivalent clean fixture passed pinned baml check. It had a smaller visible change surface, but the BAML arm did not have a completed runnable test case for this task.                                                                                              |
| D: malformed result      | The completed native agent added a service-level regression for a malformed URL and an unknown article field. It preserved the existing weak-timestamp recovery behavior. The strict schema already provided the enforcement; no runtime change was needed.                        | The BAML source alone did not contain Footnote's strict URL/unknown-field boundary. The BAML worker made no completed source change before the blocker. This is a real boundary, not a failure of BAML as a model-programming syntax: a future integration would still need the Footnote validator and a replayable adapter test. |

The optional Task E fixture remains in the harness, but it was not counted in the comparison because its initial “prompt mentions publisherUrl but the type does not” precondition was not present in the clean starting variants. We did not turn that mismatch into a result after the fact.

## Handoff result

Two fresh-agent handoffs were run after Agent 1 made a change.

### Native handoff

The fresh agent reoriented from the repository and found the shared contract, Zod schema, prompt, OpenAPI, backend test, and Discord type. It corrected an early fixture-selection mistake and produced the expected optional-field change. The actual worktree diff is the authority here: its final report claimed an adapter file change that was not present in the diff, which is exactly the kind of claim a human review still has to verify.

### BAML handoff

The fresh agent found news.baml as the model-facing source without a narrative from Agent 1. It added the optional field and prompt guidance, and caught and fixed its own newline-aware edit mistake. It did not edit generated code and did not weaken downstream strict validation. Its BAML checks were blocked by the inherited invalid enum/test form and the pnpm environment.

The handoff result is therefore mixed: BAML made the model-facing source easier to find and kept the change local, but the native handoff also found the relevant sources reliably. Neither path produced a fully verified, provider-independent maintenance change in this environment.

## What BAML standardized

BAML gave the BAML-side agent one obvious source for:

- the output declaration;
- the function name and argument types;
- the prompt;
- generation configuration.

Its compiler caught an invalid enum spelling convention and an invalid test form. A prompt-only change was local and passed the pinned check. A fresh agent could identify the model-facing source without a long narrative.

## What BAML did not standardize

BAML did not provide the pinned repository with the advertised agent install or describe commands. The generated client was ignored and not available to the fresh handoff agent. Strict URL validation, unknown-field rejection, timestamp normalization, runtime failures, usage, and provider ownership remained outside BAML.

The image field also needed a name change because image is reserved in the pinned BAML language. That creates an adapter decision rather than removing one.

The current experiment did not establish a complete BAML-native fixture test path. Its baml test --list clean run found no tests, and the task-specific test syntax was one of the things the compiler rejected. This is an operational gap for an agent-supervision claim.

## Human supervision impact

The evidence suggests a real local benefit for ordinary prompt/contract edits: one BAML source file is easier to locate and change than the native type, schema, prompt, OpenAPI, adapter, and test seams.

That benefit is not yet enough to call the reduction material for a solo maintainer:

- native changes were more spread out, but the existing repository patterns made the shared contract and focused tests discoverable;
- BAML's compiler caught some mistakes early, but the same experiment lacked a completed strict-admission fixture and runnable task tests;
- the BAML handoff required no narrative to find its source, but it also inherited a broken prior source and did not reach a clean verification result;
- no reliable Codex token or context telemetry was available, so context cost is reported qualitatively rather than as a number;
- the fresh-agent environment repeatedly hit pnpm/package-resolution blockers, so correction-round counts are not comparable as a clean benchmark.

This is evidence for a possible supervision benefit, not proof of one.

## Recommendation

Keep evaluating BAML, but do not adopt it as Footnote's default yet and do not start the planner migration.

The next smallest experiment should make the BAML arm runnable before measuring more agents:

1. add a small checked-in BAML-side fixture test that the pinned CLI accepts;
2. generate the TypeScript client in a disposable step;
3. wrap it with the existing strict Footnote schema and normalization;
4. rerun the same four tasks plus one handoff with dependencies prewarmed;
5. capture actual correction rounds and final diffs from both arms.

A likely adoption boundary remains selective: BAML may be useful for ordinary typed generative functions if its agent tooling and generated-client workflow are version-aligned, while policy-sensitive contracts retain explicit Footnote-native strict validation and failure handling. This experiment does not justify reopening #728 or changing production behavior.

## Agent identities and evidence roots

Fresh task threads:

- native A: 01a0d8d4-96c4-7643-a1dd-146bcea1bea8
- native B: 01a0d8d4-9a65-7e63-b873-5e78b7345807
- native C: 01a0d8d4-9f51-7af3-a795-876cdc36fff8
- native D: 01a0d8d4-a338-75a0-93ce-cfda8c9a2595
- BAML A: 01a0d8d4-a796-7330-bad6-0e0db50d3c45
- BAML B: 01a0d8d4-abac-7620-a3bf-b67d4e649e55
- BAML C: 01a0d8d4-afa4-78d0-9af6-e708a6fcbd16
- BAML D: 01a0d8d4-b390-78c0-9c88-eac53ef372dd

Handoff threads:

- native handoff: 01a0d8e7-1c25-7d81-9995-97c94d6b3c4a
- BAML handoff: 01a0d8e7-20fb-7630-9d24-01c3f0b5133a

Some task threads stopped at approval/package-manager blockers rather than returning a complete final report. Their isolated diffs and the pinned CLI reruns above are retained as evidence; they are not presented as completed green runs.
