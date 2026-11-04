# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Documentation](https://img.shields.io/badge/docs-official%20wiki-blue)](https://ai.jordanmakes.dev/wiki/)

### AI that shows its work.

Footnote is an AI assistant for the web and Discord. It makes answers easier to
inspect by recording the workflow and available source information behind
them. A trace can help explain how an answer was produced; it does not prove
that the answer is correct.

The backend runs requests through bounded workflows that can use context,
review candidate answers, and record provenance. The web app and Discord bot
show that information through response details and traces.

Discord Voice has two paths. Standard speaks answers approved by Footnote's
Workflow. Live supports faster conversation and can delegate substantive
questions to that Workflow; its independent speech may paraphrase and is not
the same as an exact-text approved answer. See the [Voice architecture](docs/architecture/realtime-voice.md)
for the current boundary and its evaluation limits.

See the [project philosophy](docs/Philosophy.md) for the reasons behind these
choices.

Footnote is built with AI assistance. Read the
[AI use disclosure](docs/ai/ai-use-disclosure.md) for more information.

## Explore Footnote

- [Workflow and review](docs/architecture/workflow.md): how a request moves
  through generation, assessment, context, and provenance.
- [Project context](docs/architecture/context-integrations/project-context.md):
  how approved repository documents can inform answers when the feature is
  enabled.
- [Voice](docs/architecture/realtime-voice.md): how Standard and Live differ,
  and which Live speech is not an exact approved answer.

## Quickstart

Try Footnote in your browser with the [live demo](https://ai.jordanmakes.dev).

To run your own instance, follow the [deployment guide](deploy/README.md). To
contribute or run from the repository, follow [Run from source](#run-from-source-developers-and-contributors).

## Run from source (developers and contributors)

Use this path to contribute to Footnote or run the repository directly.

Prerequisites:

- Node.js 22.13+
- `pnpm` 11.21.0, the version pinned in `package.json`

```sh
git clone https://github.com/footnote-ai/footnote.git
cd footnote
pnpm start
```

`pnpm start` creates missing local setup files, installs dependencies when
needed, and starts the backend and web development services.

## Deployment

Footnote uses Docker containers for deployment on your own hardware or in the
cloud. See the [deployment guide](deploy/README.md) for details.

## Need help?

- [Official documentation wiki](https://ai.jordanmakes.dev/wiki/)
- [Documentation map](docs/README.md)
- [GitHub issues](https://github.com/footnote-ai/footnote/issues)
- [GitHub discussions](https://github.com/footnote-ai/footnote/discussions)

DeepWiki provides a generated code explainer, but it may lag behind the
repository and official wiki: [DeepWiki](https://deepwiki.com/footnote-ai/footnote).

## License

Footnote is [dual-licensed under MIT and HL3-CORE](docs/LICENSE_STRATEGY.md).
