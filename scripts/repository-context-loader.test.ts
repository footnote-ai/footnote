/**
 * @description: Verifies TrustGraph 2.7 Librarian requests and repeatable repository-context loading.
 * It covers exact wire operations, stable reconciliation, safe text handling, and fail-open batches.
 * @footnote-scope: test
 * @footnote-module: RepositoryContextLoaderTest
 * @footnote-risk: low - Test-only HTTP fixtures cannot affect runtime behavior.
 * @footnote-ethics: medium - Tests protect the context provenance and failure reporting reviewers rely on.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http, {
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
    DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID,
    REPOSITORY_CONTEXT_PATH_PREDICATE,
    REPOSITORY_CONTEXT_REPOSITORY_PREDICATE,
    REPOSITORY_CONTEXT_SHA256_PREDICATE,
    loadRepositoryContext,
} from './lib/repository-context-loader.js';
import {
    TrustGraphLibrarianClient,
    type TrustGraphDocumentMetadata,
    type TrustGraphProcessingMetadata,
} from './lib/trustgraph-librarian-client.js';

type JsonRecord = Record<string, unknown>;

type TestLibrarian = {
    baseUrl: string;
    requests: JsonRecord[];
    documents: JsonRecord[];
    processings: JsonRecord[];
    close: () => Promise<void>;
};

const execFileAsync = promisify(execFile);

const isRecord = (value: unknown): value is JsonRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const readRequestBody = async (
    request: IncomingMessage
): Promise<JsonRecord> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const parsed = JSON.parse(
        Buffer.concat(chunks).toString('utf8')
    ) as unknown;
    assert.ok(isRecord(parsed));
    return parsed;
};

const sendJson = (
    response: ServerResponse,
    status: number,
    body: JsonRecord
): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
};

const listen = async (server: Server): Promise<number> =>
    new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            const address = server.address();
            assert.ok(address !== null && typeof address === 'object');
            resolve(address.port);
        });
    });

const closeServer = async (server: Server): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve();
        });
    });

const createTestLibrarian = async (options?: {
    failAddTitle?: string;
}): Promise<TestLibrarian> => {
    const requests: JsonRecord[] = [];
    const documents: JsonRecord[] = [];
    const processings: JsonRecord[] = [];
    const server = http.createServer(async (request, response) => {
        try {
            assert.equal(request.method, 'POST');
            assert.equal(request.url, '/api/v1/librarian');
            const body = await readRequestBody(request);
            requests.push(body);

            switch (body.operation) {
                case 'list-documents':
                    sendJson(response, 200, {
                        'document-metadatas': documents,
                    });
                    return;
                case 'list-processing':
                    sendJson(response, 200, {
                        'processing-metadatas': processings,
                    });
                    return;
                case 'add-document': {
                    const metadata = body['document-metadata'];
                    assert.ok(isRecord(metadata));
                    if (metadata.title === options?.failAddTitle) {
                        sendJson(response, 200, {
                            error: {
                                type: 'fixture_add_failure',
                                message: 'fixture rejected document',
                            },
                        });
                        return;
                    }
                    documents.push(structuredClone(metadata));
                    sendJson(response, 200, {});
                    return;
                }
                case 'remove-document': {
                    const index = documents.findIndex(
                        (document) => document.id === body['document-id']
                    );
                    if (index >= 0) {
                        documents.splice(index, 1);
                    }
                    sendJson(response, 200, {});
                    return;
                }
                case 'add-processing': {
                    const metadata = body['processing-metadata'];
                    assert.ok(isRecord(metadata));
                    processings.push(structuredClone(metadata));
                    sendJson(response, 200, {});
                    return;
                }
                case 'remove-processing': {
                    const index = processings.findIndex(
                        (processing) => processing.id === body['processing-id']
                    );
                    if (index >= 0) {
                        processings.splice(index, 1);
                    }
                    sendJson(response, 200, {});
                    return;
                }
                default:
                    sendJson(response, 400, {
                        error: `unexpected operation ${String(body.operation)}`,
                    });
            }
        } catch (error) {
            sendJson(response, 500, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
    const port = await listen(server);

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        documents,
        processings,
        close: () => closeServer(server),
    };
};

const createTrackedRepository = async (
    files: Record<string, string | Buffer>,
    allowlist: string
): Promise<string> => {
    const repositoryRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'footnote-context-loader-')
    );
    await fs.mkdir(path.join(repositoryRoot, '.footnote'), {
        recursive: true,
    });
    await fs.writeFile(
        path.join(repositoryRoot, '.footnote', 'context-files'),
        allowlist,
        'utf8'
    );
    for (const [filePath, content] of Object.entries(files)) {
        const absolutePath = path.join(repositoryRoot, filePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content);
    }
    await execFileAsync('git', ['init'], { cwd: repositoryRoot });
    await execFileAsync('git', ['add', '.'], { cwd: repositoryRoot });
    return repositoryRoot;
};

const makeLoadInput = (repositoryRoot: string, trustGraphBaseUrl: string) => ({
    repositoryRoot,
    trustGraphBaseUrl,
    workspace: 'workspace-a',
    flowId: 'flow-a',
    collection: 'collection-a',
    repositoryId: DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID,
    requestTimeoutMs: 2_000,
});

const getMetadataValue = (
    document: JsonRecord,
    predicate: string
): string | undefined => {
    const triples = document.metadata;
    if (!Array.isArray(triples)) {
        return undefined;
    }
    for (const triple of triples) {
        if (!isRecord(triple) || !isRecord(triple.p) || !isRecord(triple.o)) {
            continue;
        }
        if (
            triple.p.t === 'i' &&
            triple.p.i === predicate &&
            triple.o.t === 'l' &&
            typeof triple.o.v === 'string'
        ) {
            return triple.o.v;
        }
    }
    return undefined;
};

test('TrustGraph client sends explicit 2.7 workspace and processing operations', async () => {
    const librarian = await createTestLibrarian();
    try {
        const client = new TrustGraphLibrarianClient({
            baseUrl: librarian.baseUrl,
            workspace: 'workspace-wire-test',
            apiToken: 'test-token',
            requestTimeoutMs: 2_000,
        });
        const document: TrustGraphDocumentMetadata = {
            id: 'urn:test:document',
            time: 1,
            kind: 'text/plain',
            title: 'README.md',
            comments: '',
            metadata: [],
            tags: ['test'],
        };
        const processing: TrustGraphProcessingMetadata = {
            id: 'urn:test:processing',
            documentId: document.id,
            time: 1,
            flow: 'flow',
            collection: 'collection',
            tags: ['test'],
        };

        await client.listDocuments();
        await client.listProcessing();
        await client.addDocument({
            documentMetadata: document,
            contentBase64: Buffer.from('hello', 'utf8').toString('base64'),
        });
        await client.removeDocument(document.id);
        await client.startProcessing(processing);
        await client.stopProcessing(processing.id);

        assert.deepEqual(
            librarian.requests.map((request) => request.operation),
            [
                'list-documents',
                'list-processing',
                'add-document',
                'remove-document',
                'add-processing',
                'remove-processing',
            ]
        );
        assert.ok(
            librarian.requests.every(
                (request) => request.workspace === 'workspace-wire-test'
            )
        );
        const addDocument = librarian.requests[2];
        assert.equal(addDocument.content, 'aGVsbG8=');
        const startProcessing = librarian.requests[4]['processing-metadata'];
        assert.ok(isRecord(startProcessing));
        assert.equal(startProcessing['document-id'], document.id);
    } finally {
        await librarian.close();
    }
});

test('TrustGraph client timeout covers response body reads', async (context) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"document-metadatas":');
    });
    const port = await listen(server);
    context.after(() => closeServer(server));
    const client = new TrustGraphLibrarianClient({
        baseUrl: `http://127.0.0.1:${port}`,
        workspace: 'timeout-test',
        requestTimeoutMs: 25,
    });

    await assert.rejects(
        client.listDocuments(),
        /TrustGraph Librarian request timed out after 25ms/u
    );
});

test('loader adds, leaves alone, repairs, then replaces a changed document', async (context) => {
    const repositoryRoot = await createTrackedRepository(
        { 'README.md': 'first version\n' },
        'README.md\n'
    );
    const librarian = await createTestLibrarian();
    context.after(async () => {
        await librarian.close();
        await fs.rm(repositoryRoot, { recursive: true, force: true });
    });
    const input = makeLoadInput(repositoryRoot, librarian.baseUrl);

    const first = await loadRepositoryContext(input);
    assert.deepEqual(first.counts, {
        added: 1,
        changed: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
    });
    assert.equal(librarian.documents.length, 1);
    assert.equal(librarian.processings.length, 1);
    const remoteDocument = librarian.documents[0];
    assert.equal(remoteDocument.kind, 'text/plain');
    assert.deepEqual(remoteDocument.tags, ['footnote', 'repository-context']);
    assert.equal(
        getMetadataValue(
            remoteDocument,
            REPOSITORY_CONTEXT_REPOSITORY_PREDICATE
        ),
        DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID
    );
    assert.equal(
        getMetadataValue(remoteDocument, REPOSITORY_CONTEXT_PATH_PREDICATE),
        'README.md'
    );
    assert.equal(
        getMetadataValue(remoteDocument, REPOSITORY_CONTEXT_SHA256_PREDICATE),
        createHash('sha256').update('first version\n').digest('hex')
    );
    const firstAddRequest = librarian.requests.find(
        (request) => request.operation === 'add-document'
    );
    assert.ok(firstAddRequest !== undefined);
    assert.equal(
        Buffer.from(String(firstAddRequest.content), 'base64').toString('utf8'),
        'first version\n'
    );

    const requestCountBeforeRepeat = librarian.requests.length;
    const second = await loadRepositoryContext(input);
    assert.deepEqual(second.counts, {
        added: 0,
        changed: 0,
        unchanged: 1,
        skipped: 0,
        failed: 0,
    });
    assert.deepEqual(
        librarian.requests
            .slice(requestCountBeforeRepeat)
            .map((request) => request.operation)
            .sort(),
        ['list-documents', 'list-processing']
    );

    librarian.processings.splice(0);
    const requestCountBeforeRepair = librarian.requests.length;
    const repaired = await loadRepositoryContext(input);
    assert.deepEqual(repaired.counts, {
        added: 0,
        changed: 1,
        unchanged: 0,
        skipped: 0,
        failed: 0,
    });
    assert.equal(
        repaired.items[0]?.reason,
        'repaired missing processing submission'
    );
    assert.deepEqual(
        librarian.requests
            .slice(requestCountBeforeRepair)
            .map((request) => request.operation)
            .filter(
                (operation) =>
                    operation !== 'list-documents' &&
                    operation !== 'list-processing'
            ),
        ['add-processing']
    );

    await fs.writeFile(
        path.join(repositoryRoot, 'README.md'),
        'second version\n',
        'utf8'
    );
    const requestCountBeforeChange = librarian.requests.length;
    const third = await loadRepositoryContext(input);
    assert.deepEqual(third.counts, {
        added: 0,
        changed: 1,
        unchanged: 0,
        skipped: 0,
        failed: 0,
    });
    assert.deepEqual(
        librarian.requests
            .slice(requestCountBeforeChange)
            .map((request) => request.operation)
            .filter(
                (operation) =>
                    operation !== 'list-documents' &&
                    operation !== 'list-processing'
            ),
        [
            'remove-processing',
            'remove-document',
            'add-document',
            'add-processing',
        ]
    );
});

test('loader does not replace malformed managed metadata', async (context) => {
    const repositoryRoot = await createTrackedRepository(
        { 'README.md': 'stable content\n' },
        'README.md\n'
    );
    const librarian = await createTestLibrarian();
    context.after(async () => {
        await librarian.close();
        await fs.rm(repositoryRoot, { recursive: true, force: true });
    });
    const input = makeLoadInput(repositoryRoot, librarian.baseUrl);
    await loadRepositoryContext(input);

    const triples = librarian.documents[0]?.metadata;
    assert.ok(Array.isArray(triples));
    const hashTriple = triples.find(
        (triple) =>
            isRecord(triple) &&
            isRecord(triple.p) &&
            triple.p.i === REPOSITORY_CONTEXT_SHA256_PREDICATE
    );
    assert.ok(isRecord(hashTriple) && isRecord(hashTriple.o));
    hashTriple.o.v = 'not-a-sha256';
    const requestCountBeforeMalformedLoad = librarian.requests.length;

    const result = await loadRepositoryContext(input);

    assert.deepEqual(result.counts, {
        added: 0,
        changed: 0,
        unchanged: 0,
        skipped: 0,
        failed: 1,
    });
    assert.equal(
        result.items[0]?.reason,
        'managed remote document has malformed identity metadata'
    );
    assert.deepEqual(
        librarian.requests
            .slice(requestCountBeforeMalformedLoad)
            .map((request) => request.operation)
            .sort(),
        ['list-documents', 'list-processing']
    );
});

test('loader skips unsafe text and continues after one document fails', async (context) => {
    const repositoryRoot = await createTrackedRepository(
        {
            'bad.md': 'remote rejection\n',
            'good.md': 'usable context\n',
            'invalid.md': Buffer.from([0xc3, 0x28]),
        },
        '*.md\n'
    );
    const librarian = await createTestLibrarian({
        failAddTitle: 'bad.md',
    });
    context.after(async () => {
        await librarian.close();
        await fs.rm(repositoryRoot, { recursive: true, force: true });
    });

    const result = await loadRepositoryContext(
        makeLoadInput(repositoryRoot, librarian.baseUrl)
    );

    assert.deepEqual(result.counts, {
        added: 1,
        changed: 0,
        unchanged: 0,
        skipped: 1,
        failed: 1,
    });
    assert.equal(
        result.items.find((item) => item.path === 'invalid.md')?.reason,
        'not valid UTF-8 text'
    );
    assert.match(
        result.items.find((item) => item.path === 'bad.md')?.reason ?? '',
        /fixture rejected document/u
    );
    assert.equal(
        result.items.find((item) => item.path === 'good.md')?.status,
        'added'
    );
    assert.equal(librarian.documents[0]?.title, 'good.md');
    assert.equal(librarian.processings.length, 1);
});
