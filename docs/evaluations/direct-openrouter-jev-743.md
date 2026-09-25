<!--
@description: Direct OpenRouter Jev evaluation record for PR #743.
@footnote-scope: test
@footnote-module: DirectOpenRouterJevReport
@footnote-risk: medium - Provider evidence can influence later judgment architecture decisions.
@footnote-ethics: high - Results are advisory and use synthetic fixtures only.
-->

# Direct OpenRouter Jev evaluation (#743)

Status: **adapter changes and report prepared; hosted evaluation blocked before any request ran**.

Base: `ec1fed4cd952cdbd53a07f56652cd975918e2890`

Branch: `experiment/jev-openrouter-followup`

## API contract

OpenRouter documents Jev through `POST https://openrouter.ai/api/alpha/decisions`. The request carries `model`, `state`, and named `questions`; `typesafe/jev-1.13` is the pinned model ID. Noul answers include a probability. Responses also include the served model, provider, request ID, input/output token counts, and cost. The adapter uses that direct HTTP contract and adds no SDK dependency.

References checked 2026-09-25:

- [OpenRouter: What Is Jev?](https://openrouter.ai/blog/insights/what-is-jev/)
- [OpenRouter: How to Use Jev](https://openrouter.ai/blog/tutorials/how-to-use-jev/)
- [OpenRouter Typesafe models](https://openrouter.ai/provider/typesafe/)

## Workloads and comparison

The context workload reuses the frozen synthetic #717 corpus: 100 cases and 4,000 messages, with no private transcripts. The report compares hosted Jev against the same corpus's deterministic current-window and BM25 plus graph baselines. The generic OpenJEV row remains unavailable and is not presented as a Jev result.

| Frozen #717 method | Cases | Necessary recall | Useful precision | Distracting rate | Avg messages | Estimated input tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current window | 100 | 0.500 | 0.035 | 0.023 | 24.00 | 442.4 |
| BM25 + graph expansion | 100 | 0.967 | 0.116 | 0.025 | 15.05 | 275.95 |
| Generic OpenJEV | 0 | unavailable | unavailable | unavailable | unavailable | unavailable |

The hosted workload asks one independent Noul question per candidate in each case and records probabilities, selected IDs, provider/model/request ID, latency, token usage, and cost. The exploratory threshold defaults to 0.5 and is not policy confidence. A second workload uses the frozen claim/evidence fixture at `scripts/fixtures/claim-evidence.json`; replay output is explicitly labeled replay-only.

## Hosted run status

No OpenRouter request ran in this environment. `OPENROUTER_API_KEY` was present, but the prewarmed `tsx` package could not be opened by Node (`EPERM` under `node_modules/.pnpm`). `pnpm exec tsx --version` also produced no output and was stopped after 35 seconds. The requested hosted command and focused tests therefore remain unverified; there are no new Jev probabilities, provider/model values, latency, usage, cost, or API errors to report. The key value was not read or printed.

## Limits

This adapter is an evidence harness only. Jev probabilities are advisory and never authorize, route, or change production behavior. The synthetic corpus and frozen baselines do not establish production Discord performance. The API documentation does not state whether billing is reversed or provider work is cancelled after a client abort.

## Verification

Attempted:

- `node node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs --test scripts/direct-jev-adapter.test.ts scripts/context-selection-benchmark.test.ts` — blocked before tests by Windows `EPERM` opening the prewarmed CLI under `node_modules`.
- `node node_modules/tsx/dist/cli.mjs scripts/direct-jev-benchmark.ts` — same `EPERM` opening the CLI junction target.
- `pnpm exec tsx --version` — no output after 35 seconds; stopped.
- `node scripts/format-changed.cjs --write` — blocked when its wrapper failed to start `pnpm.cmd` (`EINVAL`).
- `node scripts/review.cjs --changed-only` — no output after 35 seconds; stopped.
- `git diff --check` — passed.

No dependency installation was run.
