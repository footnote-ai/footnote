/**
 * @description: Exercises explicit publication, public retrieval, revocation, and private response headers over HTTP.
 * @footnote-scope: test
 * @footnote-module: PublicResponseHandlerTests
 * @footnote-risk: low - Uses temporary SQLite storage and an isolated local HTTP server.
 * @footnote-ethics: high - Guards anonymous publication, revocation, and stale-source privacy boundaries.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMetadata } from './fixtures/responseMetadataFixture.js';
import { createPublicResponsesHandler } from '../src/handlers/publicResponses.js';
import { SqliteTraceStore } from '../src/storage/traces/sqliteTraceStore.js';

const PUBLICATION_TOKEN = 'A'.repeat(43);
const future = (milliseconds: number): string =>
    new Date(Date.now() + milliseconds).toISOString();

const createTestServer = (store: SqliteTraceStore) => {
    const logLabels: string[] = [];
    const handler = createPublicResponsesHandler({
        traceStore: store,
        maxBodyBytes: 128_000,
        logRequest: (_req, res, label = '') => {
            logLabels.push(`${res.statusCode} ${label}`);
        },
    });
    const server = http.createServer(
        (req, res) =>
            void handler.handlePublicResponsesRequest(
                req,
                res,
                new URL(req.url ?? '/', 'http://localhost')
            )
    );
    return { server, logLabels };
};

const listen = async (server: http.Server): Promise<string> => {
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind public response test server');
    }
    return `http://127.0.0.1:${address.port}`;
};

const assertPrivateHeaders = (response: Response): void => {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, noarchive');
};

test('a user can explicitly publish, view, and revoke an allowlisted response', async (t) => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'public-response-http-')
    );
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const { server, logLabels } = createTestServer(store);
    const baseUrl = await listen(server);
    t.after(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    const metadata = {
        ...createMetadata(),
        staleAfter: future(86_400_000),
        citations: [
            {
                title: 'Safe source',
                url: 'https://example.com/reference?secret=not-public#private',
                snippet: 'private source body',
            },
        ],
    };
    const answer = 'The delivered answer.';
    await store.upsert(metadata);
    await store.createPublicResponseSource({
        responseId: metadata.responseId,
        answer,
        publicationToken: PUBLICATION_TOKEN,
        expiresAt: future(7 * 86_400_000),
        metadata,
    });

    const publishResponse = await fetch(`${baseUrl}/api/public-responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            responseId: metadata.responseId,
            answer,
            publicationToken: PUBLICATION_TOKEN,
        }),
    });
    assert.equal(publishResponse.status, 201);
    assertPrivateHeaders(publishResponse);
    const published = (await publishResponse.json()) as {
        publicId: string;
        publishedAt: string;
        expiresAt: string;
    };
    assert.match(published.publicId, /^[A-Za-z0-9_-]{43}$/u);
    const expectedPublicTtlMs = 7 * 24 * 60 * 60 * 1000;
    assert.ok(
        Math.abs(
            Date.parse(published.expiresAt) -
                Date.parse(published.publishedAt) -
                expectedPublicTtlMs
        ) < 1000
    );
    assert.equal(JSON.stringify(published).includes(PUBLICATION_TOKEN), false);

    const pageResponse = await fetch(
        `${baseUrl}/api/public-responses/${published.publicId}`
    );
    assert.equal(pageResponse.status, 200);
    assertPrivateHeaders(pageResponse);
    const page = (await pageResponse.json()) as Record<string, unknown>;
    assert.equal(page.answer, answer);
    assert.equal(page.provenance, metadata.provenance);
    assert.deepEqual(page.sources, []);
    assert.deepEqual(page.limitations, [
        'Source links were omitted because saved citations are not classified as public.',
    ]);
    assert.equal('responseId' in page, false);
    assert.equal(JSON.stringify(page).includes(PUBLICATION_TOKEN), false);
    assert.equal(JSON.stringify(page).includes('private source body'), false);
    assert.equal(JSON.stringify(page).includes('secret='), false);
    assert.equal(JSON.stringify(page).includes('example.com'), false);

    const revokeResponse = await fetch(
        `${baseUrl}/api/public-responses/${published.publicId}`,
        {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ publicationToken: PUBLICATION_TOKEN }),
        }
    );
    assert.equal(revokeResponse.status, 200);
    assertPrivateHeaders(revokeResponse);

    const unavailableResponse = await fetch(
        `${baseUrl}/api/public-responses/${published.publicId}`
    );
    assert.equal(unavailableResponse.status, 410);
    assertPrivateHeaders(unavailableResponse);
    assert.deepEqual(await unavailableResponse.json(), {
        error: 'This published response is no longer available.',
    });
    assert.equal(
        logLabels.every((label) => !label.includes(published.publicId)),
        true
    );
});

test('stale and deleted response sources are unavailable without revealing trace data', async (t) => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'public-response-stale-')
    );
    const store = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const { server } = createTestServer(store);
    const baseUrl = await listen(server);
    t.after(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
        store.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    const staleMetadata = {
        ...createMetadata(),
        staleAfter: new Date(Date.now() - 1000).toISOString(),
    };
    await store.upsert(staleMetadata);
    await store.createPublicResponseSource({
        responseId: staleMetadata.responseId,
        answer: 'Stale answer',
        publicationToken: PUBLICATION_TOKEN,
        expiresAt: future(7 * 86_400_000),
        metadata: staleMetadata,
    });
    const stalePublishResponse = await fetch(
        `${baseUrl}/api/public-responses`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                responseId: staleMetadata.responseId,
                answer: 'Stale answer',
                publicationToken: PUBLICATION_TOKEN,
            }),
        }
    );
    assert.equal(stalePublishResponse.status, 410);
    assertPrivateHeaders(stalePublishResponse);

    const expiringMetadata = {
        ...createMetadata(),
        responseId: 'freshness-expiring-response',
        staleAfter: future(1000),
    };
    await store.upsert(expiringMetadata);
    await store.createPublicResponseSource({
        responseId: expiringMetadata.responseId,
        answer: 'Fresh answer',
        publicationToken: PUBLICATION_TOKEN,
        expiresAt: future(7 * 86_400_000),
        metadata: expiringMetadata,
    });
    const freshPublishResponse = await fetch(
        `${baseUrl}/api/public-responses`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                responseId: expiringMetadata.responseId,
                answer: 'Fresh answer',
                publicationToken: PUBLICATION_TOKEN,
            }),
        }
    );
    assert.equal(freshPublishResponse.status, 201);
    const expiringPage = (await freshPublishResponse.json()) as {
        publicId: string;
    };
    await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    const stalePageResponse = await fetch(
        `${baseUrl}/api/public-responses/${expiringPage.publicId}`
    );
    assert.equal(stalePageResponse.status, 410);
    assertPrivateHeaders(stalePageResponse);
    assert.deepEqual(await stalePageResponse.json(), {
        error: 'This published response is no longer available.',
    });

    const currentMetadata = {
        ...createMetadata(),
        staleAfter: future(86_400_000),
    };
    await store.upsert(currentMetadata);
    await store.createPublicResponseSource({
        responseId: currentMetadata.responseId,
        answer: 'Deleted answer',
        publicationToken: PUBLICATION_TOKEN,
        expiresAt: future(7 * 86_400_000),
        metadata: currentMetadata,
    });
    const currentPublishResponse = await fetch(
        `${baseUrl}/api/public-responses`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                responseId: currentMetadata.responseId,
                answer: 'Deleted answer',
                publicationToken: PUBLICATION_TOKEN,
            }),
        }
    );
    assert.equal(currentPublishResponse.status, 201);
    const published = (await currentPublishResponse.json()) as {
        publicId: string;
    };

    await store.delete(currentMetadata.responseId);
    const deletedPageResponse = await fetch(
        `${baseUrl}/api/public-responses/${published.publicId}`
    );
    assert.equal(deletedPageResponse.status, 404);
    assertPrivateHeaders(deletedPageResponse);
    assert.equal(
        JSON.stringify(await deletedPageResponse.json()).includes(
            currentMetadata.responseId
        ),
        false
    );
});
