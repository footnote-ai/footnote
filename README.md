# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/footnote-ai/footnote)

### AI that shows its work.

A lot of AI systems give answers that *look* convincing, but reveal very little about how those answers were made. Footnote creates useful answers with a trail you can follow when it matters.

Transparency is non-negotiable, but not the full story. You also need control: over which AI is being used, what it can and cannot do, what gets remembered, how much money can be spent, how carefully a question should be handled, and much more.

Footnote tries to bridge the gap between what AI can do and what people need in order to use it responsibly. See our [philosophy](docs/Philosophy.md) page for the thinking behind the project.

### What does this look like?

Footnote feels like a normal chat until you want to look closer.

<!-- screenshot of a question+response here -->

Each answer includes what shaped it: the settings in effect, checks performed, sources and tools used, important limits, and more.

<!-- screenshot of an expanded footnote -->

You can inspect that trail and change how future questions are handled. Or simply ignore it.

[Try the live demo](https://ai.jordanmakes.dev)


## Quickstart

Try it out with a few clicks:

[Download the latest release](https://github.com/footnote-ai/footnote/releases) which matches your system. Double-click the file to start.

On first run it will open the setup page—Accept the defaults, or tweak to your liking. Save, then restart Footnote.

## Advanced Start

Run from the source code:

Prerequisites:

- Node.js 22+
- `pnpm` (`pnpm@10.27.0`+)

Clone the repo and start with `pnpm start`

## Deployment

Footnote leverages Docker containers for easy deployment on your own hardware or in the cloud—See the [deployment guide](deploy/README.md) for details.

## Need help?

- [Docs](docs/README.md)
- [GitHub issues](https://github.com/footnote-ai/footnote/issues)
- [GitHub discussions](https://github.com/footnote-ai/footnote/discussions)

## License

Footnote is [dual-licensed under MIT and HL3-CORE](docs/LICENSE_STRATEGY.md).
