# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/footnote-ai/footnote)

### AI that shows its work.

Footnote is an open-source AI assistant for answers you can check. It pairs responses with inspectable provenance and trace metadata so people can see what shaped an answer, what it may be missing, and where to look next.

It is built for human judgment, not as an oracle. When a live response has relevant sources, limits, safety information, or workflow details, Footnote makes room for that context alongside the answer. Read the [project philosophy](https://ai.jordanmakes.dev/wiki/philosophy/) for the principles behind the work.

Footnote is built with AI assistance. Read the
[AI use disclosure](docs/ai/ai-use-disclosure.md) for more information.

![Prepared Footnote response example](docs/assets/public-home-prepared.png)

_The homepage's prepared examples are curated demonstrations of Footnote's answer shape, not live runs or durable traces._

[Try the live demo](https://ai.jordanmakes.dev)

## Quickstart

Try it out with a few clicks:

[Download the latest release](https://github.com/footnote-ai/footnote/releases) which matches your system. Double-click the file to start.

On first run it will open the setup page—Accept the defaults, or tweak to your liking. Save, then restart Footnote.

## Advanced Start

Run from the source code:

Prerequisites:

- Node.js 22.13+
- `pnpm` (`pnpm@11.16.0`+)

Clone the repo and start with `pnpm start`

## Deployment

Footnote leverages Docker containers for easy deployment on your own hardware or in the cloud—See the [deployment guide](deploy/README.md) for details.

## Need help?

- [Public documentation wiki](https://ai.jordanmakes.dev/wiki/getting-started/)
- [Documentation source](docs/README.md)
- [GitHub issues](https://github.com/footnote-ai/footnote/issues)
- [GitHub discussions](https://github.com/footnote-ai/footnote/discussions)

## License

Footnote is [dual-licensed under MIT and HL3-CORE](docs/LICENSE_STRATEGY.md).
