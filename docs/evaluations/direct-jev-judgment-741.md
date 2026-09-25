<!--
@description: Direct TypeSafe Jev evidence adapter and bounded replay report for #741.
@footnote-scope: test
@footnote-module: DirectJevJudgmentReport
@footnote-risk: medium - Provider evidence can influence later judgment architecture decisions.
@footnote-ethics: high - Results are advisory, fail-open, and based on synthetic fixtures only.
-->

# Direct TypeSafe Jev judgment evidence (#741)

Status: **adapter and replay path complete; hosted Jev unavailable in this checkout**.

Base: `9ce1beb13916a0020331983a4f25915c0cd5f08f` (PR #739 head; exact base for this stacked branch).

Branch: `experiment/direct-jev-judgment-final`

## Integration checked

The current TypeSafe contract exposes `POST /v1/systemone` for one or more named typed questions, `GET /v1/models` for account-visible model names and aliases, bearer authentication, and `noul`, `choice`, and `score` decisions. The official JavaScript reference is `@typesafe-ai/sdk`; this PR uses a dependency-free direct `fetch` adapter so Footnote does not add a provider dependency for an evidence-only experiment.

The documented default alias is `jev-latest`. It can move when TypeSafe releases a new model. The adapter records the response model and accepts `TYPESAFE_JEV_MODEL`; a reproducible run should first discover an account-visible version through `GET /v1/models`, then set that explicit model. The exploratory threshold in this report is not policy confidence.

References checked 2026-09-25:

- [TypeSafe OpenAPI](https://api.typesafe.ai/openapi.json)
- [Official JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)
- [SDK client implementation](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts)
- [TypeSafe Jev announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

## Workloads and evidence

The context workload reuses the frozen synthetic #717 corpus and the strongest committed BM25 plus bounded deterministic graph baseline. The frozen evidence reported:

| Method | Necessary recall | Useful precision | Distracting rate | Avg messages | Avg estimated tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| BM25 + deterministic graph | 0.967 | 0.116 | 0.025 | 15.050 | 275.950 |

The direct adapter asks one independent `noul` question per candidate while sharing the complete case state, then applies an explicitly exploratory probability threshold. It records selected size, required-context recall, useful precision, distractor inclusion, latency, model returned, and token usage. It does not call the generic `openjev` selector or treat a generative selector as Jev.

The second workload is one claim/evidence support fixture in `scripts/fixtures/claim-evidence.json`. Without hosted credentials it runs only through the deterministic adapter replay path and is labeled `replay_only`; the replay is not a hosted semantic result.

## Hosted result and limits

`TYPESAFE_API_KEY` was absent in this environment, so no hosted Jev request was made and no hosted score, latency, usage, cost, or model result is claimed. The report command returns an explicit blocked hosted section rather than inventing data:

```text
pnpm eval:direct-jev
```

The adapter preserves timeout, caller cancellation, missing credential, network, HTTP, invalid JSON, and invalid response-shape distinctions. It never prints or persists the API key.

No production routing, context selection, planner, authorization, policy, provenance, TRACE, workflow, or `JudgmentRuntime` seam changed. The current evidence supports a reusable observe-only transport/replay path, not a permanent runtime seam or a production Jev decision.

## Verification

Attempted:

- `git diff --check` — passed.
- `pnpm exec tsx --test scripts/direct-jev-adapter.test.ts scripts/context-selection-benchmark.test.ts` — blocked because this checkout has no `node_modules`, and the local `pnpm` invocation produced no output before it was stopped.
- `pnpm eval:direct-jev` — not run for the same missing-dependency runner condition.

The committed checks are intentionally focused: direct HTTP request/response parsing, missing-key fail-closed transport setup, HTTP error taxonomy, replay, and the reused frozen baseline tests.
