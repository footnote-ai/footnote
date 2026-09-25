# BAML Canary delta for #744

## Result

The Canary experiment did not run. This checkout has no baml or baml-cli executable, the existing fixture's pinned BAML package is not present in the prewarmed dependency tree, and the installed pnpm package does not match the repository pin. I did not install anything or run an installer.

The GitHub API request for issue #744 failed with a network permission error, and the web cache had no copy of the issue. The only local /news fixture is the checked-in #727 fixture at experiments/baml-agent-supervision-727/baml/baml_src/news.baml; this report records that fixture by path and SHA-256. Treating it as #744's exact requested delta remains unverified.

## Fixture and version facts

- Checkout: experiment/baml-canary-agent-followup, clean at start, base a3afefaf2c6e873d5cc0939435fef3c5c7b8e281.
- Node: v24.16.0.
- Repository package manager pin: pnpm@11.21.0.
- Installed pnpm package: 11.17.0.
- Fixture package pin: @boundaryml/baml@0.226.2.
- node_modules/.bin has no BAML executable; node_modules/.pnpm has no BAML package; there is no root node_modules/@boundaryml.
- Current Canary guidance advertises the baml binary, baml agent install, and baml describe/run/test/fmt. The pinned fixture uses baml-cli and the older 0.226.2 syntax. The current BAML skill documents Canary syntax changes, including backtick prompts with interpolation expressions and name/type/comma class fields. These docs do not establish that the old fixture compiles under Canary.

Official references:

- [BAML Canary README](https://github.com/BoundaryML/baml/blob/canary/README.md)
- [BAML agent skill and Canary CLI loop](https://github.com/BoundaryML/baml-skill/blob/main/README.md)

## Commands and results

- Get-Command baml,baml-cli -ErrorAction SilentlyContinue: neither command found.
- pnpm --version: no output within 10 seconds; stopped with Ctrl-C. Installed pnpm package metadata reports 11.17.0, while this repository requires 11.21.0.
- pnpm --dir experiments/baml-agent-supervision-727/baml exec baml-cli --version: no output within 10 seconds; stopped with Ctrl-C.
- pnpm --dir experiments/baml-agent-supervision-727/baml exec baml-cli --help: no output within 10 seconds; stopped with Ctrl-C.
- node node_modules/prettier/bin/prettier.cjs --write ...: blocked by EPERM opening the prewarmed Prettier file under node_modules/.pnpm/prettier@3.9.6.
- gh issue view 744 --repo footnote-ai/footnote --json number,title,body,url,comments: blocked by network permissions (connectex, socket access forbidden).
- baml agent install, baml describe, baml check, baml generate, and baml test --list: not run because the Canary executable is absent; installing it would violate the no-installer instruction.
- No live provider calls, credentials, production code, or deployment were used.

The new results JSON parsed successfully. The formatter and repository review could not run because of the package-manager mismatch and filesystem EPERM; no BAML check or test ran.

The prior #727 report records a separate successful run with its then-available 0.226.2 CLI. Those historical checks do not validate this checkout or the current Canary toolchain.

## Comparison to the #727 baseline

The checked-in #727 evaluation reports that BAML 0.226.2 passed a clean fixture check and generation, while test listing found zero tests. Its bounded-choice check caught lowercase enum names and an invalid test form. That run also found agent and describe commands unsupported. Current Canary guidance advertises those agent-facing commands and a different CLI/language loop, but this checkout cannot verify that the test gap or cross-layer drift improved. A comparison to #744-specific behavior is unavailable until the issue body can be read.

## Delegation

Codex lists a saved footnote project at C:\Users\Jordan\Desktop\footnote; it does not list repo2. Creating app tasks would target that different checkout or require a Git worktree. I therefore created no delegated tasks and report no agent timings. The requested three fresh Luna/high passes did not run.

## Recommendation

Keep the #727 /news fixture and Footnote's strict schema, normalization, runtime, usage, failure, provenance, and TRACE ownership. Do not infer Canary compatibility from the current docs or migrate production. Rerun the three requested passes only after the exact #744 delta is available and a compatible Canary CLI plus pnpm 11.21.0 are already present in repo2.
