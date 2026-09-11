# DeepWiki Maintenance

Repository Markdown and source code are canonical. Update the checked-in docs
with the code or behavior they describe; generated DeepWiki content is a
secondary explanation and may lag behind `main`.

## When to edit `.devin/wiki.json`

Edit the configuration when the DeepWiki structure changes, a material source
entrypoint changes, or durable generation guidance needs to change. An ordinary
code or documentation PR does not edit `.devin/wiki.json` merely because
generated prose may change.

Keep the configuration free of prompts, responses, hidden reasoning, secrets,
private debug payloads, and source bodies. Prefer durable concepts and existing
repository entrypoints over provider defaults or incidental implementation
details.

## Validation

Run `pnpm validate-deepwiki` after changing the configuration. Footnote's
operating target is at most 28 pages and 90 total notes; the hard limits are 30
pages and 100 total notes. Headroom over the operating target is a warning, but
hard-limit, structure, parent-graph, duplicate, and missing-entrypoint errors
must be fixed before handoff.
