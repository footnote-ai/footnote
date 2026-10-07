/**
 * @description: Verifies async work launched by void event callbacks reports failures locally.
 * @footnote-scope: test
 * @footnote-module: AsyncCallbackTest
 * @footnote-risk: low - Covers the rejection boundary for Discord callbacks.
 * @footnote-ethics: low - Uses synthetic errors without user data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runAsyncCallback } from '../src/utils/runAsyncCallback.js';

test('runAsyncCallback reports sync and async failures without returning a promise', async () => {
    const asyncError = new Error('async callback failed');
    const syncError = new Error('sync callback failed');
    const reported: unknown[] = [];
    const onError = (error: unknown): void => {
        reported.push(error);
    };

    const asyncResult = runAsyncCallback(async () => {
        throw asyncError;
    }, onError);
    assert.equal(asyncResult, undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(reported, [asyncError]);

    const syncResult = runAsyncCallback(() => {
        throw syncError;
    }, onError);
    assert.equal(syncResult, undefined);
    assert.deepEqual(reported, [asyncError, syncError]);
});
