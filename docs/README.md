# Documentation Map

This folder holds the main project docs. The subfolders cover the working
system. The top-level files cover project background, licensing posture, and
philosophy.

For first-time setup:

- New users: [README Quickstart](../README.md#quickstart)
- Deployment/operators: [deploy README](../deploy/README.md)

For contributors:

- Source setup: [Run from source](../README.md#run-from-source-developers-and-contributors)
- [CI](./ci/README.md)
- [Output Testing](./output-testing.md): repeatable web and Discord answer checks.
- [Response comparison](./response-comparison.md): YAML-driven, blindable presentation evidence.
- [Architecture](./architecture/README.md)
- [Proposals](./proposals/index.md)

Source runs use `pnpm`; quick install:
`corepack enable && corepack prepare pnpm@11.16.0 --activate` (fallback:
`npm i -g pnpm@11.16.0`).

Standalone launcher note: running `footnote` with no command (or double-clicking
the binary) opens the `footnote info` launcher menu. Use explicit commands like
`footnote start`, `footnote setup`, and `footnote update` for automation.

## Web Style Map

The web package uses a layered stylesheet entrypoint at
`packages/web/src/styles/index.css`.

- Edit reusable design constants in `design-constants.css`.
- Edit light/dark semantic mapping in `theme-map.css`.
- Keep component/page rules in the remaining layer files (for example
  `header-nav.css`, `interaction.css`, `trace.css`).

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
