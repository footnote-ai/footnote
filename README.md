# Footnote

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hippocratic License HL3-CORE](https://img.shields.io/static/v1?label=Hippocratic%20License&message=HL3-CORE&labelColor=5e2751&color=bc8c3d)](https://firstdonoharm.dev/version/3/0/core.html)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/footnote-ai/footnote)

Footnote is a transparency- and provenance-focused AI framework that shows its work.

## Quickstart

### 1) Download the CLI binary

Download the latest CLI assets from [GitHub Releases](https://github.com/footnote-ai/footnote/releases).

### 2) Choose your file

Use the release asset that matches your OS and CPU:

- Windows x64: `footnote-win32-x64.exe`
- macOS Apple Silicon (arm64): `footnote-darwin-arm64`
- Linux x64: `footnote-linux-x64`

### 3) Verify the download (`.sha256`)

Each asset includes a matching `.sha256` file. This file contains the SHA-256 checksum used to verify download integrity for that exact asset.

Windows PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 .\footnote-win32-x64.exe
Get-Content .\footnote-win32-x64.exe.sha256
```

macOS/Linux:

```bash
shasum -a 256 ./footnote-darwin-arm64
cat ./footnote-darwin-arm64.sha256
```

Compare the hash output from your command to the value in the matching `.sha256` file for the same asset.

### 4) Open the binary

Double-click the file (or run it from a terminal).

### 5) Complete first setup

When setup is needed:

- The launcher/runtime starts.
- The setup page opens.
- The setup page starts from the default config template for your environment.

### 6) Restart after saving settings

After saving settings, restart Footnote so the runtime applies your updated configuration.

## Run from source (Developers and contributors)

Prerequisites:

- Node.js 22+
- `pnpm` (repo uses `pnpm@10.27.0`)

Install `pnpm` with one of:

```bash
corepack enable && corepack prepare pnpm@10.27.0 --activate
```

```bash
npm i -g pnpm@10.27.0
```

Clone and start:

```bash
git clone https://github.com/footnote-ai/footnote.git
cd footnote
pnpm start
```

## Deployment and advanced setup

For container and operator paths, use the [Deployment Guide](deploy/README.md).

## Need help?

- [Docs map](docs/README.md)
- [GitHub issues](https://github.com/footnote-ai/footnote/issues)
- [GitHub discussions](https://github.com/footnote-ai/footnote/discussions)

## License

Footnote is dual-licensed under MIT and HL3-CORE. See the [license strategy](docs/LICENSE_STRATEGY.md) for more details.
