# Launcher Canary Releases Status

**Branch:** `agent/nightly-prereleases`

**Status:** Implemented and locally verified on the branch. Pull request
verification and the first `main` canary are still pending.

**Last updated:** 2026-07-22

## Goal

Make accepted launcher changes available before the next stable Footnote
release without treating every build as a new stable minor version.

The first slice will publish a launcher canary after a relevant push to `main`
passes its required checks. Pull requests may build temporary artifacts for
review, but they will not publish a public release.

## Current State

Footnote already has three related delivery paths:

- `.github/workflows/publish-ghcr.yml` publishes the server image as `latest`
  and `sha-<commit>` after pushes to `main`.
- `.github/workflows/launcher-verify.yml` builds launcher packages on Linux,
  macOS, and Windows for pull requests and pushes to `main`.
- `.github/workflows/launcher-release.yml` builds standalone launcher binaries
  for version tags such as `v0.1.1` and attaches them to a GitHub Release.

This branch adds `.github/workflows/launcher-package.yml` as the shared Linux,
macOS, and Windows SEA packaging workflow. Stable releases and SEA spike builds
both call it. The main `ci.yml` workflow detects launcher-relevant changes,
waits for validation, calls the same packaging workflow, and publishes the
verified artifacts as a canary.

The workspace packages are private. Footnote does not currently publish them
to npm. The canary package therefore means the existing standalone launcher
binaries attached to a GitHub prerelease, not an npm package.

## Decisions

### Use a canary channel

A build from each accepted `main` change is a canary. The term `nightly` is
reserved for a future scheduled build that runs at most once per day.

Canary identifiers are unique and identify the source commit. The first release
line uses:

```text
v0.2.0-canary.<ci-run-number>
```

The release notes include the full source commit and workflow run. The base
version is the next intended release line and is changed deliberately in
`ci.yml`; the workflow does not guess or commit package-version changes. If
stable tag `v0.2.0` already exists, publishing fails with instructions to
advance the base version.

### Publish accepted code only

- Build preview artifacts in pull requests when they help review packaging.
- Publish canaries only from `main`.
- Do not publish from pull request refs or contributor branches.
- Treat a successful push to `main` as the release event. This covers both
  merged pull requests and deliberate direct pushes without trying to infer how
  the commit reached `main`.

### Keep release checks in one dependency graph

The publishing job must depend on successful validation and launcher packaging
for the same commit. It must not run as an independent push workflow that can
race the main CI result.

The canary package job uses explicit `needs` dependencies on validation and
change detection. The reusable packaging workflow owns the platform matrix but
cannot publish by itself.

### Build only when launcher inputs change

The canary path should include the launcher packages and their packaging inputs,
including:

- `packages/launcher-cli/**`
- `packages/launcher-core/**`
- `packages/config-spec/**`
- `packages/contracts/**`
- `tools/sea/**`
- the CI, shared packaging, stable release, and SEA spike workflows
- root package, lock, workspace, and TypeScript configuration files

Server-only and web-only changes already receive commit-addressed GHCR images.
They do not need an identical launcher binary republished.

### Keep stable releases unchanged

Stable release tags such as `v0.2.0` remain deliberate maintainer actions.
Canary automation must not move stable tags, mark a canary as the latest stable
release, or change the behavior of `launcher-release.yml`.

### Use narrow permissions

Build jobs need read-only repository access. Only the final publish job may use
`contents: write`. The workflow should pin third-party actions consistently
with the existing release workflow.

## Implementation State

Implemented on this branch:

1. Shared cross-platform SEA build, verification, checksum, and artifact upload
   behavior for stable, spike, and canary packaging.
2. Fail-open launcher input detection for pushes to `main`. If the previous
   commit cannot be compared safely, the launcher is packaged.
3. Explicit validation and packaging dependencies before publishing.
4. Cancellation of obsolete queued packaging work plus a final `main` commit
   check before publication.
5. Asset-count and SHA256 verification before the GitHub prerelease is created.
6. Unique prerelease tags, source/run links, narrow publish permissions, and a
   guard against using a base version whose stable tag already exists.

Local verification completed on 2026-07-22 with the Windows SEA build and
verification commands, the full workspace review and build, the server Docker
build, and `actionlint` across the GitHub workflows.

Remaining rollout work:

1. Complete pull request checks, including the three-platform SEA spike.
2. Merge the branch and inspect the first `main` canary.
3. Record the release link and evidence below.
4. Review release volume after real use, then document a retention policy if
   old canaries become noisy.

## Out of Scope For The First Slice

- publishing workspace packages to npm
- changing the launcher update command
- changing GHCR tags or deployment behavior
- automatically choosing the next stable version
- deleting old canaries before retention needs are understood
- adding a scheduled nightly channel before the canary path is proven
- changing repository branch-protection policy

## Done When

- a relevant accepted commit produces verified artifacts for all supported
  platforms
- the artifacts are attached to a GitHub prerelease tied to that exact commit
- failed validation or packaging cannot publish a canary
- pull requests and unrelated `main` changes cannot publish a canary
- stable tagged releases continue to work without behavior changes
- the CI guide describes the live workflow and recovery steps

## First Release Evidence

Pending the first launcher-relevant run on `main`.

## Related Docs

- [CI guide](../ci/README.md)
- [Documentation map](../README.md)
