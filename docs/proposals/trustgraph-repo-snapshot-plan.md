# TrustGraph Repo Snapshot Plan

Current purpose: feature branch plan.

Status: draft.

Last updated: 2026-07-08.

## Goal

Make TrustGraph easy to test with real repo-owned data.

The branch should add a small checked-in snapshot about this repo, then provide
a simple way to load that snapshot into a real TrustGraph deployment. The
backend should keep using the normal TrustGraph HTTP adapter.

This is the first small step in the repo-owned data loading path described in
the [TrustGraph architecture doc](../architecture/context-integrations/trustgraph.md#repo-owned-data-loading).

The first snapshot should stay small:

- project overview
- package layout
- current TrustGraph notes
- recent commit summaries

## Boundaries

Request handling should not inspect git or read snapshot files. Snapshot loading
belongs in setup or tooling before requests run.

Repo snapshot data should not become a production default. This branch is only
for making real TrustGraph test setup easier.

## First Branch

Name: Minimal snapshot seed.

Scope:

- add one versioned snapshot file
- validate the snapshot shape
- add the smallest loader needed to send the snapshot to TrustGraph
- document the service settings needed to run the loader
- keep backend retrieval on the existing HTTP adapter path
- add focused tests for snapshot validation and seed payload creation
- add a smoke path for loading the data and seeing TrustGraph metadata in chat

Done when:

- a developer can run a real TrustGraph service
- the repo snapshot can be loaded into that service
- a scoped chat request can retrieve seeded evidence
- TrustGraph metadata appears on the response
- disabling or breaking TrustGraph still leaves local chat behavior intact
- no production default changes

## Snapshot Shape

Use structured JSON with a version and source commit.

Example:

```json
{
  "schemaVersion": "repo-snapshot-v1",
  "generatedAt": "2026-07-08T00:00:00.000Z",
  "sourceCommit": "<git-sha>",
  "items": [
    {
      "id": "project-overview",
      "title": "Project overview",
      "summary": "Footnote is a transparency- and provenance-focused AI framework.",
      "sourceRef": "repo://docs/README.md"
    }
  ]
}
```

Keep stable IDs and source refs so retrieved TrustGraph evidence can be traced
back to the snapshot and source commit.

## Refresh

Commit summaries should be generated outside request handling.

For branch 1, a checked-in starter snapshot is enough. Add a refresh script only
if hand-editing the starter snapshot is more awkward than the script.

CI refresh can come later. If it is added, it should create a normal reviewable
diff.
