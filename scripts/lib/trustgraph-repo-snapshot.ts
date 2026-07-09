/**
 * @description: Validates the checked-in TrustGraph repo snapshot and builds manual seed payloads.
 * This keeps repo-owned TrustGraph test data reviewable and outside request handling.
 * @footnote-scope: utility
 * @footnote-module: TrustGraphRepoSnapshot
 * @footnote-risk: medium - Invalid seed data can make first TrustGraph smoke tests misleading.
 * @footnote-ethics: high - Seeded provenance needs stable source links so advisory evidence stays auditable.
 */

import fs from 'node:fs/promises';
import type {
    EvidenceBundle,
    ScopeTuple,
} from '../../packages/backend/src/services/executionContractTrustGraph/index.js';

export const TRUSTGRAPH_REPO_SNAPSHOT_SCHEMA_VERSION = 'repo-snapshot-v1';
export const TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION =
    'footnote-repo-snapshot-loader-v1';

export type TrustGraphRepoSnapshotItem = {
    id: string;
    title: string;
    summary: string;
    sourceRef: string;
};

export type TrustGraphRepoSnapshot = {
    schemaVersion: typeof TRUSTGRAPH_REPO_SNAPSHOT_SCHEMA_VERSION;
    generatedAt: string;
    sourceCommit: string;
    items: TrustGraphRepoSnapshotItem[];
};

export type TrustGraphRepoSnapshotSeedPayload = {
    kind: 'footnote.trustgraph.repo_snapshot_seed';
    schemaVersion: typeof TRUSTGRAPH_REPO_SNAPSHOT_SCHEMA_VERSION;
    generatedAt: string;
    sourceCommit: string;
    itemCount: number;
    bundle: EvidenceBundle;
};

const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{7,40}$/;
const DEFAULT_SCOPE_TUPLE: ScopeTuple = {
    userId: 'repo_snapshot_seed_user',
    projectId: 'footnote_repo_snapshot',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const isIsoTimestamp = (value: string): boolean => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const isSupportedSourceRef = (value: string): boolean => {
    if (/^https?:\/\/\S+$/u.test(value)) {
        return true;
    }
    return /^repo:\/\/\S+$/u.test(value);
};

const assertSnapshotItem = (
    value: unknown,
    index: number
): TrustGraphRepoSnapshotItem => {
    if (!isRecord(value)) {
        throw new Error(`Snapshot item at index ${index} must be an object.`);
    }

    const { id, title, summary, sourceRef } = value;
    if (!isNonEmptyString(id) || !SNAPSHOT_ID_PATTERN.test(id)) {
        throw new Error(
            `Snapshot item at index ${index} has invalid id. Expected kebab-case stable id.`
        );
    }
    if (!isNonEmptyString(title)) {
        throw new Error(`Snapshot item ${id} is missing title.`);
    }
    if (!isNonEmptyString(summary)) {
        throw new Error(`Snapshot item ${id} is missing summary.`);
    }
    if (!isNonEmptyString(sourceRef) || !isSupportedSourceRef(sourceRef)) {
        throw new Error(
            `Snapshot item ${id} has invalid sourceRef. Expected repo:// or https:// reference.`
        );
    }

    return {
        id,
        title: title.trim(),
        summary: summary.trim(),
        sourceRef: sourceRef.trim(),
    };
};

export const parseTrustGraphRepoSnapshot = (
    value: unknown
): TrustGraphRepoSnapshot => {
    if (!isRecord(value)) {
        throw new Error('TrustGraph repo snapshot must be an object.');
    }

    if (value.schemaVersion !== TRUSTGRAPH_REPO_SNAPSHOT_SCHEMA_VERSION) {
        throw new Error(
            `Unsupported TrustGraph repo snapshot schemaVersion: ${String(
                value.schemaVersion
            )}.`
        );
    }
    if (
        !isNonEmptyString(value.generatedAt) ||
        !isIsoTimestamp(value.generatedAt)
    ) {
        throw new Error(
            'TrustGraph repo snapshot generatedAt must be an ISO timestamp.'
        );
    }
    if (
        !isNonEmptyString(value.sourceCommit) ||
        !SOURCE_COMMIT_PATTERN.test(value.sourceCommit)
    ) {
        throw new Error(
            'TrustGraph repo snapshot sourceCommit must be a git SHA.'
        );
    }
    if (!Array.isArray(value.items) || value.items.length === 0) {
        throw new Error(
            'TrustGraph repo snapshot must contain at least one item.'
        );
    }

    const items = value.items.map(assertSnapshotItem);
    const seenIds = new Set<string>();
    for (const item of items) {
        if (seenIds.has(item.id)) {
            throw new Error(
                `TrustGraph repo snapshot contains duplicate item id: ${item.id}.`
            );
        }
        seenIds.add(item.id);
    }

    return {
        schemaVersion: TRUSTGRAPH_REPO_SNAPSHOT_SCHEMA_VERSION,
        generatedAt: value.generatedAt,
        sourceCommit: value.sourceCommit,
        items,
    };
};

export const readTrustGraphRepoSnapshotFile = async (
    snapshotPath: string
): Promise<TrustGraphRepoSnapshot> => {
    const raw = await fs.readFile(snapshotPath, 'utf8');
    return parseTrustGraphRepoSnapshot(JSON.parse(raw) as unknown);
};

const buildCollectionScope = (scopeTuple: ScopeTuple): string => {
    if (scopeTuple.projectId !== undefined) {
        return 'project';
    }
    if (scopeTuple.collectionId !== undefined) {
        return 'collection';
    }
    return 'user';
};

export const buildTrustGraphRepoSnapshotSeedPayload = (
    snapshot: TrustGraphRepoSnapshot,
    scopeTuple: ScopeTuple = DEFAULT_SCOPE_TUPLE
): TrustGraphRepoSnapshotSeedPayload => {
    const collectionScope = buildCollectionScope(scopeTuple);
    const bundle: EvidenceBundle = {
        bundleId: `repo_snapshot_${snapshot.sourceCommit}`,
        queryIntent: 'Footnote repository snapshot seed',
        items: snapshot.items.map((item) => ({
            evidenceId: `repo_snapshot:${item.id}`,
            claimText: `${item.title}: ${item.summary}`,
            sourceRef: item.sourceRef,
            provenancePathRef: [
                `repo-snapshot://${snapshot.schemaVersion}/${item.id}`,
                `repo-commit://${snapshot.sourceCommit}`,
            ],
            retrievalReason: 'repo_snapshot_seed',
            confidenceScore: 1,
            confidenceMethodId: 'repo_snapshot_manual_seed_v1',
            retrievedAt: snapshot.generatedAt,
            collectionScope,
            adapterVersion: TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION,
        })),
        coverageEstimate: {
            evaluationUnit: 'source',
            scoreRange: '0..1',
            value: 1,
            computationBasis: ['checked_in_repo_snapshot'],
            comparableAcrossVersions: false,
            adapterVersion: TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION,
        },
        conflictSignals: [],
        traceRefs: snapshot.items.map(
            (item) => `repo-snapshot://${snapshot.schemaVersion}/${item.id}`
        ),
        scopeTuple,
        adapterVersion: TRUSTGRAPH_REPO_SNAPSHOT_ADAPTER_VERSION,
    };

    return {
        kind: 'footnote.trustgraph.repo_snapshot_seed',
        schemaVersion: snapshot.schemaVersion,
        generatedAt: snapshot.generatedAt,
        sourceCommit: snapshot.sourceCommit,
        itemCount: snapshot.items.length,
        bundle,
    };
};
