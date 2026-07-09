# Feature Proposal: Local Observability With agent-inspect

**Last updated:** 2026-07-09

## Purpose

Footnote should write a local, inspectable observability artifact by default.
The artifact gives developers and maintainers a readable execution trail without
requiring a hosted account.

Footnote's local trace store stays canonical. The new JSONL file is a derived
projection designed to work with agent-inspect. Langfuse remains optional for
people who want an external observability mirror.

This is a plan, not shipped behavior. The existing Langfuse metadata mirror is
already optional and metadata-only. A local JSONL projection does not exist
yet.

## Why local first

Local observability fits Footnote's existing direction:

- it works in self-hosted and offline-friendly setups;
- maintainers can inspect the output without creating an external account;
- reviewed and redacted artifacts can be attached to issues when useful;
- it keeps the execution trail close to the local provenance store; and
- it supports Footnote's goal of making an answer and its limits checkable.

This is not a plan to turn agent-inspect into Footnote's runtime platform. The
first goal is a small, stable JSONL projection. Before implementation, verify
the target agent-inspect schema and version so the exporter does not claim
compatibility from a look-alike format.

## Current baseline

The backend already has useful local facts to project:

- `ResponseMetadata` is the compact response record.
- `workflowEngine` records step lineage, limits, transitions, review outcomes,
  fallback behavior, and termination reasons.
- the SQLite trace store persists canonical provenance metadata locally.
- the current Langfuse exporter runs after trace persistence and sends a
  bounded metadata projection only.

The JSONL file is derived from `ResponseMetadata` and the SQLite trace store.
Losing it must not alter trace retrieval, provenance, cost recording, or
response behavior.

## Boundaries

| Concern                  | Owner                                        | Rule                                                                     |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------ |
| Canonical response trace | Footnote trace store                         | Persist it before any projection or mirror work.                         |
| Local JSONL              | Footnote exporter                            | Write a redacted, derived record. It is inspectable, not authoritative.  |
| Langfuse                 | Optional external exporter                   | Mirror only when explicitly enabled. It cannot decide runtime behavior.  |
| TrustGraph               | Context integration and later index consumer | It may ingest or index derived artifacts later. It is not runtime truth. |

The existing rule still applies: Langfuse observes; Footnote decides. The same
rule applies to any future index over these files.

## Proposed shape

Add one backend-owned observability exporter seam with two initial sinks:

1. A local JSONL sink, enabled by the local observability setting.
2. The existing Langfuse metadata mirror, treated as an optional external sink.

The exporter runs only after canonical trace persistence succeeds. It is
best-effort and fail-open: an exporter error is logged with safe diagnostics,
but the answer path continues normally. A slow or unavailable external service
must never hold the response open.

The local sink should append one completed-run record per JSONL line. It should
write through an atomic or otherwise corruption-resistant append strategy, and
its failure handling should be tested separately from canonical persistence.

The first format should be small enough to read in an editor. A conceptual
record looks like this:

```json
{
    "responseId": "resp_123",
    "runId": "workflow_123",
    "workflow": {
        "mode": "balanced",
        "terminationReason": "goal_satisfied",
        "steps": [{ "name": "generate", "status": "executed" }]
    },
    "model": { "provider": "openai", "model": "..." },
    "review": { "status": "finalized" },
    "usage": { "totalTokens": 0, "totalCostUsd": 0 }
}
```

The example is a boundary sketch, not a committed schema. The implementation
should map Footnote's current metadata and workflow records into the verified
agent-inspect-compatible shape without leaking raw request content.

## Configuration

Footnote keeps normal operator settings in `footnote.yaml` and secrets in the
environment. The eventual config should follow that split and use the existing
lower-case, kebab-case YAML style. For example:

```yaml
trace:
    observability:
        local:
            enabled: true
            output-directory: '/data/observability'
            redaction-profile: 'metadata-only'
        langfuse:
            enabled: false
```

Langfuse credentials stay in secret environment variables. The present mirror
already uses `LANGFUSE_METADATA_MIRROR_ENABLED` plus its credential settings.
Use one explicit enable switch: credentials or other Langfuse environment
variables must never turn on external export by themselves.

The exact YAML path and compatibility handling belong to the implementation
slice, because `packages/config-spec` is the source for the generated settings
surface. The first slice also needs a retention limit and safe file
permissions. Keep the redaction profiles limited and clear, such as
`metadata-only` and a future stricter profile. Do not make raw-content export
a default profile.

## Event mapping

The local record should describe a run as a bounded execution tree. Prefer
existing Footnote names and reason codes over a second set of inferred labels.

| Footnote fact                     | Local projection                                        |
| --------------------------------- | ------------------------------------------------------- |
| Response and workflow identifiers | `responseId` and run/workflow identifier                |
| Mode and workflow profile         | workflow mode and name                                  |
| Model routing                     | provider, selected model, and fallback count or reason  |
| `StepRecord` lineage              | step name, parent, status, duration, and attempt        |
| Tool activity                     | tool name, status, and reason code only                 |
| Review or revision                | assess outcome, revision occurrence, and final status   |
| Limits and failures               | termination reason and bounded failure/fallback reason  |
| Existing usage data               | token and cost summary when backend already recorded it |

Do not turn `StepRecord.signals` into an unbounded dump. Project only reviewed,
documented fields that help reconstruct the outcome.

## Privacy and security

Local trace files are sensitive artifacts even when their records are
metadata-only. Metadata can expose timing, model selection, identifiers, and
the shape of a user's activity.

The default projection must exclude:

- raw prompts and user messages;
- raw assistant text;
- tool request or response bodies;
- planner payloads and review prompt payloads;
- unredacted source content;
- secrets, trace tokens, credentials, and local paths.

Before local output is enabled, add the chosen directory to `.gitignore` and a
short `SECURITY.md` note that these files need the same care as other sensitive
local data. The configured retention and permissions should be covered there
as well.

## Tests

The implementation slice should prove the boundary rather than just the file
write:

- a disabled local sink does nothing;
- an enabled local sink writes the expected JSONL record shape;
- a sink failure does not break answer generation;
- canonical trace persistence happens before local or external export;
- redaction removes common secret-like fields;
- raw prompt, output, tool body, and planner payload fields are absent; and
- Langfuse credentials do not enable external export without an explicit flag.

Use fixtures that cover a normal completed run, a reviewed revision, and a
fail-open workflow outcome.

## Phased plan

1. Inventory the current trace store, `ResponseMetadata`, workflow records,
   config spec, and Langfuse call path.
2. Define the local observability settings, retention, file permissions, and
   redaction policy in the config spec and operator docs.
3. Introduce the small exporter interface after canonical trace persistence.
4. Implement the local JSONL sink against a verified agent-inspect-compatible
   schema.
5. Keep Langfuse as an explicitly enabled external sink and update its docs to
   describe it as a mirror.
6. Add persistence-order, redaction, disabled, and fail-open tests, plus the
   small `.gitignore` and security notes.
7. Later, consider TrustGraph ingestion or indexing of derived artifacts.

## Related code and docs

- `packages/backend/src/storage/traces/sqliteTraceStore.ts`
- `packages/backend/src/services/responseMetadata.ts`
- `packages/backend/src/services/workflowEngine.ts`
- `packages/backend/src/services/langfuseMetadataMirrorExporter.ts`
- `packages/config-spec/src/env-spec.ts`
- [Workflow](../architecture/workflow.md)
- [Langfuse Metadata Mirror](../architecture/langfuse-metadata-mirror.md)
- [TrustGraph](../architecture/context-integrations/trustgraph.md)
- [Security Policy](../../SECURITY.md)
