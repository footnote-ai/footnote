# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/footnote-ai/footnote)

### AI that shows its work.

A lot of AI systems give answers that _look_ convincing, but reveal very little about how they were made. Footnote creates answers with a trail you can follow when it matters.

Transparency is important, but you also need control: over what it can and can't do, what's remembered, how much money can be spent, how carefully sensitive questions should be handled, and much more.

Footnote tries to bridge the gap between what AI can do and what people need in order to use it responsibly. See our [philosophy](docs/Philosophy.md) page for the thinking behind the project.

Footnote is built with AI assistance. Read the
[AI use disclosure](docs/ai/ai-use-disclosure.md) for more information.

<!-- screenshot of a question+response here -->

<!-- screenshot of an expanded footnote -->

[Try the live demo](https://ai.jordanmakes.dev)

## Quickstart

Try Footnote without cloning the repository:

1. [Download the latest release](https://github.com/footnote-ai/footnote/releases)
   for your system.
2. Double-click the downloaded file to start Footnote.
3. On first run, Footnote opens the setup page. Accept the defaults or adjust
   the settings, select **Save settings**, then restart Footnote.

## Run from source (developers and contributors)

Use this path to contribute to Footnote or run the repository directly.

Prerequisites:

- Node.js 22.13+
- `pnpm` (`pnpm@11.16.0`+)

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

- [Docs](docs/README.md)
- [Public documentation wiki](https://ai.jordanmakes.dev/wiki/)
- [GitHub issues](https://github.com/footnote-ai/footnote/issues)
- [GitHub discussions](https://github.com/footnote-ai/footnote/discussions)

## License

Footnote is [dual-licensed under MIT and HL3-CORE](docs/LICENSE_STRATEGY.md).
