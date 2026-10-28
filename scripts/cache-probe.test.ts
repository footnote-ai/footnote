/**
 * @description: Verifies the live cache probe cannot exceed its approved allowance.
 * @footnote-scope: test
 * @footnote-module: CacheProbeBudgetTests
 * @footnote-risk: high - Guard regressions can make real paid requests unbounded.
 * @footnote-ethics: high - Unknown rates must stop rather than guess spend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveCacheProbeRequest } from './lib/cache-probe-budget.js';
import {
    assertCacheProbeCheckpointMatches,
    readCacheProbeCommit,
    resolveCacheProbeGit,
} from './lib/cache-probe-git.js';
import path from 'node:path';

test('cache probe counts retries, stops before the next disallowed call, and rejects unknown rates', () => {
    const pricing = { inputPerToken: 0.000001, outputPerToken: 0.000001 };
    const body = JSON.stringify({
        max_output_tokens: 32,
        input: 'synthetic fixture',
    });
    const budget = { calls: 0, reservedUsd: 0 };
    for (let index = 0; index < 60; index += 1)
        reserveCacheProbeRequest(budget, body, pricing);
    assert.equal(budget.calls, 60);
    assert.throws(
        () => reserveCacheProbeRequest(budget, body, pricing),
        /budget exhausted/
    );
    assert.equal(budget.calls, 60);
    const nearLimit = { calls: 1, reservedUsd: 1.99999 };
    assert.throws(
        () => reserveCacheProbeRequest(nearLimit, body, pricing),
        /budget exhausted/
    );
    assert.equal(nearLimit.calls, 1);
    assert.throws(
        () =>
            reserveCacheProbeRequest({ calls: 0, reservedUsd: 0 }, body, {
                ...pricing,
                inputPerToken: NaN,
            }),
        /known pricing/
    );
    assert.throws(
        () =>
            reserveCacheProbeRequest(
                { calls: 0, reservedUsd: 0 },
                '{}',
                pricing
            ),
        /bounded output/
    );
});

test('cache probe Git preflight checks only supported absolute paths', () => {
    const checked: string[] = [];
    assert.equal(
        resolveCacheProbeGit('win32', (candidate) => {
            checked.push(candidate);
            return candidate.includes('(x86)');
        }),
        String.raw`C:\Program Files (x86)\Git\cmd\git.exe`
    );
    assert.deepEqual(checked, [
        String.raw`C:\Program Files\Git\cmd\git.exe`,
        String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
    ]);
    assert.throws(
        () => resolveCacheProbeGit('win32', () => false),
        /requires Git in a supported install path/
    );
});

test('cache probe reports a failed revision lookup before starting the probe', () => {
    assert.throws(
        () =>
            readCacheProbeCommit(
                process.execPath,
                path.join('missing', 'repo')
            ),
        /could not read the current Git revision/
    );
});

test('cache probe refuses to resume checkpoints from another source revision', () => {
    const checkpoint = { commit: 'commit-a', reportSourceDigest: 'digest-a' };
    assert.doesNotThrow(() =>
        assertCacheProbeCheckpointMatches(checkpoint, 'commit-a', 'digest-a')
    );
    assert.throws(
        () =>
            assertCacheProbeCheckpointMatches(
                checkpoint,
                'commit-b',
                'digest-a'
            ),
        /different source revision/
    );
    assert.throws(
        () =>
            assertCacheProbeCheckpointMatches(
                checkpoint,
                'commit-a',
                'digest-b'
            ),
        /different source revision/
    );
});
