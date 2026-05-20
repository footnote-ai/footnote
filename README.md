# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/footnote-ai/footnote)

Footnote is an AI framework that tries to show its work.

## Standalone CLI (Primary User Path)

Download the `footnote` binary from GitHub Releases, then run:

```bash
footnote start
```

Supported v1 runtime: Docker + GHCR image (`ghcr.io/footnote-ai/footnote`).

### CLI Commands (v1)

```bash
footnote start
footnote stop
footnote status
footnote open
footnote logs
```

Optional start flags:

```bash
footnote start --headless
footnote start --tag <imageTag>
footnote start --config-dir <path>
```

## Quickstart

```bash
git clone https://github.com/footnote-ai/footnote.git
cd footnote
pnpm start
```

Open `http://localhost:8080`.

## Docker

Default deployment path (pull prebuilt GHCR image):

```bash
pnpm validate-env --target server
docker compose -f deploy/compose.yml up
```

For local source-based image builds, use:

```bash
docker compose -f deploy/compose.yml -f deploy/compose.dev-build.yml up --build
```

## Docs

- Deployment guide: [deploy/README.md](deploy/README.md)
- Prompt/profile config: [docs/architecture/prompt-resolution.md](docs/architecture/prompt-resolution.md)
- Docs map: [docs/README.md](docs/README.md)

## License

Footnote is dual-licensed under MIT and HL3-CORE. See [docs/LICENSE_STRATEGY.md](docs/LICENSE_STRATEGY.md).
