/**
 * @description: Checks typed transport for account-owned memory operations.
 * @footnote-scope: test
 * @footnote-module: AccountMemoryApiTests
 * @footnote-risk: low - Assertions cover the typed API client boundary.
 * @footnote-ethics: high - Correct CSRF wiring protects private user memories.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    ApiJsonResult,
    ApiRequestOptions,
    ApiRequester,
} from '../src/client.js';
import { createAccountMemoryApi } from '../src/accountMemories.js';

test('account memory client uses private reads and CSRF-protected writes', async () => {
    const calls: Array<{
        endpoint: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
    }> = [];
    const requestJson: ApiRequester = async <T>(
        endpoint: string,
        options: ApiRequestOptions<T> = {}
    ) => {
        calls.push({
            endpoint,
            method: options.method,
            headers: options.headers,
            body: options.body,
        });
        return { status: 200, data: { memories: [] } } as ApiJsonResult<T>;
    };
    const api = createAccountMemoryApi(requestJson);

    await api.getAccountMemories();
    await api.addAccountMemory('concise answers', 'csrf-value');
    await api.forgetAccountMemory('memory-id', 'csrf-value');

    assert.deepEqual(
        calls.map(({ endpoint, method }) => [endpoint, method]),
        [
            ['/api/account/memories', 'GET'],
            ['/api/account/memories', 'POST'],
            ['/api/account/memories/memory-id', 'DELETE'],
        ]
    );
    assert.deepEqual(calls[1]?.headers, { 'x-auth-csrf': 'csrf-value' });
    assert.deepEqual(calls[1]?.body, { text: 'concise answers' });
    assert.deepEqual(calls[2]?.headers, { 'x-auth-csrf': 'csrf-value' });
});
