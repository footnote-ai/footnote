# CI Guide

This page explains Footnote CI in plain language.
Use it when you want to understand what runs on PRs, why it failed, and what to do next.

## What CI Does

CI (Continuous Integration) runs automated checks on your branch.
It helps catch build, lint, packaging, and deployment issues before merge.

## Before You Open a PR

Run these locally:

- `pnpm lint`
- `pnpm review` for review-ready or cross-cutting changes
- `pnpm validate-footnote-tags` when you add or edit module headers
- `pnpm validate-openapi-links` for API boundary/OpenAPI mapping changes
- `pnpm test:build` when startup/deploy/runtime packaging behavior changes

## Workflow Map

### `ci.yml`

When it runs:

- Pushes to `main`
- Pull requests

What it does:

- Installs dependencies
- Runs `pnpm review`
- Builds workspace packages
- On PRs, also runs Docker build smoke checks for server image paths

### `launcher-verify.yml`

When it runs:

- Pushes to `main`
- Pull requests

What it does:

- Builds launcher packages on Linux/macOS/Windows
- Verifies launcher help command exits successfully
- Verifies `status --config-dir <temp>` is read-only and does not create config files

### `launcher-sea-spike.yml`

When it runs:

- Pull requests touching launcher/SEA paths
- Manual trigger (`workflow_dispatch`)

What it does:

- Builds SEA binaries on Linux/macOS/Windows
- Runs SEA verification checks
- Generates checksums
- Uploads build artifacts
- Optional manual draft release publish when `draft_tag` is provided

What “spike” means here:

- A feasibility/proving workflow for packaging confidence, not the formal release workflow

### `launcher-release.yml`

When it runs:

- Tag pushes matching `v*.*.*`
- Manual trigger

What it does:

- Builds and verifies SEA artifacts on Linux/macOS/Windows
- Uploads artifacts
- Publishes artifacts to GitHub Release on tag events

### `publish-ghcr.yml`

When it runs:

- Pushes to `main`
- Version tags

What it does:

- Builds server image
- Pushes `ghcr.io/footnote-ai/footnote` tags

### `fly-deploy.yml`

When it runs:

- Manual/branch-specific deployment path (see workflow file)

What it does:

- Runs Fly deployment automation for hosted runtime path

### `codeql.yml`

When it runs:

- GitHub Advanced Security schedule/trigger path

What it does:

- Static security analysis
- Surfaces code scanning alerts in PRs and security tab

## Common Failure Fixes

- Lint/format failed:
  Run `pnpm lint:fix`, then rerun `pnpm lint`.
- Review check failed:
  Run `pnpm review` locally and address reported findings.
- Launcher SEA failed:
  Run `pnpm sea:build-launcher`, then `pnpm sea:package`, then `pnpm sea:verify`.
- Runtime packaging failed:
  Run `pnpm test:build` and check Docker build logs.

## How To Trigger Manual Workflows

- Open GitHub Actions tab
- Select workflow
- Click `Run workflow`
- For SEA spike, set `draft_tag` only when you want a draft prerelease

## If You Are Unsure

- Check this guide first
- Ask in PR comments with the failing workflow name and job link
- Include exact command output if you reproduced locally
