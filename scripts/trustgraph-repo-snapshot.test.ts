/**
 * @description: Verifies TrustGraph repo snapshot validation and manual seed payload creation.
 * These tests keep the first real TrustGraph smoke fixture stable, scoped, and auditable.
 * @footnote-scope: test
 * @footnote-module: TrustGraphRepoSnapshotTests
 * @footnote-risk: medium - Weak fixture validation can make external TrustGraph smoke results hard to trust.
 * @footnote-ethics: high - Provenance seed data needs clear source refs and stable IDs for reviewer accountability.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildTrustGraphRepoSnapshotSeedPayload,
    parseTrustGraphRepoSnapshot,
    readTrustGraphRepoSnapshotFile,
    TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION,
} from './lib/trustgraph-repo-snapshot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotPath = path.join(
    __dirname,
    '../docs/trustgraph/repo-snapshot.v1.json'
);

const createSnapshot = () => ({
    schemaVersion: 'repo-snapshot-v1',
    generatedAt: '2026-07-09T00:00:00.000Z',
    sourceCommit: '78460c720be7',
    items: [
        {
            id: 'project-overview',
            title: 'Project overview',
            summary: 'Footnote is a provenance-focused AI framework.',
            sourceRef: 'repo://README.md',
        },
        {
            id: 'trustgraph-notes',
            title: 'TrustGraph notes',
            summary: 'TrustGraph stays advisory in the backend runtime path.',
            sourceRef:
                'repo://docs/architecture/context-integrations/trustgraph.md',
        },
    ],
});

test('checked-in TrustGraph repo snapshot parses', async () => {
    const snapshot = await readTrustGraphRepoSnapshotFile(snapshotPath);

    assert.equal(snapshot.schemaVersion, 'repo-snapshot-v1');
    assert.equal(snapshot.sourceCommit, '78460c720be7');
    assert.equal(snapshot.items.length, 4);
});

test('unsupported snapshot schema version fails', () => {
    assert.throws(
        () =>
            parseTrustGraphRepoSnapshot({
                ...createSnapshot(),
                schemaVersion: 'repo-snapshot-v2',
            }),
        /Unsupported TrustGraph repo snapshot schemaVersion/
    );
});

test('duplicate snapshot item ids fail', () => {
    const snapshot = createSnapshot();
    assert.throws(
        () =>
            parseTrustGraphRepoSnapshot({
                ...snapshot,
                items: [snapshot.items[0], snapshot.items[0]],
            }),
        /duplicate item id/
    );
});

test('empty required snapshot fields fail', () => {
    const snapshot = createSnapshot();
    assert.throws(
        () =>
            parseTrustGraphRepoSnapshot({
                ...snapshot,
                items: [{ ...snapshot.items[0], summary: '' }],
            }),
        /missing summary/
    );
});

test('invalid source refs fail', () => {
    const snapshot = createSnapshot();
    assert.throws(
        () =>
            parseTrustGraphRepoSnapshot({
                ...snapshot,
                items: [{ ...snapshot.items[0], sourceRef: 'local file' }],
            }),
        /invalid sourceRef/
    );
});

test('seed payload preserves stable IDs, source refs, source commit, and summaries', () => {
    const snapshot = parseTrustGraphRepoSnapshot(createSnapshot());
    const payload = buildTrustGraphRepoSnapshotSeedPayload(snapshot, {
        userId: 'user_1',
        projectId: 'project_1',
    });

    assert.equal(payload.sourceCommit, snapshot.sourceCommit);
    assert.equal(payload.itemCount, snapshot.items.length);
    assert.equal(payload.bundle.scopeTuple.userId, 'user_1');
    assert.equal(payload.bundle.scopeTuple.projectId, 'project_1');
    assert.deepEqual(
        payload.bundle.items.map((item) => item.evidenceId),
        ['repo_snapshot:project-overview', 'repo_snapshot:trustgraph-notes']
    );
    assert.deepEqual(
        payload.bundle.items.map((item) => item.sourceRef),
        snapshot.items.map((item) => item.sourceRef)
    );
    assert.equal(
        payload.bundle.items[0]?.claimText.includes(
            snapshot.items[0]?.summary ?? ''
        ),
        true
    );
});

test('seed payload matches the existing EvidenceBundle contract shape', () => {
    const snapshot = parseTrustGraphRepoSnapshot(createSnapshot());
    const payload = buildTrustGraphRepoSnapshotSeedPayload(snapshot);

    assert.equal(payload.bundle.bundleId, 'repo_snapshot_78460c720be7');
    assert.equal(payload.bundle.queryIntent.length > 0, true);
    assert.equal(payload.bundle.items.length, 2);
    assert.equal(payload.bundle.coverageEstimate.evaluationUnit, 'source');
    assert.equal(payload.bundle.coverageEstimate.scoreRange, '0..1');
    assert.equal(payload.bundle.coverageEstimate.value, 1);
    assert.deepEqual(payload.bundle.conflictSignals, []);
    assert.equal(payload.bundle.traceRefs.length, 2);
    assert.equal(
        payload.bundle.adapterVersion,
        TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION
    );
    assert.equal(
        payload.bundle.items.every(
            (item) =>
                item.adapterVersion ===
                    TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION &&
                item.provenancePathRef.includes('repo-commit://78460c720be7')
        ),
        true
    );
});
