/**
 * @description: Verifies setup-session authorization and safe one-time repository-context API behavior.
 * Tests server-approved destinations and the fixed prepared bundle without exposing credentials or checkout access.
 * @footnote-scope: test
 * @footnote-module: SetupRepositoryContextHandlerTests
 * @footnote-risk: high - Missing coverage could expose setup credentials or load unapproved repository files.
 * @footnote-ethics: high - Setup tests protect operator control over external context and secret handling.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerSetupRoutes } from '../src/http/setupRoutes.js';
import { normalizePathname } from '../src/http/routeDispatch.js';
import { createSetupRepositoryContextHandlers } from '../src/handlers/setupRepositoryContext.js';
import { createSetupSessionHandlers } from '../src/handlers/setupSession.js';
import { createSetupBootstrapService } from '../src/services/setupBootstrap.js';

type TestServer = {
    url: string;
    setupCode: () => Promise<string>;
    cleanup: () => Promise<void>;
};

const createTestServer = async (options: {
    configured?: boolean;
}): Promise<TestServer> => {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'footnote-setup-context-')
    );
    const settingsPath = path.join(root, 'footnote.yaml');
    const bundleRoot = path.join(root, '.footnote', 'context-bundle');
    await fs.mkdir(path.join(bundleRoot, 'docs'), { recursive: true });
    await fs.writeFile(
        path.join(bundleRoot, 'revision.txt'),
        `${'a'.repeat(40)}\n`
    );
    await fs.writeFile(
        path.join(bundleRoot, 'context-manifest.json'),
        JSON.stringify([
            { path: 'README.md', category: 'documented_behavior', priority: 1 },
            {
                path: 'docs/guide.md',
                category: 'documented_intent',
                priority: 2,
            },
        ])
    );
    await fs.writeFile(path.join(bundleRoot, 'README.md'), 'approved readme');
    await fs.writeFile(
        path.join(bundleRoot, 'docs', 'guide.md'),
        'approved guide'
    );
    await fs.writeFile(path.join(bundleRoot, 'unlisted.txt'), 'not approved');

    const setupBootstrapService = createSetupBootstrapService({ settingsPath });
    const trustGraphConfig = options.configured
        ? {
              enabled: true,
              killSwitchExternalRetrieval: false,
              adapter: {
                  mode: 'http' as const,
                  baseUrl: 'https://trustgraph.example',
                  apiToken: 'backend-only-secret',
                  workspaceRef: 'server-workspace',
                  targets: [
                      {
                          id: 'approved-target',
                          flow: 'context-flow',
                          collection: 'repository-context',
                          description: 'Approved setup target',
                      },
                  ],
              },
          }
        : {
              enabled: false,
              killSwitchExternalRetrieval: false,
              adapter: {
                  mode: 'none' as const,
                  baseUrl: null,
                  apiToken: null,
                  workspaceRef: null,
                  targets: [],
              },
          };
    const setupRepositoryContextHandlers = createSetupRepositoryContextHandlers(
        {
            setupBootstrapService,
            trustGraphConfig,
            bundleRoot,
            logger: {
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            },
            logRequest: () => undefined,
        }
    );
    const setupSessionHandlers = createSetupSessionHandlers({
        setupBootstrapService,
        settingsPath,
        setupBaseUrl: 'http://127.0.0.1',
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        },
        logRequest: () => undefined,
        clearSetupSessionState:
            setupRepositoryContextHandlers.clearSetupSession,
    });

    const app = express();
    registerSetupRoutes({
        app,
        normalizePathname,
        handleSetupSessionPostRequest:
            setupSessionHandlers.handleSetupSessionPostRequest,
        handleSetupSessionDeleteRequest:
            setupSessionHandlers.handleSetupSessionDeleteRequest,
        handleSetupOperatorLinkPostRequest:
            setupSessionHandlers.handleSetupOperatorLinkPostRequest,
        handleSetupRepositoryContextConnectionStateRequest:
            setupRepositoryContextHandlers.handleSetupRepositoryContextConnectionStateRequest,
        handleSetupRepositoryContextConnectionTestRequest:
            setupRepositoryContextHandlers.handleSetupRepositoryContextConnectionTestRequest,
        handleSetupRepositoryContextPreviewRequest:
            setupRepositoryContextHandlers.handleSetupRepositoryContextPreviewRequest,
        handleSetupRepositoryContextLoadRequest:
            setupRepositoryContextHandlers.handleSetupRepositoryContextLoadRequest,
        logRequest: () => undefined,
    });
    const server = await new Promise<import('node:http').Server>((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        url: `http://127.0.0.1:${address.port}`,
        setupCode: async () => {
            const issued = await setupBootstrapService.issueOrGetActiveCode();
            assert.ok(issued);
            return issued.code;
        },
        cleanup: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
            await fs.rm(root, { recursive: true, force: true });
        },
    };
};

const establishSetupSession = async (
    server: TestServer
): Promise<{ cookie: string; csrfToken: string }> => {
    const response = await fetch(`${server.url}/api/setup/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: await server.setupCode() }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { csrfToken: string };
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return { cookie, csrfToken: payload.csrfToken };
};

test('setup API tests a server-approved target and loads only the prepared bundle', async () => {
    const server = await createTestServer({ configured: true });
    const originalFetch = globalThis.fetch;
    const requests: Array<{
        payload: Record<string, unknown>;
        authorization: string | undefined;
    }> = [];
    globalThis.fetch = async (input, init) => {
        if (new URL(String(input)).hostname !== 'trustgraph.example') {
            return originalFetch(input, init);
        }
        assert.equal(
            String(input),
            'https://trustgraph.example/api/v1/librarian'
        );
        const payload = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
        >;
        requests.push({
            payload,
            authorization:
                new Headers(init?.headers).get('authorization') ?? undefined,
        });
        const responseBody =
            payload.operation === 'list-documents'
                ? { 'document-metadatas': [] }
                : payload.operation === 'list-processing'
                  ? { 'processing-metadatas': [] }
                  : {};
        return new Response(JSON.stringify(responseBody), { status: 200 });
    };

    try {
        const stateWithoutSession = await fetch(
            `${server.url}/api/setup/repository-context/connection`
        );
        assert.equal(stateWithoutSession.status, 401);

        const session = await establishSetupSession(server);
        const headers = {
            cookie: session.cookie,
            'content-type': 'application/json',
            'x-setup-csrf': session.csrfToken,
        };
        const stateResponse = await fetch(
            `${server.url}/api/setup/repository-context/connection`,
            { headers: { cookie: session.cookie } }
        );
        const stateText = await stateResponse.text();
        assert.doesNotMatch(stateText, /backend-only-secret/u);
        assert.deepEqual(JSON.parse(stateText) as unknown, {
            configured: true,
            targets: [
                {
                    id: 'approved-target',
                    flow: 'context-flow',
                    collection: 'repository-context',
                    workspace: 'server-workspace',
                },
            ],
        });

        const missingCsrf = await fetch(
            `${server.url}/api/setup/repository-context/connection/test`,
            {
                method: 'POST',
                headers: {
                    cookie: session.cookie,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ targetId: 'approved-target' }),
            }
        );
        assert.equal(missingCsrf.status, 403);
        assert.equal(requests.length, 0);

        const testResponse = await fetch(
            `${server.url}/api/setup/repository-context/connection/test`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ targetId: 'approved-target' }),
            }
        );
        assert.equal(testResponse.status, 200);
        const testedText = await testResponse.text();
        assert.doesNotMatch(testedText, /backend-only-secret/u);
        const testedState = JSON.parse(testedText) as {
            connected: boolean;
            targetId: string;
            testedAt: string;
        };
        assert.equal(testedState.connected, true);
        assert.equal(testedState.targetId, 'approved-target');
        assert.match(testedState.testedAt, /^\d{4}-\d\d-\d\dT/u);
        assert.equal(requests[0]?.authorization, 'Bearer backend-only-secret');

        const previewResponse = await fetch(
            `${server.url}/api/setup/repository-context/preview`,
            { headers: { cookie: session.cookie } }
        );
        assert.equal(previewResponse.status, 200);
        const preview = (await previewResponse.json()) as {
            fileCount: number;
            totalBytes: number;
            files: { path: string }[];
        };
        assert.equal(preview.fileCount, 2);
        assert.equal(
            preview.totalBytes,
            Buffer.byteLength('approved readme') +
                Buffer.byteLength('approved guide')
        );
        assert.deepEqual(
            preview.files.map((file) => file.path),
            ['README.md', 'docs/guide.md']
        );

        const loadResponse = await fetch(
            `${server.url}/api/setup/repository-context/load`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ targetId: 'approved-target' }),
            }
        );
        assert.equal(loadResponse.status, 200);
        const loadedText = await loadResponse.text();
        assert.doesNotMatch(
            loadedText,
            /backend-only-secret|approved readme|approved guide/u
        );
        const loaded = JSON.parse(loadedText) as {
            counts: { added: number; failed: number };
            items: { path: string; status: string }[];
        };
        assert.deepEqual(loaded.counts, {
            added: 2,
            changed: 0,
            unchanged: 0,
            skipped: 0,
            failed: 0,
        });
        assert.deepEqual(
            loaded.items.map((item) => [item.path, item.status]),
            [
                ['docs/guide.md', 'added'],
                ['README.md', 'added'],
            ]
        );
        assert.ok(
            requests
                .filter(({ payload }) => payload.operation === 'add-document')
                .every(({ payload }) =>
                    ['README.md', 'docs/guide.md'].includes(
                        String(
                            (payload['document-metadata'] as { title: string })
                                .title
                        )
                    )
                )
        );
        assert.ok(
            requests.every(
                ({ payload }) => payload.workspace === 'server-workspace'
            )
        );
        assert.ok(
            requests.every(
                ({ authorization }) =>
                    authorization === 'Bearer backend-only-secret'
            )
        );

        const unknownTarget = await fetch(
            `${server.url}/api/setup/repository-context/connection/test`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ targetId: 'arbitrary-url' }),
            }
        );
        assert.equal(unknownTarget.status, 409);
        assert.equal(requests.length, 7);
    } finally {
        globalThis.fetch = originalFetch;
        await server.cleanup();
    }
});

test('setup preview remains available when TrustGraph is not configured', async () => {
    const server = await createTestServer({ configured: false });
    try {
        const session = await establishSetupSession(server);
        const state = await fetch(
            `${server.url}/api/setup/repository-context/connection`,
            { headers: { cookie: session.cookie } }
        );
        assert.deepEqual(await state.json(), {
            configured: false,
            targets: [],
        });

        const preview = await fetch(
            `${server.url}/api/setup/repository-context/preview`,
            { headers: { cookie: session.cookie } }
        );
        assert.equal(preview.status, 200);
        assert.equal(
            ((await preview.json()) as { fileCount: number }).fileCount,
            2
        );
    } finally {
        await server.cleanup();
    }
});
