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
import type { TrustGraphTargetConfig } from '../src/services/executionContractTrustGraph/trustGraphEvidenceTypes.js';

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

const createAdapter = (
    baseUrl: string,
    targets: TrustGraphTargetConfig[] = [
        {
            id: 'default-target',
            flow: 'default',
            collection: 'footnote-repository-context',
            description: 'Default test retrieval target.',
        },
    ],
    limits: TrustGraphGraphRagLimits = TEST_LIMITS
): HttpTrustGraphEvidenceAdapter =>
    new HttpTrustGraphEvidenceAdapter({
        baseUrl,
        targets,
        apiToken: 'secret-token-for-test',
        workspaceRef: 'default',
        limits,
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
            targetIds: ['default-target'],
        });

        assert.equal(method, 'POST');
        assert.equal(path, '/api/v1/flow/default/service/graph-rag');
        assert.equal(authorization, 'Bearer secret-token-for-test');
        assert.deepEqual(requestBody, {
            query: 'How does context loading work?',
            workspace: 'default',
            collection: 'footnote-repository-context',
            'entity-limit': 12,
            'triple-limit': 8,
            'max-subgraph-size': 100,
            'max-path-length': 2,
            'edge-score-limit': 30,
            'edge-limit': 25,
            'max-reranker-input': 350,
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
            'target:default-target',
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

test('Graph RAG adapter admits only explicitly selected target IDs', async () => {
    const requestedCollections: string[] = [];
    const { server, baseUrl } = await startServer(async (request, response) => {
        const body = JSON.parse(await readRequestBody(request)) as {
            collection?: unknown;
        };
        if (typeof body.collection === 'string') {
            requestedCollections.push(body.collection);
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
            JSON.stringify({
                response: 'selected target response',
                sources: [{ uri: 'https://example.test/source' }],
            })
        );
    });

    try {
        const adapter = createAdapter(
            baseUrl,
            [
                {
                    id: 'product-docs',
                    flow: 'product-flow',
                    collection: 'product-docs',
                    description: 'Current product documentation.',
                },
                {
                    id: 'meeting-archive',
                    flow: 'meeting-flow',
                    collection: 'meeting-archive',
                    description: 'Historical meeting notes.',
                },
                {
                    id: 'support-handbook',
                    flow: 'support-flow',
                    collection: 'support-handbook',
                    description: 'Support procedures and policies.',
                },
            ],
            { ...TEST_LIMITS, maxSources: 3 }
        );

        await adapter.getEvidenceBundle({
            queryIntent: 'Which product documents are relevant?',
            scopeTuple: { userId: 'user_1', collectionId: 'product-docs' },
            budget: { timeoutMs: 1_000, maxCalls: 1 },
            targetIds: ['product-docs', 'not-configured'],
        });

        assert.deepEqual(requestedCollections, ['product-docs']);
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter queries only configured targets and preserves target provenance', async () => {
    const requests: Array<{ path: string; collection: string }> = [];
    const { server, baseUrl } = await startServer(async (request, response) => {
        const body = JSON.parse(await readRequestBody(request)) as {
            collection?: string;
        };
        requests.push({
            path: request.url ?? '',
            collection: body.collection ?? '',
        });
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response: `evidence for ${body.collection}`,
                sources: [{ uri: `urn:source:${body.collection}` }],
            })
        );
    });

    try {
        const bundle = await createAdapter(baseUrl, [
            {
                id: 'history',
                flow: 'history-flow',
                collection: 'history-collection',
                description: 'Historical meeting notes.',
            },
            {
                id: 'operator',
                flow: 'operator-flow',
                collection: 'operator-collection',
                description: 'Operator documentation.',
            },
        ]).getEvidenceBundle({
            queryIntent: 'What changed?',
            scopeTuple: {
                userId: 'user-1',
                collectionId: 'history-collection',
            },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['history', 'operator'],
        });

        assert.deepEqual(
            requests.sort((left, right) =>
                left.collection.localeCompare(right.collection)
            ),
            [
                {
                    path: '/api/v1/flow/history-flow/service/graph-rag',
                    collection: 'history-collection',
                },
                {
                    path: '/api/v1/flow/operator-flow/service/graph-rag',
                    collection: 'operator-collection',
                },
            ]
        );
        assert.deepEqual(bundle.items.map((item) => item.targetId).sort(), [
            'history',
            'operator',
        ]);
        assert.ok(
            bundle.items.every((item) =>
                item.provenancePathRef.some((ref) => ref.startsWith('target:'))
            )
        );
        assert.ok(
            bundle.traceRefs.some((ref) => ref.includes('/target/history/'))
        );
        assert.equal(
            bundle.items.some((item) =>
                item.collectionScope.includes('unconfigured')
            ),
            false
        );
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter keeps usable evidence when one configured target fails', async () => {
    const { server, baseUrl } = await startServer(async (request, response) => {
        const body = JSON.parse(await readRequestBody(request)) as {
            collection?: string;
        };
        if (body.collection === 'broken-collection') {
            response.statusCode = 503;
            response.end('upstream failure');
            return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response: 'usable evidence',
                sources: [{ uri: 'urn:usable' }],
            })
        );
    });

    try {
        const adapter = new HttpTrustGraphEvidenceAdapter({
            baseUrl,
            targets: [
                {
                    id: 'broken',
                    flow: 'broken-flow',
                    collection: 'broken-collection',
                    description: 'Broken test target.',
                },
                {
                    id: 'working',
                    flow: 'working-flow',
                    collection: 'working-collection',
                    description: 'Working test target.',
                },
            ],
            apiToken: 'secret-token-for-test',
            limits: TEST_LIMITS,
        });

        const bundle = await adapter.getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: {
                userId: 'user-1',
                collectionId: 'working-collection',
            },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['broken', 'working'],
        });

        assert.equal(bundle.items.length, 1);
        assert.equal(bundle.items[0]?.targetId, 'working');
        assert.deepEqual(bundle.partialTargetFailureIds, ['broken']);
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter enforces a shared source budget across targets', async () => {
    const { server, baseUrl } = await startServer(
        async (_request, response) => {
            response.setHeader('content-type', 'application/json');
            response.end(
                JSON.stringify({
                    response: 'bounded evidence',
                    sources: [{ uri: 'urn:one' }, { uri: 'urn:two' }],
                })
            );
        }
    );

    try {
        const bundle = await createAdapter(baseUrl, [
            {
                id: 'one',
                flow: 'flow-one',
                collection: 'collection-one',
                description: 'First test target.',
            },
            {
                id: 'two',
                flow: 'flow-two',
                collection: 'collection-two',
                description: 'Second test target.',
            },
        ]).getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: { userId: 'user-1', collectionId: 'collection-one' },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['one', 'two'],
        });

        const sourceRefs = bundle.items.flatMap((item) =>
            item.provenancePathRef.filter((ref) => ref.startsWith('urn:'))
        );
        assert.equal(sourceRefs.length, TEST_LIMITS.maxSources);
        assert.ok(
            bundle.items.some((item) =>
                item.retrievalReason.endsWith('_sources_truncated')
            )
        );
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter rejects a target set that cannot fit the source budget', () => {
    assert.throws(
        () =>
            new HttpTrustGraphEvidenceAdapter({
                baseUrl: 'http://trustgraph.test',
                targets: [
                    {
                        id: 'one',
                        flow: 'flow-one',
                        collection: 'one',
                        description: 'First test target.',
                    },
                    {
                        id: 'two',
                        flow: 'flow-two',
                        collection: 'two',
                        description: 'Second test target.',
                    },
                ],
                apiToken: 'secret-token-for-test',
                limits: { ...TEST_LIMITS, maxSources: 1 },
            }),
        /trustgraph_graph_rag_max_sources_below_target_count/
    );
});

