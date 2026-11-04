# Contributor Guide

This guide points contributors to the rules and checks maintained for the
repository. For how Footnote uses AI in its own development, see the
[AI use disclosure](./ai-use-disclosure.md).

## Before changing code or docs

Read the root [AGENTS.md](../../AGENTS.md), then check the instructions nearest
to the files you will edit. Use the issue tracker and existing decisions to
understand scope. Keep changes focused, preserve unrelated work, and make a
human pass over any AI-assisted output before opening a PR.

Use GitHub's native planning features as described in
[GitHub work management](./github-work-management.md). Current concepts live
in `docs/architecture/`; decisions and proposals are kept separately in
`docs/decisions/` and `docs/proposals/`.

## Checks

Always run:

- `pnpm format:write` after edits.
- `pnpm review --changed-only` before handoff.

Run the checks for the area you changed. For example, use
`pnpm validate-deepwiki` after editing `.devin/wiki.json`, `pnpm build:wiki`
for public wiki source or staging changes, and focused tests for behavior that
could be affected. The root instructions list checks for API contracts,
annotation tags, and deployable runtime packaging.

Do not substitute a passing formatting or review check for a behavior test.
Report exactly which checks ran and whether any result is unverified.
