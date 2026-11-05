# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Documentation](https://img.shields.io/badge/docs-official%20wiki-blue)](https://ai.jordanmakes.dev/wiki/)

### AI that shows its work.

A lot of AI systems give answers that _look_ convincing, but reveal very
little about how they were made. Footnote creates answers with a trail you can
follow when it matters. That trail helps you check an answer; it doesn't make
the answer automatically correct.

Transparency matters, but so does control: what an assistant can do, what it
remembers, how much it can spend, and when it needs your permission.

Footnote tries to bridge the gap between what AI can do and what people need
to use it responsibly. See our [philosophy](docs/Philosophy.md) for the
thinking behind the project.

Footnote is built with AI assistance. Read the
[AI use disclosure](docs/ai/ai-use-disclosure.md) for more information.

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
