/**
 * @description: Verifies the native TrustGraph Graph RAG transport and honest aggregate provenance mapping.
 * Fake HTTP servers keep malformed, bounded, authenticated, and cancelled responses deterministic.
 * @footnote-scope: test
 * @footnote-module: TrustGraphHttpAdapterTests
 * @footnote-risk: medium - Missing transport tests can accept unbounded or incorrectly attributed external context.
 * @footnote-ethics: high - Source validation and credential redaction protect answer provenance and user trust.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
    HttpTrustGraphEvidenceAdapter,
    type TrustGraphGraphRagLimits,
} from '../src/services/executionContractTrustGraph/trustGraphHttpAdapter.js';

const TEST_LIMITS: TrustGraphGraphRagLimits = {
    maxQueryChars: 80,
    entityLimit: 12,
    tripleLimit: 8,
    maxSubgraphSize: 100,
    maxPathLength: 2,
    maxResponseChars: 100,
    maxSources: 2,
    maxSourceUriChars: 80,
    maxSourceTitleChars: 40,
};

const createAdapter = (baseUrl: string): HttpTrustGraphEvidenceAdapter =>
    new HttpTrustGraphEvidenceAdapter({
        baseUrl,
        flow: 'default',
        collection: 'footnote-repository-context',
        apiToken: 'secret-token-for-test',
        workspaceRef: 'default',
        limits: TEST_LIMITS,
    });

const startServer = async (
    handler: (
        request: http.IncomingMessage,
        response: http.ServerResponse
    ) => void
): Promise<{ server: http.Server; baseUrl: string }> => {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return {
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
    };
};

const closeServer = async (server: http.Server): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
};

const readRequestBody = async (
    request: http.IncomingMessage
): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
};

test('Graph RAG adapter sends the native request and maps one aggregate item', async () => {
    let method = '';
    let path = '';
    let authorization = '';
    let requestBody: Record<string, unknown> | undefined;
    const { server, baseUrl } = await startServer(async (request, response) => {
        method = request.method ?? '';
        path = request.url ?? '';
        authorization = request.headers.authorization ?? '';
        requestBody = JSON.parse(await readRequestBody(request)) as Record<
            string,
            unknown
        >;
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response: 'The repository uses a bounded context loader.',
                sources: [
                    {
                        uri: 'urn:document:context-status',
                        title: 'Repository context status',
                    },
                    { uri: 'https://example.test/context.md', title: '' },
                ],
            })
        );
    });

    try {
        const bundle = await createAdapter(`${baseUrl}/`).getEvidenceBundle({
            queryIntent: 'How does context loading work?',
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
        });

        assert.equal(method, 'POST');
        assert.equal(path, '/api/v1/flow/default/service/graph-rag');
        assert.equal(authorization, 'Bearer secret-token-for-test');
        assert.deepEqual(requestBody, {
            query: 'How does context loading work?',
            collection: 'footnote-repository-context',
            'entity-limit': 12,
            'triple-limit': 8,
            'max-subgraph-size': 100,
            'max-path-length': 2,
            streaming: false,
        });
        assert.equal(bundle.items.length, 1);
        assert.equal(
            bundle.items[0]?.claimText,
            'The repository uses a bounded context loader.'
        );
        assert.equal(
            bundle.items[0]?.sourceRef,
            'trustgraph://graph-rag/collection/footnote-repository-context'
        );
        assert.deepEqual(bundle.items[0]?.provenancePathRef, [
            'urn:document:context-status',
            'title:Repository context status',
            'https://example.test/context.md',
        ]);
        assert.equal(bundle.items[0]?.confidenceScore, 0);
        assert.equal(bundle.scopeTuple.projectId, 'project-1');
        assert.equal(
            JSON.stringify(requestBody).includes('workspaceRef'),
            false
        );
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter rejects missing, empty, or malformed sources', async () => {
    const payloads: unknown[] = [
        { response: 'answer', sources: [] },
        { response: 'answer' },
        { response: 'answer', sources: [{ title: 'missing uri' }] },
        { response: 'answer', sources: [{ uri: 'urn:one' }, { uri: 2 }] },
    ];

    for (const payload of payloads) {
        const { server, baseUrl } = await startServer((_request, response) => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(payload));
        });
        try {
            await assert.rejects(
                createAdapter(baseUrl).getEvidenceBundle({
                    queryIntent: 'query',
                    scopeTuple: {
                        userId: 'user-1',
                        collectionId: 'collection-1',
                    },
                    budget: { timeoutMs: 100, maxCalls: 1 },
                }),
                /trustgraph_graph_rag_invalid/
            );
        } finally {
            await closeServer(server);
        }
    }
});

test('Graph RAG adapter rejects malformed JSON and non-success responses without leaking credentials', async () => {
    const malformed = await startServer((_request, response) => {
        response.statusCode = 200;
        response.end('{not-json');
    });
    try {
        await assert.rejects(
            createAdapter(malformed.baseUrl).getEvidenceBundle({
                queryIntent: 'query',
                scopeTuple: { userId: 'user-1', projectId: 'project-1' },
                budget: { timeoutMs: 100, maxCalls: 1 },
            }),
            (error: unknown) => {
                assert.equal(
                    String(error).includes('secret-token-for-test'),
                    false
                );
                return true;
            }
        );
    } finally {
        await closeServer(malformed.server);
    }

    const failed = await startServer((_request, response) => {
        response.statusCode = 503;
        response.end('upstream secret-token-for-test failure');
    });
    try {
        await assert.rejects(
            createAdapter(failed.baseUrl).getEvidenceBundle({
                queryIntent: 'query',
                scopeTuple: { userId: 'user-1', projectId: 'project-1' },
                budget: { timeoutMs: 100, maxCalls: 1 },
            }),
            (error: unknown) => {
                assert.equal(
                    String(error).includes('secret-token-for-test'),
                    false
                );
                assert.match(String(error), /http_status_503/);
                return true;
            }
        );
    } finally {
        await closeServer(failed.server);
    }
});

test('Graph RAG adapter enforces response/source bounds and honors cancellation', async () => {
    const oversized = await startServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response: 'x'.repeat(TEST_LIMITS.maxResponseChars + 1),
                sources: [{ uri: 'urn:source' }],
            })
        );
    });
    try {
        await assert.rejects(
            createAdapter(oversized.baseUrl).getEvidenceBundle({
                queryIntent: 'query',
                scopeTuple: { userId: 'user-1', projectId: 'project-1' },
                budget: { timeoutMs: 100, maxCalls: 1 },
            }),
            /trustgraph_graph_rag_response_too_large/
        );
    } finally {
        await closeServer(oversized.server);
    }

    const slow = await startServer((_request, response) => {
        setTimeout(
            () => response.end(JSON.stringify({ response: 'late' })),
            200
        );
    });
    try {
        const abortController = new AbortController();
        const request = createAdapter(slow.baseUrl).getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
            abortSignal: abortController.signal,
        });
        abortController.abort();
        await assert.rejects(request);
    } finally {
        await closeServer(slow.server);
    }
});

test('Graph RAG adapter rejects an oversized query before making a request', async () => {
    const adapter = createAdapter('http://127.0.0.1:1');
    await assert.rejects(
        adapter.getEvidenceBundle({
            queryIntent: 'x'.repeat(TEST_LIMITS.maxQueryChars + 1),
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
        }),
        /trustgraph_graph_rag_query_too_large/
    );
});
