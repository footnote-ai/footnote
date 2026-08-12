/**
 * @description: Verifies trusted recoverable-task HTTP lifecycle behavior.
 * @footnote-scope: test
 * @footnote-module: RecoverableTaskHandlerTests
 * @footnote-risk: medium - Missing coverage could expose trusted mutations or leave recovery tasks inconsistent.
 * @footnote-ethics: high - Confirms the boundary accepts only minimal delivery recovery metadata.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRecoverableTaskHandler } from '../src/handlers/recoverableTasks.js';
import { SimpleRateLimiter } from '../src/services/rateLimiter.js';
import { SqliteRecoverableTaskStore } from '../src/storage/recoverableTaskStore.js';

type TestServer = {
    url: string;
    close: () => Promise<void>;
};

const createServer = async (
    store: SqliteRecoverableTaskStore | null
): Promise<TestServer> => {
    const handlers = createRecoverableTaskHandler({
        recoverableTaskStore: store,
        logRequest: () => undefined,
        maxBodyBytes: 10_000,
        traceApiToken: 'trace-secret',
        serviceToken: null,
        serviceRateLimiter: new SimpleRateLimiter({
            limit: 50,
            window: 60_000,
        }),
    });
    const server = http.createServer((req, res) => {
        const url = req.url ?? '';
        if (url === '/api/internal/recoverable-tasks') {
            void handlers.handleCreateRecoverableTaskRequest(req, res);
            return;
        }
        if (url === '/api/internal/recoverable-tasks/claim') {
            void handlers.handleClaimRecoverableTasksRequest(req, res);
            return;
        }
        const finishMatch = url.match(
            /^\/api\/internal\/recoverable-tasks\/([^/]+)\/finish$/
        );
        if (finishMatch) {
            void handlers.handleFinishRecoverableTaskRequest(
                req,
                res,
                decodeURIComponent(finishMatch[1])
            );
            return;
        }
        res.statusCode = 404;
        res.end('Not Found');
    });
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
};

const trustedPost = (
    server: TestServer,
    route: string,
    body: unknown
): Promise<Response> =>
    fetch(`${server.url}${route}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Trace-Token': 'trace-secret',
        },
        body: JSON.stringify(body),
    });

test('trusted lifecycle creates, finishes, and claims profile-scoped tasks', async () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-recoverable-handler-')
    );
    const store = new SqliteRecoverableTaskStore({
        dbPath: path.join(directory, 'recoverable.db'),
    });
    const server = await createServer(store);

    try {
        const createResponse = await trustedPost(
            server,
            '/api/internal/recoverable-tasks',
            {
                kind: 'image_generation',
                botProfileId: 'bot-a',
                discordChannelId: 'channel-1',
                discordMessageId: 'message-1',
            }
        );
        assert.equal(createResponse.status, 201);
        const created = (await createResponse.json()) as {
            task: { id: string; state: string };
        };
        assert.equal(created.task.state, 'started');

        const finishResponse = await trustedPost(
            server,
            `/api/internal/recoverable-tasks/${created.task.id}/finish`,
            { state: 'complete' }
        );
        assert.equal(finishResponse.status, 200);
        const finished = (await finishResponse.json()) as {
            task: { state: string };
            changed: boolean;
        };
        assert.equal(finished.task.state, 'complete');
        assert.equal(finished.changed, true);

        const repeatResponse = await trustedPost(
            server,
            `/api/internal/recoverable-tasks/${created.task.id}/finish`,
            { state: 'failed' }
        );
        const repeated = (await repeatResponse.json()) as {
            task: { state: string };
            changed: boolean;
        };
        assert.equal(repeated.task.state, 'complete');
        assert.equal(repeated.changed, false);

        const missingResponse = await trustedPost(
            server,
            '/api/internal/recoverable-tasks/missing-task/finish',
            { state: 'complete' }
        );
        assert.equal(missingResponse.status, 404);

        store.create({
            kind: 'image_generation',
            botProfileId: 'bot-a',
            discordChannelId: 'channel-2',
            discordMessageId: 'message-2',
        });
        store.create({
            kind: 'image_generation',
            botProfileId: 'bot-b',
            discordChannelId: 'channel-3',
            discordMessageId: 'message-3',
        });
        const claimResponse = await trustedPost(
            server,
            '/api/internal/recoverable-tasks/claim',
            { botProfileId: 'bot-a' }
        );
        const claimed = (await claimResponse.json()) as {
            tasks: Array<{ botProfileId: string; state: string }>;
        };
        assert.deepEqual(
            claimed.tasks.map((task) => [task.botProfileId, task.state]),
            [['bot-a', 'recovering']]
        );
    } finally {
        await server.close();
        store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('recoverable-task endpoints reject missing auth, invalid bodies, and unavailable storage', async () => {
    const server = await createServer(null);
    try {
        const unauthenticated = await fetch(
            `${server.url}/api/internal/recoverable-tasks`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            }
        );
        assert.equal(unauthenticated.status, 401);

        const unavailable = await trustedPost(
            server,
            '/api/internal/recoverable-tasks',
            {
                kind: 'image_generation',
                botProfileId: 'bot-a',
                discordChannelId: 'channel-1',
                discordMessageId: 'message-1',
            }
        );
        assert.equal(unavailable.status, 503);
    } finally {
        await server.close();
    }

    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'footnote-recoverable-handler-invalid-')
    );
    const store = new SqliteRecoverableTaskStore({
        dbPath: path.join(directory, 'recoverable.db'),
    });
    const validationServer = await createServer(store);
    try {
        const invalid = await trustedPost(
            validationServer,
            '/api/internal/recoverable-tasks',
            {
                kind: 'image_generation',
                botProfileId: 'bot-a',
                discordChannelId: 'channel-1',
                discordMessageId: 'message-1',
                prompt: 'must not be stored',
            }
        );
        assert.equal(invalid.status, 400);
    } finally {
        await validationServer.close();
        store.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