test('Graph RAG adapter rejects missing, empty, or malformed sources', async () => {
    const payloads: unknown[] = [
        { response: 'answer', sources: [] },
        { response: 'answer' },
        { response: 'answer\u0000bad', sources: [{ uri: 'urn:one' }] },
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
                    targetIds: ['default-target'],
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
                targetIds: ['default-target'],
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
                targetIds: ['default-target'],
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

test('Graph RAG adapter preserves normal whitespace in generated responses', async () => {
    const { server, baseUrl } = await startServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response: 'First line\nSecond line\twith detail.',
                sources: [{ uri: 'urn:multiline' }],
            })
        );
    });

    try {
        const bundle = await createAdapter(baseUrl).getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['default-target'],
        });

        assert.equal(
            bundle.items[0]?.claimText,
            'First line\nSecond line\twith detail.'
        );
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter keeps bounded evidence when sources exceed the limit', async () => {
    const { server, baseUrl } = await startServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response:
                    'Evidence with more source references than the local bound.',
                sources: Array.from(
                    { length: TEST_LIMITS.maxSources + 2 },
                    (_value, index) => ({ uri: `urn:source:${index}` })
                ),
            })
        );
    });

    try {
        const adapter = new HttpTrustGraphEvidenceAdapter({
            baseUrl,
            targets: [
                {
                    id: 'bounded',
                    flow: 'bounded-flow',
                    collection: 'bounded-collection',
                    description: 'Bounded test target.',
                },
            ],
            apiToken: 'secret-token-for-test',
            limits: TEST_LIMITS,
        });

        const bundle = await adapter.getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['bounded'],
        });

        const item = bundle.items[0];
        assert.ok(item);
        assert.equal(
            item.provenancePathRef.filter((ref) => ref.startsWith('urn:'))
                .length,
            TEST_LIMITS.maxSources
        );
        assert.equal(
            item.retrievalReason,
            'trustgraph_graph_rag_source_backed_sources_truncated'
        );
    } finally {
        await closeServer(server);
    }
});

