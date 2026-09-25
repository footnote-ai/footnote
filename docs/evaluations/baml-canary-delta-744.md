# BAML Canary delta for #744

## Result

The current Canary toolchain ran successfully in an isolated port of the
`/news` fixture. The original #744 fixture did not compile unchanged: Canary
reports removed client-block syntax, removed hash-string syntax, and a moved
generator configuration. The port keeps the same model-facing shape and adds a
real offline parser test.

This is a toolchain delta, not a complete new supervision-cost result. Three
fresh Luna/high Codex observations were started below, but the drift task did
not reach a clean rerun and there was no native control, so this report does
not claim that Canary changes #744's mixed conclusion.

## Fixture and version facts

- Checkout: `experiment/baml-canary-agent-followup`, base
  `a3afefaf2c6e873d5cc0939435fef3c5c7b8e281`.
- Node: `v24.16.0`.
- Repository package manager pin: `pnpm@11.21.0`.
- Installed pnpm package: `11.17.0`.
- Historical fixture package pin: `@boundaryml/baml@0.226.2`.
- Current launcher: BAML wrapper `0.2.5`.
- Current toolchain: BAML `0.20.1 (canary)`.
- The installed BAML skill SHA-256 was
  `76503C6C9FD2C02779FACC219668A961B90E831260E8EDB3879E3AACECF14329`.

The official current workflow uses the `baml` launcher, Canary, `baml agent
install`, and `baml describe`. The current skill is describe-first and tells
agents to use the CLI as the language reference. The old fixture uses the
older `baml-cli` layout and syntax.

Official references:

- [BAML Canary README](https://github.com/BoundaryML/baml/blob/canary/README.md)
- [BAML current get-started guide](https://github.com/BoundaryML/baml/blob/canary/typescript2/app-developer-docs/content/baml/get-started.mdx)
- [BAML agent skill](https://github.com/BoundaryML/baml-skill/blob/main/README.md)

## Commands and results

- `baml agent install`: passed in the historical fixture directory and the
  current port. It installed the `baml-core` skill for Codex/OpenCode and
  Claude Code.
- `baml describe GenerateNewsResponse`: passed in the current port and showed
  the function signature, prompt, and `NewsResult` dependency.
- `baml fmt baml_src/news.baml`: passed in the current port.
- `baml check`: passed in the current port.
- `baml generate`: passed in the current port and generated 69 ignored files.
- `baml test --list`: discovered
  `root::parse a valid news result` in the current port.
- `baml test`: passed one offline parser test in the current port.

The historical fixture produced these current-Canary errors:

- `client<llm>` blocks were removed and must become client values.
- `generator target` must move into `baml.toml`.
- `#"..."#` prompt strings were removed and must become quoted/backtick
  strings.

The current port uses the documented replacement syntax, including
`ctx.output_format()`, and keeps a representative valid-result parser test.
No live provider call was made.

## What this changes from #744

The current toolchain supplies the missing agent-facing commands and can run a
real BAML test once the fixture is migrated. That is useful evidence about the
paved road. It also adds migration work before an older Footnote BAML fixture
can use that road. The fresh task observations below show source navigation and
early feedback, but do not show fewer correction rounds, better handoff
behavior, or lower human review cost.

The pinned #744 result remains valid for `@boundaryml/baml@0.226.2`: it found
local prompt/type navigation and concrete checks, but did not establish a
material reduction in total supervision cost. This report neither reverses nor
confirms that result.

## Limits

- `pnpm --version` and fixture `pnpm exec` probes produced no output within ten
  seconds because the installed pnpm package does not match the repository pin.
- Repository `pnpm format:write` and `pnpm review --changed-only` remained
  blocked by the pnpm mismatch and a Windows `EPERM` opening the prewarmed
  Prettier file.
- Codex lists a saved Footnote project at
  `C:\Users\Jordan\Desktop\footnote`, not this isolated clone. The fresh task
  threads therefore used explicit isolated copies; no reliable token or timing
  telemetry is claimed.
- Generated code is an operational observation, not a primary maintainability
  score. It was generated locally and is not part of a production migration.

## Fresh Codex task observations

Three fresh `gpt-6-luna` high-reasoning threads were started against isolated
copies of the current fixture:

- `01a0d98a-7ad7-7250-9c10-4fef9d8750b2` — contract change. The agent added an
  optional `coverageNote`, updated the prompt and parser assertion, and ran
  formatting, checking, tests, generation, and diff checks successfully. It
  reported no first-pass mistake.
- `01a0d98a-7ffa-7442-9605-da18fc2aa52e` — drift diagnosis. The agent changed
  `NewsResult.summary` from `string` to `int` while leaving the fixture stale.
  `baml check` accepted the type change, but the offline parser test failed
  with `Expected int, got String("Overall")`. `baml generate` did not catch the
  stale fixture. The agent identified the mismatch and began restoring it, but
  the session stopped while awaiting approval; no clean final rerun is claimed.
- `01a0d98a-840c-7582-9a10-9d6cb855c197` — handoff. A fresh agent found the
  tracked BAML source, added an optional `publisherUrl`, and ran `describe`,
  `fmt`, `check`, `test --list`, `test`, and `generate` successfully. It did
  not edit generated code. It also reported a warning that the BAML skill was
  not installed in that checkout, so the handoff did not automatically receive
  the skill until an explicit `baml agent install` is run.

These observations show that the current CLI gives useful, early feedback and
that a fresh agent can find the BAML source. They do not show fewer total
supervision rounds than #744: one drift task stopped before a clean rerun, the
handoff had no installed skill, and no native control task was rerun.

## Recommendation

Keep #744's mixed agent-supervision result and keep production unchanged. The
current Canary workflow is materially more agent-oriented than the pinned
toolchain, but the evidence is still incomplete until the drift task has a
clean rerun and a comparable native control is available. A selective BAML
boundary for ordinary typed functions remains plausible; this report does not
justify default adoption or a production migration.
