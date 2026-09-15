# Documentation Map

This folder holds the main project docs. The subfolders cover the working
system. The top-level files cover project background, licensing posture, and
philosophy.

The public presentation of this checked-in Markdown is available at
`https://ai.jordanmakes.dev/wiki/`. DeepWiki remains a secondary generated code
explainer, not the documentation authority.

For machine clients, the same build publishes an [`llms.txt`](https://ai.jordanmakes.dev/wiki/llms.txt)
discovery index and an [`llms-full.txt`](https://ai.jordanmakes.dev/wiki/llms-full.txt)
Markdown projection. These files are generated from the staged projection of
the canonical files below; they do not introduce another documentation source.
The index and each document retain public route, lifecycle, and freshness
metadata. Canonical source metadata is included when a document has a
repository source; the generated wiki landing page marks it unavailable. An
exact source revision is included only when the build can verify it; otherwise
the projection says that it is unavailable.
The existing Starlight build also publishes its sitemap at
`https://ai.jordanmakes.dev/wiki/sitemap-index.xml`.

For first-time setup:

- New users: [README Quickstart](../README.md#quickstart)
- Deployment/operators: [deploy README](../deploy/README.md)

For contributors:

- Source setup: [Run from source](../README.md#run-from-source-developers-and-contributors)
- [CI](./ci/README.md)
- [Output Testing](./output-testing.md): repeatable web and Discord answer checks.
- [Response comparison](./response-comparison.md): YAML-driven, blindable presentation evidence.
- [Architecture](./architecture/README.md)
- [DeepWiki maintenance](./agents/deepwiki-maintenance.md): when the generated secondary map should change.
- [Proposals](./proposals/index.md)

Source runs use `pnpm`; quick install:
`corepack enable && corepack prepare pnpm@11.16.0 --activate` (fallback:
`npm i -g pnpm@11.16.0`).

Standalone launcher note: running `footnote` with no command (or double-clicking
the binary) opens the `footnote info` launcher menu. Use explicit commands like
`footnote start`, `footnote setup`, and `footnote update` for automation.

## Documentation visuals

Documentation visuals belong under `docs/assets/`. Keep links relative to the
canonical Markdown when possible so they remain useful on GitHub; the wiki
publication stages that directory at `/wiki/assets/`.

## Sections

- [Architecture](./architecture/README.md): current system shape, boundaries,
  and reading order.
- [Account Identity and Access](./auth/README.md): stable, provider-neutral
  identity and access direction.
- [CI](./ci/README.md): workflow map, what checks run, and how to debug CI
  failures.
- [Decisions](./decisions/): durable technical choices and why they were made.
- [Proposals](./proposals/index.md): unadopted or exploratory ideas.
- [Work Status](./status/index.md): current implementation trackers and next steps.
- [API](./api/README.md): OpenAPI source, operation mapping, and code-linking
  rules.
- [AI](./ai/README.md): contributor workflow and the project's public
  [AI use disclosure](./ai/ai-use-disclosure.md).
