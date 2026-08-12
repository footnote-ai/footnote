/**
 * @description: Verifies retryable, concurrent-safe lazy module loading.
 * @footnote-scope: test
 * @footnote-module: LoadOnceTests
 * @footnote-risk: low - Covers resource-loading behavior without external side effects.
 * @footnote-ethics: low - Test-only coverage for local performance behavior.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoadOnce } from '../src/utils/loadOnce.js';

test('coalesces concurrent first loads and caches the successful value', async () => {
    let calls = 0;
    let resolveLoad: ((value: string) => void) | undefined;
    const loader = createLoadOnce(
        () =>
            new Promise<string>((resolve) => {
                calls += 1;
                resolveLoad = resolve;
            })
    );

    const first = loader();
    const second = loader();
    assert.equal(calls, 1);
    resolveLoad?.('loaded');

    assert.equal(await first, 'loaded');
    assert.equal(await second, 'loaded');
    assert.equal(await loader(), 'loaded');
    assert.equal(calls, 1);
});

test('clears a failed load so the next action can retry', async () => {
    let calls = 0;
    const loader = createLoadOnce(async () => {
        calls += 1;
        if (calls === 1) {
            throw new Error('temporary import failure');
        }
        return 'recovered';
    });

    await assert.rejects(loader(), /temporary import failure/);
    assert.equal(await loader(), 'recovered');
    assert.equal(calls, 2);
});
