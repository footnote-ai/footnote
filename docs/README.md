# Documentation Map

This folder holds the main project docs. The subfolders cover the working
system. The top-level files cover project background, licensing posture, and
philosophy.

For first-time setup:

- Standalone user path: [README Standalone CLI](../README.md#standalone-cli-primary-user-path)
- Developer source path: [README Quickstart](../README.md#quickstart)
- Deployment path: [deploy README](../deploy/README.md)
- Source runs use `pnpm`; quick install: `corepack enable && corepack prepare pnpm@10.27.0 --activate` (fallback: `npm i -g pnpm@10.27.0`)

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
- [CI](./ci/README.md): workflow map, what checks run, and how to debug CI
  failures.
- [Decisions](./decisions/): durable technical choices and why they were made.
- [Proposals](./proposals/): unadopted or exploratory ideas.
- [Status](./status.md): branch-level implementation tracking document.
- [API](./api/README.md): OpenAPI source, operation mapping, and code-linking
  rules.
- [AI](./ai/README.md): contributor workflow for AI-assisted changes.
