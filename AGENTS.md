# Footnote Agent Contract

This is the canonical ruleset for AI coding agents in this repo. Tool-specific files (for example `cursor.rules`, `.codexrules`, `.github/copilot-instructions.md`) are thin adapters.

## Agent Skills

The skills in `.agents/skills/` are authoritative for how agents work in this
repo: grilling requirements, TDD, code review, triage, specs, and handoffs.
Follow them unless they contradict a Non-Negotiable below.

### Issue tracker

Issues and specs live as GitHub issues in `footnote-ai/footnote`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five triage state labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) plus `area:*` and concern labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: shared glossary at `docs/ai/CONTEXT.md`, decisions in `docs/ai/adr/`. See `docs/agents/domain.md`.

## Project Stage

Footnote is pre-1.0 and changing quickly.
Prefer fast, correct, small-scope delivery over broad compatibility planning.
Do not add migrations, backfills, or compatibility layers unless the user asks.

## What This Repo Is

Footnote is a transparency- and provenance-focused AI framework.

## Package Roles

- `packages/backend`: Public runtime and HTTP boundary for web and Discord.
- `packages/discord-bot`: Discord interface adapter.
- `packages/web`: Browser interface.
- `packages/contracts`: Serializable shared schemas, types, and pure contract helpers. Do not add application orchestration here.
- `packages/api-client`: Typed transport for backend APIs. Do not duplicate backend policy or authority.
- `packages/agent-runtime`: Framework- and provider-specific runtime adapters. Keep Footnote governance semantics outside adapters.
- `packages/prompts`: Prompt defaults, composition, and registry behavior.
- `packages/config-spec`: Shared environment, settings, and bot-profile schemas and templates.
- `packages/launcher-core`: Shared setup, bootstrap, settings, browser, and process-launching behavior.
- `packages/launcher-cli`: Command-line interface built on launcher-core.

## Non-Negotiables

- Use `pnpm` commands.
- Use explicit TypeScript types. Avoid `any`.
- Use structured logging from `packages/discord-bot/src/utils/logger.ts`.
- Keep fail-open behavior: if uncertain, do not block execution.
- Preserve provenance comments and license headers.
- Keep `packages/backend` as the public runtime boundary for web and discord-bot.
- Keep Footnote provenance/trace/auth/incident/review semantics outside framework-specific adapters.
- Keep backend as the authority for LLM cost recording. Discord/web should display cost data already computed by backend or shared pricing helpers.
- Keep public interfaces serializable.

## Required Module Header Format

Use this exact order and include a short rationale on risk and ethics lines.

```ts
/**
 * @description: <1-3 lines>
 * @footnote-scope: <core|utility|interface|web|test>
 * @footnote-module: <ModuleName>
 * @footnote-risk: <low|medium|high> - <technical blast radius>
 * @footnote-ethics: <low|medium|high> - <human/governance impact>
 */
```

## API Boundary Rule

For API boundary changes, keep links in sync:

- code annotations: `@api.operationId` and `@api.path`
- OpenAPI refs: `x-codeRefs` in `docs/api/openapi.yaml`

## GitHub Work Management

Use each GitHub feature for one job. The full working model lives in
`docs/ai/github-work-management.md`. Key facts:

- Use org issue types `Feature`, `Bug`, and `Task`. Do not recreate types as labels.
- Labels describe areas, Footnote concerns, contribution, and automation. Do not
  use labels for priority, workflow status, or milestones.
- Priority, effort, and dates belong in org issue fields. Set dates only when
  work is scheduled. Use the org Project for workflow status.
- Milestones describe finite outcomes.
- Link PRs to the issue they deliver.

## Task Completion Requirements

Keep local verification focused on the files, packages, and behavior changed.
Run the smallest relevant test set. The loop and review process are owned by
the `tdd` and `code-review` skills; these commands always apply:

- Run `pnpm format:write` after edits.
- Run `pnpm review --changed-only` before final handoff.
- Build each affected package when public types, imports, exports, or build
  output change: `pnpm --filter @footnote/<package> build`.
- Backend behavior changes must add or update focused tests and run them.
- Do not routinely run the full `pnpm review`, workspace build, or Docker build
  locally. CI runs `pnpm review` and `pnpm -r build`.
- API boundary changes: `pnpm validate-openapi-links`.
- Startup, provider, environment, deployment, or runtime packaging changes:
  `pnpm test:build`.
- High-risk work or an explicit user request: full `pnpm review` and workspace
  build.
- Non-trivial structural refactors: include 1-2 example evidence links using
  `pnpm refactor:lookup`.
- After a user-visible web behavior change, run one integrated browser smoke
  test of the affected flow when the environment supports it. If browser
  verification is unavailable, say so clearly.
- Focused tests: `pnpm exec tsx --test <test-files>`.
- Report the commands run. If a required check could not run, state why.

## Working Style

### Direct chat endpoint testing

When the backend is reachable, test chat yourself through the canonical
`POST /api/chat` endpoint. Run the command directly:

```powershell
pnpm agent:chat -- --prompt "<prompt>" --surface discord --trigger-kind direct
```

The command loads `AGENT_API_TOKEN` and `BACKEND_BASE_URL` from the repo's
`.env` file; existing process values take precedence. It sends the trusted
auth header, waits for the complete response, prints JSON to stdout, and
prints status, duration, and `responseId` to stderr. Each invocation makes one
request with no automatic retry.

Use `--surface web` and `--trigger-kind submit` for web-shaped behavior. Use
`--request-file <path>` to replay an exact `PostChatRequest`.

If the shell reports that the command is still running, poll that same process
until it exits; do not start a second invocation. For a deployed target, set
`BACKEND_BASE_URL` in `.env` to the target URL. Use browser or Discord testing
only for behavior specific to those adapters. See
`docs/agents/chat-endpoint-testing.md` for request examples and Fly details.

Keep related requests on the same target when testing process-local state.

- Prefer small, focused diffs.
- If the task starts touching multiple concepts, packages, or behavior surfaces,
  stop, report the scope expansion, and wait for confirmation.
- Follow the user's requested change, but preserve existing project boundaries
  unless the prompt explicitly asks to change them. If the prompt appears to
  conflict with core Footnote semantics, stop and ask before rewriting those
  semantics.
- Do not invent runtime facts, command output, or test results.
- If a check was not run, say that clearly.

## Communication Style

Write like a clear, capable maintainer working with other developers. Use plain,
natural language and concrete words. Make explanations easy for a junior
contributor to follow without over-explaining. Lead with the answer or next
action. Keep structure and detail proportional to the task. Prefer specific
observations over generic framing, ceremonial summaries, inflated prose, and
process commentary. Preserve technical precision and state uncertainty plainly.

- Add JSDoc or comments for exported boundary functions,
  workflow/orchestrator/provider/provenance logic, fail-open behavior, and
  authority decisions.
- Do not add comments that only restate obvious code.
