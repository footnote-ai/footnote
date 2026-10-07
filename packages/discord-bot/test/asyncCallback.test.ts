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

test('runAsyncCallback reports a rejected follow-up and sync failures', async () => {
    const followUpError = new Error('follow-up failed');
    const syncError = new Error('sync callback failed');
    const reported: unknown[] = [];
    const interaction = {
        followUp: async (): Promise<void> => {
            throw followUpError;
        },
    };
    const onError = (error: unknown): void => {
        reported.push(error);
    };

    const asyncResult = runAsyncCallback(async () => {
        await interaction.followUp();
    }, onError);
    assert.equal(asyncResult, undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(reported, [followUpError]);

    const syncResult = runAsyncCallback(() => {
        throw syncError;
    }, onError);
    assert.equal(syncResult, undefined);
    assert.deepEqual(reported, [followUpError, syncError]);
});
