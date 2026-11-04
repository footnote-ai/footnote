# Contributor Guide

Footnote uses AI assistance in development, but generated changes still need
human review. The person submitting a change is responsible for understanding
what it does, checking its assumptions, and reporting what they actually
tested. The [AI use disclosure](./ai-use-disclosure.md) explains how the
maintainer approaches this work.

## Getting oriented

Start with the root [AGENTS.md](../../AGENTS.md) and any instructions near the
files you're changing. The [architecture guide](../architecture/README.md)
describes current behavior. [Decisions](../decisions/) explain why certain
choices were made; [proposals](../proposals/index.md) may describe work that
hasn't been adopted.

Issues and project planning use GitHub's native features, as described in
[GitHub work management](./github-work-management.md). Keep your change tied
to its issue, and leave unrelated behavior alone.

## Before opening a PR

Read the diff as if someone else had written it. Check that the code and
documentation agree, that tests exercise the changed behavior, and that
private data or provenance hasn't been exposed. An automated review is useful
evidence, not a replacement for that check.

Run `pnpm format:write`, `pnpm lint`, and `pnpm review --changed-only`.
Then run the checks for what you touched. For documentation work, that
includes:

- `pnpm --filter @footnote/web build:wiki` for wiki source or staging
  changes.
- `pnpm validate-deepwiki` after changing `.devin/wiki.json`.

The root instructions cover API contract checks, module annotations,
deployable packaging, and other specialized tests. In your PR, say what
passed and what you couldn't verify. Formatting and review checks do not
replace behavior tests.
