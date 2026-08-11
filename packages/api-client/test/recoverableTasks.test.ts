/**
 * @description: Verifies trusted recoverable-task API request wiring and response validation.
 * @footnote-scope: test
 * @footnote-module: RecoverableTaskApiTests
 * @footnote-risk: low - Covers transport construction without network side effects.
 * @footnote-ethics: medium - Confirms only minimal recovery metadata crosses the trusted boundary.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
    ApiJsonResult,
    ApiRequester,
    ApiRequestOptions,
} from '../src/client.js';
import { createRecoverableTaskApi } from '../src/recoverableTasks.js';

type CapturedRequest = {
    endpoint: string;
    options: ApiRequestOptions<unknown>;
};

test('recoverable-task API sends trusted lifecycle requests to stable paths', async () => {
    const captured: CapturedRequest[] = [];
    const requestJson: ApiRequester = async <T>(
        endpoint: string,
        options: ApiRequestOptions<T> = {}
    ): Promise<ApiJsonResult<T>> => {
        captured.push({
            endpoint,
            options: options as ApiRequestOptions<unknown>,
        });
        const body = options.body as { state?: 'complete' | 'failed' };
        const data = endpoint.endsWith('/claim')
            ? { tasks: [] }
            : endpoint.endsWith('/finish')
              ? {
                    task: {
                        id: 'task/1',
                        kind: 'image_generation',
                        state: body.state ?? 'complete',
                        botProfileId: 'bot-a',
                        discordChannelId: 'channel-1',
                        discordMessageId: 'message-1',
                        createdAt: '2026-08-11T00:00:00.000Z',
                        updatedAt: '2026-08-11T00:00:01.000Z',
                    },
                    changed: true,
                }
              : {
                    task: {
                        id: 'task/1',
                        kind: 'image_generation',
                        state: 'started',
                        botProfileId: 'bot-a',
                        discordChannelId: 'channel-1',
                        discordMessageId: 'message-1',
                        createdAt: '2026-08-11T00:00:00.000Z',
                        updatedAt: '2026-08-11T00:00:00.000Z',
                    },
                };
        options.validateResponse?.(data);
        return {
            status: endpoint.endsWith('/finish') ? 200 : 201,
            data: data as T,
        };
    };
    const api = createRecoverableTaskApi(requestJson, {
        traceApiToken: 'trace-secret',
    });

    await api.startRecoverableTask({
        kind: 'image_generation',
        botProfileId: 'bot-a',
        discordChannelId: 'channel-1',
        discordMessageId: 'message-1',
    });
    await api.completeRecoverableTask('task/1');
    await api.failRecoverableTask('task/1');
    await api.claimRecoverableTasks({ botProfileId: 'bot-a' });

    assert.deepEqual(
        captured.map((request) => request.endpoint),
        [
            '/api/internal/recoverable-tasks',
            '/api/internal/recoverable-tasks/task%2F1/finish',
            '/api/internal/recoverable-tasks/task%2F1/finish',
            '/api/internal/recoverable-tasks/claim',
        ]
    );
    assert.deepEqual(
        captured.map((request) => request.options.headers),
        Array.from({ length: 4 }, () => ({
            'X-Trace-Token': 'trace-secret',
        }))
    );
    assert.deepEqual(captured[1].options.body, { state: 'complete' });
    assert.deepEqual(captured[2].options.body, { state: 'failed' });
});

test('recoverable-task API rejects malformed backend responses', async () => {
    const requestJson: ApiRequester = async <T>(
        _endpoint: string,
        options: ApiRequestOptions<T> = {}
    ): Promise<ApiJsonResult<T>> => {
        const data = { task: { prompt: 'unexpected retained data' } };
        const validation = options.validateResponse?.(data);
        if (validation && !validation.success) {
            throw new Error(validation.error);
        }
        return { status: 200, data: data as T };
    };
    const api = createRecoverableTaskApi(requestJson, {});

    await assert.rejects(() =>
        api.startRecoverableTask({
            kind: 'image_generation',
            botProfileId: 'bot-a',
            discordChannelId: 'channel-1',
            discordMessageId: 'message-1',
        })
    );
});
