# TrustGraph Repo Snapshot Status

Status: first manual seed path is implemented.

Last updated: 2026-07-09.

## Current State

Footnote has a small checked-in TrustGraph snapshot at
`docs/trustgraph/repo-snapshot.json`.

The snapshot is repo-owned test data for the first real TrustGraph service
smoke path. It is not a production default, and request handling does not read
the snapshot or inspect git.

The current snapshot covers:

- project overview
- package layout
- current TrustGraph notes
- recent commit summaries

This is the first small step in the repo-owned data loading path described in
the [TrustGraph architecture doc](../architecture/context-integrations/trustgraph.md#repo-owned-data-loading).

## Implemented Files

- `docs/trustgraph/repo-snapshot.json`
- `scripts/lib/trustgraph-repo-snapshot.ts`
- `scripts/load-trustgraph-repo-snapshot.ts`
- `scripts/trustgraph-repo-snapshot.test.ts`

## Snapshot Shape

The snapshot keeps only stable, reviewable facts. Loader-time metadata stays in
the seed payload, not in the checked-in snapshot.

```json
{
    "items": [
        {
            "id": "project-overview",
            "title": "Project overview",
            "summary": "Footnote is a transparency- and provenance-focused AI framework.",
            "sourceRef": "repo://README.md"
        }
    ]
}
```

Keep stable IDs and source refs so retrieved TrustGraph evidence can be traced
back to the snapshot.

## Loader Settings

The loader is manual-only and separate from request handling.

Required:

- `TRUSTGRAPH_SEED_ENDPOINT_URL`

Optional:

- `TRUSTGRAPH_SEED_API_TOKEN`
- `TRUSTGRAPH_SEED_USER_ID`
- `TRUSTGRAPH_SEED_PROJECT_ID`
- `TRUSTGRAPH_SEED_COLLECTION_ID`

Default seed scope:

- `userId`: `repo_snapshot_seed_user`
- `projectId`: `footnote_repo_snapshot`

Set only one of `TRUSTGRAPH_SEED_PROJECT_ID` or
`TRUSTGRAPH_SEED_COLLECTION_ID`.

Run:

```sh
pnpm trustgraph:snapshot:validate
pnpm trustgraph:snapshot:load
```

## Smoke Path

1. Run a real TrustGraph service with a seed endpoint and a retrieval endpoint.
2. Load the checked-in snapshot with `pnpm trustgraph:snapshot:load`.
3. Start the backend with the existing retrieval adapter enabled:

```sh
EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED=true
EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_MODE=http
EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_ENDPOINT_URL=<retrieval endpoint>
EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_API_TOKEN=<token>
```

4. If a real ownership validator is available, also set:

```sh
EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_BINDING_MODE=http
EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_ENDPOINT_URL=<ownership endpoint>
EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_API_TOKEN=<token>
```

5. Send a chat request with explicit scope fields matching the seeded scope:

```json
{
    "surfaceContext": {
        "userId": "repo_snapshot_seed_user",
        "channelId": "footnote_repo_snapshot"
    }
}
```

6. Confirm the response includes `metadata.trustGraph.adapterStatus` with
   `success` and that disabling TrustGraph or breaking the adapter endpoint
   still returns a local chat response.

## Validation

Current checks for this status:

- `pnpm trustgraph:snapshot:validate`
- `pnpm lint`
- `pnpm validate-footnote-tags`
- `pnpm review`

## Refresh

Commit summaries should be generated outside request handling. For now, the
checked-in starter snapshot is small enough to maintain by hand.

CI refresh can come later. If added, it should create a normal reviewable diff.
