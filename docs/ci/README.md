# CI Guide

This page is for figuring out what happened when a Footnote check fails.

Most of the time, you do not need to know much about GitHub Actions. Open the failed check, read the first real error, and use this page to find the matching local command.

## What CI Is Doing

CI is the set of checks GitHub runs on branches and pull requests.

For Footnote, those checks mostly answer a few questions:

- does the code still lint?
- do the main review checks pass?
- do the packages still build?
- does the Docker/server packaging path still work?
- does the standalone launcher packaging path still work?

If a job fails, the last line often only says the job failed. The useful error is usually higher up in the log.

## Release Channels

Footnote keeps stable releases separate from automatically built previews.

| Channel         | Trigger                      | Output                                     | Stability                       |
| --------------- | ---------------------------- | ------------------------------------------ | ------------------------------- |
| Pull request    | Pull request activity        | Temporary CI artifacts and checks          | Not published                   |
| Server current  | Push to `main`               | GHCR `latest` and `sha-<commit>` images    | Accepted code, commit-addressed |
| Launcher canary | Relevant push to `main`      | Standalone binaries in a GitHub prerelease | Automated preview channel       |
| Stable launcher | Version tag such as `v0.2.0` | Standalone binaries in a GitHub Release    | Deliberate release              |

An automatic build must not increment or claim a stable minor version. A
per-commit preview uses a unique SemVer prerelease identifier such as
`v0.2.0-canary.<run-number>` and records the source commit. The next stable base
version is selected deliberately instead of inferred by CI.

The workspace packages remain private and are not published to npm. In this
guide, a launcher package means the standalone binaries produced by the SEA
packaging tools.

Implementation and first-release evidence are tracked in
[Launcher Canary Releases Status](../status/launcher-canary-releases.md).

## Before Opening a PR

For a normal code change, run:

```bash
pnpm lint
```

For a larger change, or one that touches several packages, run:

```bash
pnpm review
```

Some checks only matter for specific files:

```bash
pnpm validate-footnote-tags
```

Run this when you add or edit module headers.

```bash
pnpm validate-openapi-links
```

Run this when you change API boundary docs or OpenAPI mappings.

```bash
pnpm test:build
```

Run this when you change startup, Docker, deploy, or runtime packaging behavior.

You do not need to run every command for every small docs or copy edit.

## Where To Look When A Check Fails

Open the pull request, then open the failed check in the Checks tab.

Look for the first useful error, not just the final red summary. If the failure mentions a command, try running that command locally from the repo root.

## Workflows

### `ci.yml`

This is the main PR check.

It runs on pushes to `main` and on pull requests. It installs dependencies, runs the main review command, builds workspace packages, and runs Docker build smoke checks for server image paths on PRs.

On pushes to `main`, it also compares the previous and current commits for
launcher packaging inputs. Relevant changes include launcher code, shared
configuration/contracts, SEA tools, release workflows, and root build files.
An unavailable comparison builds the launcher instead of silently skipping it.

After normal validation passes, relevant changes use the shared launcher
packaging workflow. The publish job rechecks that the commit is still `main`,
verifies three binaries and three SHA256 files, then creates
`v0.2.0-canary.<ci-run-number>` as a GitHub prerelease. A stale run exits without
publishing. If stable tag `v0.2.0` exists, advance
`LAUNCHER_CANARY_BASE_VERSION` before retrying.

If this fails, start with:

```bash
pnpm review
```

If the error is clearly lint-only, use:

```bash
pnpm lint
```

### `launcher-verify.yml`

This checks the launcher packages without doing the full SEA release build.

It runs on pushes to `main` and on pull requests. It builds the launcher on Linux, macOS, and Windows. It also checks that the help command works and that `footnote status --config-dir <temp>` does not create config files.

Launcher invocation behavior: `footnote` with no command routes to `footnote info`.
CI workflows should keep using explicit commands (`footnote status`, `footnote start`,
`footnote update`) for deterministic automation.

If this fails, check which operating system failed first. A Windows-only failure is often a path or shell issue.

### `launcher-sea-spike.yml`

This is the proving ground for standalone binary packaging.

It runs on launcher/SEA pull requests, or when someone starts it manually from GitHub Actions. It calls the shared launcher packaging workflow to build and verify SEA binaries for Linux, macOS, and Windows, preserve their checksums, and upload artifacts. If `draft_tag` is provided during a manual run, it can also publish a draft prerelease.

`Spike` means this workflow proves the packaging path. It is not the normal release workflow.

If this fails locally, try:

```bash
pnpm sea:build-launcher
pnpm sea:package
pnpm sea:verify
```

### `launcher-release.yml`

This is the release workflow for the standalone `footnote` binary.

It runs on stable version tags like `v0.1.0`. It can also be started manually.
It calls the shared launcher packaging workflow, then uploads verified SEA
artifacts to the GitHub Release. Tags containing a prerelease suffix are not
published through this stable path.

Most contributors will not need to run this directly.

Stable launcher releases and automated canaries must share the same SEA build,
verification, and checksum behavior. A canary publish job must wait for the
required checks for the same commit. Do not add an independent publishing
workflow that can race `ci.yml` and publish a failed commit.

### `launcher-package.yml`

This reusable workflow owns the cross-platform SEA release build. It installs
the pinned pnpm version, builds the launcher, packages and verifies the native
binary, and uploads the platform artifact. It has read-only repository access
and cannot create a release.

Stable releases, SEA spike builds, and launcher canaries call this workflow.
Keep their common packaging behavior here instead of copying the platform
matrix into each caller.

### `publish-ghcr.yml`

This builds and publishes the server image: `ghcr.io/footnote-ai/footnote`.

It runs on pushes to `main` and on version tags. This matters because the standalone CLI starts Footnote from the GHCR image in v1.

If this fails, check the Docker build output.

### `fly-deploy.yml`

This is for the hosted Fly runtime path.

It is manual or branch-specific. Check the workflow file for the exact trigger before using it.

### `codeql.yml`

This runs GitHub's static security analysis.

It reports code scanning alerts in PRs and in the repository Security tab. If this fails, read the alert first. Some findings are real issues; others need a small code change to make the intent clearer.

## Common Fixes

Lint or formatting failed:

```bash
pnpm lint:fix
pnpm lint
```

The main review check failed:

```bash
pnpm review
```

SEA packaging failed:

```bash
pnpm sea:build-launcher
pnpm sea:package
pnpm sea:verify
```

Docker or runtime packaging failed:

```bash
pnpm test:build
```

## Running A Workflow By Hand

Go to the GitHub Actions tab, choose the workflow, then click `Run workflow`.

For the SEA spike, only set `draft_tag` when you actually want a draft prerelease artifact.

A canary is automatic. Do not create or move its tag by hand. If a canary run
fails after creating its release, rerun the same CI workflow so it repairs the
same run-number release instead of creating a replacement tag.

## When You Need Help

Ask in the PR comments. Include the workflow name, a link to the failed job, the command you tried locally, and the first useful error message.
