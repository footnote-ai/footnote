/**
 * @description: Covers trace-card API create/read behavior including auth, validation, and asset retrieval.
 * @footnote-scope: test
 * @footnote-module: TraceCardHandlerTests
 * @footnote-risk: medium - Missing coverage could regress trusted-write/public-read behavior for trace-card assets.
 * @footnote-ethics: medium - Trace-card routes directly affect provenance visibility and trust signals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import type { ResponseMetadata } from '@footnote/contracts/policy';
import { createTraceHandlers } from '../src/handlers/trace.js';
import { SimpleRateLimiter } from '../src/services/rateLimiter.js';
import { renderTraceCardSvg } from '../src/services/traceCard/traceCardSvg.js';
import { SqliteTraceStore } from '../src/storage/traces/sqliteTraceStore.js';

type TestServer = {
    close: () => Promise<void>;
    url: string;
    dbPath: string;
    store: SqliteTraceStore;
    cleanup: () => Promise<void>;
};

const TRACE_TOKEN = 'trace-card-test-token';

type TraceStoreFactory = (dbPath: string) => SqliteTraceStore;

class DeletesTraceDuringCardWriteStore extends SqliteTraceStore {
    public deletionObserved = false;

    override async upsertTraceCardSvgWithPlaceholder(
        responseId: string,
        svg: string,
        placeholder: ResponseMetadata
    ): Promise<boolean> {
        this.deletionObserved = true;
        await this.delete(responseId);
        return super.upsertTraceCardSvgWithPlaceholder(
            responseId,
            svg,
            placeholder
        );
    }
}

const createTestServer = async (
    createStore: TraceStoreFactory = (dbPath) =>
        new SqliteTraceStore({ dbPath })
): Promise<TestServer> => {
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'trace-card-api-')
    );
    const dbPath = path.join(tempRoot, 'provenance.db');
    const store = createStore(dbPath);
    const handlers = createTraceHandlers({
        traceStore: store,
        logRequest: () => undefined,
        traceWriteLimiter: new SimpleRateLimiter({ limit: 20, window: 60000 }),
        traceToken: TRACE_TOKEN,
        maxTraceBodyBytes: 20000,
        trustProxy: false,
    });

    const server = http.createServer((req, res) => {
        if (!req.url) {
            res.statusCode = 400;
            res.end();
            return;
        }

        const parsedUrl = new URL(req.url, 'http://localhost');

        if (parsedUrl.pathname === '/api/trace-cards') {
            void handlers.handleTraceCardCreateRequest(req, res);
            return;
        }

        if (parsedUrl.pathname === '/api/trace-cards/from-trace') {
            void handlers.handleTraceCardFromTraceRequest(req, res);
            return;
        }

        if (parsedUrl.pathname.endsWith('/assets/trace-card.svg')) {
            void handlers.handleTraceCardAssetRequest(req, res, parsedUrl);
            return;
        }

        if (parsedUrl.pathname.endsWith('/response-versions')) {
            void handlers.handleResponseVersionsRequest(req, res, parsedUrl);
            return;
        }

        res.statusCode = 404;
        res.end();
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    return {
        url: `http://127.0.0.1:${address.port}`,
        dbPath: path.join(tempRoot, 'provenance.db'),
        store,
        close: () =>
            new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            }),
        cleanup: async () => {
            store.close();
            await fs.rm(tempRoot, { recursive: true, force: true });
        },
    };
};

test('POST /api/trace-cards does not replace an unreadable trace with a placeholder', async () => {
    const server = await createTestServer();
    const responseId = 'trace_card_invalid_existing_123';
    const metadata: ResponseMetadata = {
        responseId,
        provenance: 'Retrieved',
        safetyTier: 'Low',
        tradeoffCount: 1,
        chainHash: 'existing_trace_hash',
        licenseContext: 'Existing trace must remain intact',
        modelVersion: 'gpt-5-mini',
        staleAfter: new Date(Date.now() + 60000).toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
    };

    try {
        await server.store.upsert(metadata);
        const database = new Database(server.dbPath);
        database
            .prepare(
                `UPDATE provenance_traces
                 SET metadata_json = @metadata_json
                 WHERE response_id = @response_id`
            )
            .run({
                response_id: responseId,
                metadata_json: JSON.stringify({
                    ...metadata,
                    execution: [
                        {
                            kind: 'generation',
                            status: 'executed',
                            usage: { unknownUsageField: 1 },
                        },
                    ],
                }),
            });
        database.close();

        const response = await fetch(`${server.url}/api/trace-cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Trace-Token': TRACE_TOKEN,
            },
            body: JSON.stringify({
                responseId,
                temperament: { tightness: 3 },
            }),
        });

        assert.equal(response.status, 200);
        assert.equal(await server.store.has(responseId), true);
        assert.equal(
            await server.store.retrieve(responseId),
            null,
            'invalid metadata remains unreadable rather than being presented as a valid trace'
        );

        const verificationDatabase = new Database(server.dbPath);
        const row = verificationDatabase
            .prepare(
                `SELECT metadata_json FROM provenance_traces WHERE response_id = ?`
            )
            .get(responseId) as { metadata_json: string } | undefined;
        verificationDatabase.close();
        assert.ok(row);
        const stored = JSON.parse(row.metadata_json) as {
            licenseContext?: string;
        };
        assert.equal(
            stored.licenseContext,
            metadata.licenseContext,
            'trace-card preview must not overwrite an existing invalid trace'
        );
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards survives deletion of an unreadable trace during the write', async () => {
    const server = await createTestServer(
        (dbPath) => new DeletesTraceDuringCardWriteStore({ dbPath })
    );
    const responseId = 'trace_card_deleted_during_write_123';
    const metadata: ResponseMetadata = {
        responseId,
        provenance: 'Retrieved',
        safetyTier: 'Low',
        tradeoffCount: 1,
        chainHash: 'existing_trace_hash',
        licenseContext: 'Existing trace must be deleted during the test.',
        modelVersion: 'gpt-5-mini',
        staleAfter: new Date(Date.now() + 60000).toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
    };

    try {
        await server.store.upsert(metadata);
        const database = new Database(server.dbPath);
        database
            .prepare(
                `UPDATE provenance_traces
                 SET metadata_json = @metadata_json
                 WHERE response_id = @response_id`
            )
            .run({
                response_id: responseId,
                metadata_json: JSON.stringify({
                    ...metadata,
                    execution: [
                        {
                            kind: 'generation',
                            status: 'executed',
                            usage: { unknownUsageField: 1 },
                        },
                    ],
                }),
            });
        database.close();

        const response = await fetch(`${server.url}/api/trace-cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Trace-Token': TRACE_TOKEN,
            },
            body: JSON.stringify({
                responseId,
                temperament: { tightness: 3 },
            }),
        });

        assert.equal(response.status, 200);
        assert.equal(
            (server.store as DeletesTraceDuringCardWriteStore).deletionObserved,
            true
        );
        assert.ok(await server.store.getTraceCardSvg(responseId));
        assert.ok(await server.store.retrieve(responseId));
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards returns PNG payload and stores SVG asset', async () => {
    const server = await createTestServer();

    try {
        const createResponse = await fetch(`${server.url}/api/trace-cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Trace-Token': TRACE_TOKEN,
            },
            body: JSON.stringify({
                responseId: 'trace_card_response_123',
                temperament: {
                    tightness: 5,
                    rationale: 3,
                    attribution: 4,
                    caution: 3,
                    extent: 4,
                },
                chips: {
                    evidenceScore: 4,
                    freshnessScore: 5,
                },
            }),
        });

        assert.equal(createResponse.status, 200);
        const createPayload = (await createResponse.json()) as {
            responseId: string;
            pngBase64: string;
        };

        assert.equal(createPayload.responseId, 'trace_card_response_123');
        assert.ok(createPayload.pngBase64.length > 32);

        const pngBytes = Buffer.from(createPayload.pngBase64, 'base64');
        assert.equal(pngBytes[0], 0x89);
        assert.equal(pngBytes[1], 0x50);
        assert.equal(pngBytes[2], 0x4e);
        assert.equal(pngBytes[3], 0x47);

        const assetResponse = await fetch(
            `${server.url}/api/traces/${encodeURIComponent(createPayload.responseId)}/assets/trace-card.svg`
        );
        assert.equal(assetResponse.status, 200);
        assert.equal(
            assetResponse.headers.get('content-type'),
            'image/svg+xml; charset=utf-8'
        );
        const svg = await assetResponse.text();
        assert.match(svg, /<svg[^>]*>/);
        assert.match(svg, /TRACE card/);
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('GET /api/traces/:responseId/response-versions returns ordered candidates and stale envelopes', async () => {
    const server = await createTestServer();
    const responseId = 'response_versions_123';
    try {
        await server.store.upsert(
            {
                responseId,
                provenance: 'Inferred',
                safetyTier: 'Low',
                tradeoffCount: 1,
                chainHash: 'versions_hash',
                licenseContext: 'MIT + HL3',
                modelVersion: 'gpt-5-mini',
                staleAfter: new Date(Date.now() + 60000).toISOString(),
                citations: [],
                trace_target: {},
                trace_final: {},
            },
            [
                {
                    id: 'candidate_earlier',
                    workflowStepId: 'step_1',
                    sequence: 0,
                    stage: 'initial_generation',
                    state: 'superseded',
                    text: 'Earlier answer.',
                },
                {
                    id: 'candidate_final',
                    parentCandidateId: 'candidate_earlier',
                    workflowStepId: 'step_2',
                    sequence: 1,
                    stage: 'revision',
                    state: 'selected',
                    text: 'Final answer.',
                },
            ]
        );
        const response = await fetch(
            `${server.url}/api/traces/${responseId}/response-versions`
        );
        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            responseId: string;
            candidates: Array<{ id: string; text: string; state: string }>;
        };
        assert.equal(payload.responseId, responseId);
        assert.deepEqual(payload.candidates, [
            {
                id: 'candidate_earlier',
                workflowStepId: 'step_1',
                sequence: 0,
                stage: 'initial_generation',
                state: 'superseded',
                text: 'Earlier answer.',
            },
            {
                id: 'candidate_final',
                parentCandidateId: 'candidate_earlier',
                workflowStepId: 'step_2',
                sequence: 1,
                stage: 'revision',
                state: 'selected',
                text: 'Final answer.',
            },
        ]);
        await server.store.upsert({
            responseId,
            provenance: 'Inferred',
            safetyTier: 'Low',
            tradeoffCount: 1,
            chainHash: 'versions_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() - 1000).toISOString(),
            citations: [],
            trace_target: {},
            trace_final: {},
        });
        const staleResponse = await fetch(
            `${server.url}/api/traces/${responseId}/response-versions`
        );
        assert.equal(staleResponse.status, 410);
        const stalePayload = (await staleResponse.json()) as {
            message: string;
            candidates: Array<{ id: string }>;
        };
        assert.equal(stalePayload.message, 'Trace is stale');
        assert.deepEqual(
            stalePayload.candidates.map((candidate) => candidate.id),
            ['candidate_earlier', 'candidate_final']
        );
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards rejects missing trace token', async () => {
    const server = await createTestServer();

    try {
        const response = await fetch(`${server.url}/api/trace-cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                temperament: {
                    tightness: 5,
                    rationale: 3,
                    attribution: 4,
                    caution: 3,
                    extent: 4,
                },
            }),
        });

        assert.equal(response.status, 401);
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards accepts minimal payload and returns PNG', async () => {
    const server = await createTestServer();

    try {
        const response = await fetch(`${server.url}/api/trace-cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Trace-Token': TRACE_TOKEN,
            },
            body: JSON.stringify({
                responseId: 'trace_card_minimal_123',
            }),
        });

        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            responseId: string;
            pngBase64: string;
        };
        assert.equal(payload.responseId, 'trace_card_minimal_123');
        assert.ok(payload.pngBase64.length > 32);
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards rejects invalid payloads', async () => {
    const server = await createTestServer();

    try {
        const response = await fetch(`${server.url}/api/trace-cards`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Trace-Token': TRACE_TOKEN,
            },
            body: JSON.stringify({
                temperament: {
                    tightness: 5,
                    rationale: 3,
                    attribution: 4,
                    caution: 3,
                    extent: 4,
                },
                chips: {
                    evidenceScore: 6,
                    freshnessScore: 4,
                },
            }),
        });

        assert.equal(response.status, 400);
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('GET trace-card SVG returns 404 when asset is missing', async () => {
    const server = await createTestServer();

    try {
        const response = await fetch(
            `${server.url}/api/traces/missing_response/assets/trace-card.svg`
        );
        assert.equal(response.status, 404);
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards/from-trace uses stored metadata trace_final and chip scores', async () => {
    const server = await createTestServer();
    const responseId = 'from_trace_response_123';
    const traceTarget = {
        tightness: 2,
        rationale: 3,
        attribution: 5,
        caution: 2,
        extent: 4,
    } as const;
    const traceFinal = {
        tightness: 5,
        rationale: 4,
        attribution: 5,
        caution: 2,
        extent: 4,
    } as const;

    try {
        await server.store.upsert({
            responseId,
            provenance: 'Retrieved',
            safetyTier: 'High',
            tradeoffCount: 3,
            chainHash: 'chain_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() + 60000).toISOString(),
            citations: [],
            trace_target: traceTarget,
            trace_final: traceFinal,
            trace_final_reason_code: 'runtime_posture_adjustment',
            evidenceScore: 4,
            freshnessScore: 3,
        });

        const response = await fetch(
            `${server.url}/api/trace-cards/from-trace`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Trace-Token': TRACE_TOKEN,
                },
                body: JSON.stringify({
                    responseId,
                }),
            }
        );

        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            responseId: string;
            pngBase64: string;
        };
        assert.equal(payload.responseId, responseId);
        assert.ok(payload.pngBase64.length > 32);
        const storedSvg = await server.store.getTraceCardSvg(responseId);
        assert.ok(storedSvg);
        assert.equal(
            storedSvg,
            renderTraceCardSvg({
                temperament: traceFinal,
                chips: {
                    evidenceScore: 4,
                    freshnessScore: 3,
                },
            }),
            'trace-card should render from trace_final'
        );
        assert.notEqual(
            storedSvg,
            renderTraceCardSvg({
                temperament: traceTarget,
                chips: {
                    evidenceScore: 4,
                    freshnessScore: 3,
                },
            }),
            'trace-card should not render from trace_target when values differ'
        );
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards/from-trace renders successfully when stored chip scores are missing', async () => {
    const server = await createTestServer();
    const responseId = 'from_trace_missing_scores';

    try {
        await server.store.upsert({
            responseId,
            provenance: 'Retrieved',
            safetyTier: 'Medium',
            tradeoffCount: 2,
            chainHash: 'chain_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() + 60000).toISOString(),
            citations: [],
            trace_target: {
                tightness: 4,
                rationale: 3,
                attribution: 5,
                caution: 2,
                extent: 4,
            },
            trace_final: {
                tightness: 4,
                rationale: 3,
                attribution: 5,
                caution: 2,
                extent: 4,
            },
        });

        const response = await fetch(
            `${server.url}/api/trace-cards/from-trace`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Trace-Token': TRACE_TOKEN,
                },
                body: JSON.stringify({ responseId }),
            }
        );

        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            responseId: string;
            pngBase64: string;
        };
        assert.equal(payload.responseId, responseId);
        assert.ok(payload.pngBase64.length > 32);
    } finally {
        await server.close();
        await server.cleanup();
    }
});

test('POST /api/trace-cards/from-trace renders successfully when stored trace_final is empty', async () => {
    const server = await createTestServer();
    const responseId = 'from_trace_missing_trace_final';

    try {
        await server.store.upsert({
            responseId,
            provenance: 'Retrieved',
            safetyTier: 'Low',
            tradeoffCount: 0,
            chainHash: 'chain_hash',
            licenseContext: 'MIT + HL3',
            modelVersion: 'gpt-5-mini',
            staleAfter: new Date(Date.now() + 60000).toISOString(),
            citations: [],
            trace_target: {},
            trace_final: {},
        });

        const response = await fetch(
            `${server.url}/api/trace-cards/from-trace`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Trace-Token': TRACE_TOKEN,
                },
                body: JSON.stringify({
                    responseId,
                }),
            }
        );

        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
            responseId: string;
            pngBase64: string;
        };
        assert.equal(payload.responseId, responseId);
        assert.ok(payload.pngBase64.length > 32);
    } finally {
        await server.close();
        await server.cleanup();
    }
});
