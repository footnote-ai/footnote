# Documentation Map

Choose a path based on what you want to do.

## Start here

- [Try Footnote](../README.md#quickstart): try the live demo.
- [Provenance, privacy, and user control](./Philosophy.md): principles behind making AI answers easier to inspect and govern.
- [Run Footnote yourself](../deploy/README.md): deployment on your own hardware or in the cloud.

## Build and contribute

- [Run from source](../README.md#run-from-source-developers-and-contributors): set up the repository for development.
- [Architecture](./architecture/README.md): how the system is organized and where to read next.
- [CI](./ci/README.md): checks, workflows, and troubleshooting.
- [Output testing](./output-testing.md): repeatable checks of web and Discord answers.
- [Response comparison](./response-comparison.md): compare answer presentation using YAML scenarios.

## Browse reference and project records

- [Account identity and access](./auth/README.md): identity and access direction.
- [API](./api/README.md): OpenAPI source, operation map, and code-linking rules.
- [AI use disclosure](./ai/ai-use-disclosure.md): how Footnote uses AI in its development.
- [Contributor workflow](./ai/README.md): guidance for working with AI in this repository.
- [Decisions](https://github.com/footnote-ai/footnote/tree/main/docs/decisions): recorded technical choices and their rationale.
- [Proposals](./proposals/index.md): ideas that are exploratory or not adopted.
- [Work status](./status/index.md): implementation trackers and next steps.
- [History](./History.md): project history.

## How these docs are published

The checked-in Markdown is canonical. The [public wiki](https://ai.jordanmakes.dev/wiki/)
renders it and also publishes machine-readable [`llms.txt`](https://ai.jordanmakes.dev/wiki/llms.txt)
and [`llms-full.txt`](https://ai.jordanmakes.dev/wiki/llms-full.txt) indexes.
DeepWiki is a secondary generated code explainer, not the documentation
authority. See [DeepWiki maintenance](./agents/deepwiki-maintenance.md) for
when its structure should change.

## Visual catalogue

Visuals are optional; capture them when the referenced UI is stable and the
image adds useful context. Keep checked-in media under `docs/assets/` and link
to it with relative paths.

| Target                                       | Proposed visual        | Type       | Why it helps                           | UI stable?                                   | Priority / status        |
| -------------------------------------------- | ---------------------- | ---------- | -------------------------------------- | -------------------------------------------- | ------------------------ |
| [README Quickstart](../README.md#quickstart) | First-run setup screen | Screenshot | Shows new users what setup looks like. | Not verified; defer capture until confirmed. | Opportunistic / proposed |

