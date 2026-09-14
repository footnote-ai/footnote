/**
 * @description: Verifies web API transport timeout behavior stays behind the web chat boundary.
 * @footnote-scope: test
 * @footnote-module: WebApiClientTests
 * @footnote-risk: low - Uses synthetic fetch behavior and observes only timeout wiring.
 * @footnote-ethics: low - No production data or external services are involved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createWebApiClient,
    DEFAULT_WEB_API_TIMEOUT_MS,
} from '../src/webClient.js';

const abortableFetch = async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        signal.addEventListener(
            'abort',
            () =>
                reject(
                    Object.assign(new Error('aborted'), { name: 'AbortError' })
                ),
            { once: true }
        );
    });

test('web API client leaves the 60-second UI deadline as the timeout owner', async () => {
    const scheduledTimeouts: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    const controller = new AbortController();

    globalThis.setTimeout = ((
        _callback: Parameters<typeof setTimeout>[0],
        delay?: number
    ) => {
        scheduledTimeouts.push(delay ?? 0);
        return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    try {
        const api = createWebApiClient({ fetchImpl: abortableFetch });
        const request = api.requestJson('/api/example', {
            signal: controller.signal,
        });

        globalThis.setTimeout = originalSetTimeout;
        controller.abort();

        await assert.rejects(request, (error: unknown) => {
            assert.equal((error as { code?: unknown }).code, 'aborted_error');
            return true;
        });
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }

    assert.deepEqual(scheduledTimeouts, [DEFAULT_WEB_API_TIMEOUT_MS]);
    assert.ok(DEFAULT_WEB_API_TIMEOUT_MS > 60_000);
});

test('web API client honors an explicit timeout override', async () => {
    const api = createWebApiClient({ fetchImpl: abortableFetch });

    await assert.rejects(
        api.requestJson('/api/example', { timeoutMs: 10 }),
        (error: unknown) => {
            assert.equal((error as { code?: unknown }).code, 'timeout_error');
            assert.match(
                (error as { message?: unknown }).message as string,
                /10ms/
            );
            return true;
        }
    );
});