test('Graph RAG adapter enforces transport bounds and honors cancellation', async () => {
    const declaredOversized = await startServer((_request, response) => {
        response.setHeader('content-length', '1048577');
        response.end('declared oversized');
    });
    try {
        await assert.rejects(
            createAdapter(declaredOversized.baseUrl).getEvidenceBundle({
                queryIntent: 'query',
                scopeTuple: { userId: 'user-1', projectId: 'project-1' },
                budget: { timeoutMs: 100, maxCalls: 1 },
                targetIds: ['default-target'],
            }),
            /trustgraph_graph_rag_response_body_too_large/
        );
    } finally {
        await closeServer(declaredOversized.server);
    }

    const streamedOversized = await startServer((_request, response) => {
        response.write('x'.repeat(600_000));
        response.end('x'.repeat(600_000));
    });
    try {
        await assert.rejects(
            createAdapter(streamedOversized.baseUrl).getEvidenceBundle({
                queryIntent: 'query',
                scopeTuple: { userId: 'user-1', projectId: 'project-1' },
                budget: { timeoutMs: 100, maxCalls: 1 },
                targetIds: ['default-target'],
            }),
            /trustgraph_graph_rag_response_body_too_large/
        );
    } finally {
        await closeServer(streamedOversized.server);
    }

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
        const adapter = new HttpTrustGraphEvidenceAdapter({
            baseUrl: oversized.baseUrl,
            targets: [
                {
                    id: 'oversized',
                    flow: 'oversized-flow',
                    collection: 'oversized-collection',
                    description: 'Oversized response test target.',
                },
            ],
            apiToken: 'secret-token-for-test',
            workspaceRef: 'default',
            limits: TEST_LIMITS,
        });
        const bundle = await adapter.getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['oversized'],
        });
        const item = bundle.items[0];
        assert.ok(item);
        assert.equal(
            item.claimText.length <= TEST_LIMITS.maxResponseChars,
            true
        );
        assert.match(
            item.claimText,
            /\[TrustGraph response truncated by Footnote bounds\.\]$/u
        );
        assert.equal(
            item.retrievalReason,
            'trustgraph_graph_rag_source_backed_response_truncated'
        );
    } finally {
        await closeServer(oversized.server);
    }

    const aggregate = await startServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify({
                response: 'y'.repeat(TEST_LIMITS.maxResponseChars),
                sources: [{ uri: 'urn:aggregate' }],
            })
        );
    });
    try {
        const aggregateLimits: TrustGraphGraphRagLimits = {
            ...TEST_LIMITS,
            maxSources: 3,
        };
        const adapter = new HttpTrustGraphEvidenceAdapter({
            baseUrl: aggregate.baseUrl,
            targets: [
                {
                    id: 'one',
                    flow: 'one-flow',
                    collection: 'one',
                    description: 'First test target.',
                },
                {
                    id: 'two',
                    flow: 'two-flow',
                    collection: 'two',
                    description: 'Second test target.',
                },
                {
                    id: 'three',
                    flow: 'three-flow',
                    collection: 'three',
                    description: 'Third test target.',
                },
            ],
            apiToken: 'secret-token-for-test',
            limits: aggregateLimits,
        });
        const bundle = await adapter.getEvidenceBundle({
            queryIntent: 'query',
            scopeTuple: { userId: 'user-1', projectId: 'project-1' },
            budget: { timeoutMs: 100, maxCalls: 1 },
            targetIds: ['one', 'two', 'three'],
        });
        assert.equal(bundle.items.length, 3);
        assert.equal(
            bundle.items.reduce(
                (total, item) => total + item.claimText.length,
                0
            ) <=
                TEST_LIMITS.maxResponseChars * 2,
            true
        );
        assert.ok(
            bundle.items.some((item) =>
                item.retrievalReason.endsWith('_truncated')
            )
        );
    } finally {
        await closeServer(aggregate.server);
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
            targetIds: ['default-target'],
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
            targetIds: ['default-target'],
        }),
        /trustgraph_graph_rag_query_too_large/
    );
});
