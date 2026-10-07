/**
 * @description: Verifies publication capability, expiry, revocation, and source deletion in SQLite.
 * @footnote-scope: test
 * @footnote-module: PublicResponseStoreTests
 * @footnote-risk: low - Exercises isolated temporary storage only.
 * @footnote-ethics: high - Guards publication consent and retention boundaries.
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PublicResponseProjection } from '@footnote/contracts/web';
import { createMetadata } from './fixtures/responseMetadataFixture.js';
import { SqliteTraceStore } from '../src/storage/traces/sqliteTraceStore.js';

const future = (milliseconds: number): string =>
    new Date(Date.now() + milliseconds).toISOString();

test('publication requires the backend-issued answer-bound capability and supports revoke, expiry, and deletion', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'public-response-')
    );
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const metadata = { ...createMetadata(), staleAfter: future(86_400_000) };
    const responseId = metadata.responseId;
    const answer = 'Exact delivered answer';
    const publicationToken = 'backend-issued-capability-token';
    const publishedAt = new Date().toISOString();
    const expiresAt = future(30 * 86_400_000);
    const projection: PublicResponseProjection = {
        answer,
        provenance: 'Inferred',
        sources: [],
        limitations: [],
        publishedAt,
        expiresAt,
    };

    try {
        await store.upsert(metadata);
        await store.upsert({
            ...metadata,
            responseId: `${responseId}-other`,
        });
        await store.createPublicResponseSource({
            responseId,
            answer,
            publicationToken,
            expiresAt: future(7 * 86_400_000),
            metadata,
        });
        const traceRevision =
            await store.retrieveForDisplayWithRevision(responseId);
        assert.ok(traceRevision);

        assert.equal(
            await store.publishPublicResponse({
                responseId,
                answer: 'Changed answer',
                publicationToken,
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'opaque-public-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'invalid'
        );
        assert.equal(
            await store.publishPublicResponse({
                responseId: `${responseId}-other`,
                answer,
                publicationToken,
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'other-response-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'invalid'
        );
        assert.equal(
            await store.publishPublicResponse({
                responseId,
                answer,
                publicationToken: 'wrong-capability',
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'opaque-public-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'invalid'
        );
        assert.equal(
            await store.publishPublicResponse({
                responseId,
                answer,
                publicationToken,
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'opaque-public-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'published'
        );
        assert.equal(
            await store.publishPublicResponse({
                responseId,
                answer,
                publicationToken,
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'replayed-public-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'invalid'
        );
        const publicResponse =
            await store.getPublicResponse('opaque-public-id');
        assert.equal(publicResponse.status, 'published');
        if (publicResponse.status === 'published') {
            assert.deepEqual(publicResponse.projection, projection);
            assert.equal(publicResponse.responseId, responseId);
        }
        assert.equal(
            await store.revokePublicResponse(
                'opaque-public-id',
                'wrong-capability'
            ),
            'invalid'
        );
        assert.equal(
            await store.revokePublicResponse(
                'opaque-public-id',
                publicationToken
            ),
            'revoked'
        );
        assert.equal(
            (await store.getPublicResponse('opaque-public-id')).status,
            'revoked'
        );

        await store.createPublicResponseSource({
            responseId,
            answer,
            publicationToken: 'expires-before-use',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
            metadata,
        });
        assert.equal(
            await store.publishPublicResponse({
                responseId,
                answer,
                publicationToken: 'expires-before-use',
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'another-public-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'expired'
        );

        await store.createPublicResponseSource({
            responseId,
            answer,
            publicationToken: 'delete-with-source',
            expiresAt: future(7 * 86_400_000),
            metadata,
        });
        assert.equal(
            await store.publishPublicResponse({
                responseId,
                answer,
                publicationToken: 'delete-with-source',
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'deleted-source-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'published'
        );
        await store.delete(responseId);
        assert.equal(
            (await store.getPublicResponse('deleted-source-id')).status,
            'not_found'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('expired public response data is not retrievable', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'public-expiry-'));
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const metadata = { ...createMetadata(), staleAfter: future(86_400_000) };
    const answer = 'Answer';
    const publishedAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() - 1).toISOString();
    const projection: PublicResponseProjection = {
        answer,
        provenance: 'Inferred',
        sources: [],
        limitations: [],
        publishedAt,
        expiresAt,
    };

    try {
        await store.upsert(metadata);
        await store.createPublicResponseSource({
            responseId: metadata.responseId,
            answer,
            publicationToken: 'expired-publication',
            expiresAt: future(7 * 86_400_000),
            metadata,
        });
        const traceRevision = await store.retrieveForDisplayWithRevision(
            metadata.responseId
        );
        assert.ok(traceRevision);
        assert.equal(
            await store.publishPublicResponse({
                responseId: metadata.responseId,
                answer,
                publicationToken: 'expired-publication',
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'expired-public-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'published'
        );
        assert.equal(
            (await store.getPublicResponse('expired-public-id')).status,
            'expired'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('updating the source trace invalidates its published snapshot', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'public-update-'));
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const metadata = { ...createMetadata(), staleAfter: future(86_400_000) };
    const answer = 'Published answer';
    const publishedAt = new Date().toISOString();
    const expiresAt = future(30 * 86_400_000);
    const projection: PublicResponseProjection = {
        answer,
        provenance: 'Inferred',
        sources: [],
        limitations: [],
        publishedAt,
        expiresAt,
    };

    try {
        await store.upsert(metadata);
        await store.createPublicResponseSource({
            responseId: metadata.responseId,
            answer,
            publicationToken: 'A'.repeat(43),
            expiresAt: future(7 * 86_400_000),
            metadata,
        });
        const traceRevision = await store.retrieveForDisplayWithRevision(
            metadata.responseId
        );
        assert.ok(traceRevision);
        assert.equal(
            await store.publishPublicResponse({
                responseId: metadata.responseId,
                answer,
                publicationToken: 'A'.repeat(43),
                expectedMetadataSha256: traceRevision.metadataSha256,
                publicId: 'trace-updated-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'published'
        );

        await store.upsert({ ...metadata, provenance: 'Speculative' });
        assert.equal(
            (await store.getPublicResponse('trace-updated-id')).status,
            'unavailable'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});

test('publication rejects a stale trace version even when the answer capability matches', async () => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'public-version-')
    );
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const metadata = { ...createMetadata(), staleAfter: future(86_400_000) };
    const answer = 'Version-bound answer';
    const publishedAt = new Date().toISOString();
    const expiresAt = future(30 * 86_400_000);
    const projection: PublicResponseProjection = {
        answer,
        provenance: 'Inferred',
        sources: [],
        limitations: [],
        publishedAt,
        expiresAt,
    };

    try {
        await store.upsert(metadata);
        await store.createPublicResponseSource({
            responseId: metadata.responseId,
            answer,
            publicationToken: 'A'.repeat(43),
            expiresAt: future(7 * 86_400_000),
            metadata,
        });
        const projectedVersion = await store.retrieveForDisplayWithRevision(
            metadata.responseId
        );
        assert.ok(projectedVersion);

        await store.upsert({ ...metadata, provenance: 'Speculative' });
        assert.equal(
            await store.publishPublicResponse({
                responseId: metadata.responseId,
                answer,
                publicationToken: 'A'.repeat(43),
                expectedMetadataSha256: projectedVersion.metadataSha256,
                publicId: 'stale-version-id',
                projection,
                publishedAt,
                expiresAt,
            }),
            'invalid'
        );
    } finally {
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
