# SEA Tooling

This directory contains Node SEA packaging scripts for the standalone `footnote` CLI.

## Scripts

- `node tools/sea/build-launcher.mjs`: build launcher packages.
- `node tools/sea/package-sea.mjs`: build current-platform SEA binary.
- `node tools/sea/checksums.mjs`: generate SHA256 checksums for artifacts.
- `node tools/sea/verify.mjs`: run binary `--help` and read-only `status` checks.
