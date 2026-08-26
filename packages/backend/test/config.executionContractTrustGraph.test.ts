/**
 * @description: Verifies default and explicit TrustGraph retrieval timeout configuration.
 * @footnote-scope: test
 * @footnote-module: ExecutionContractTrustGraphConfigTest
 * @footnote-risk: low - Configuration regression tests only observe parsed runtime defaults.
 * @footnote-ethics: medium - A timeout that is too short can hide provenance from users.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionContractTrustGraphSection } from '../src/config/sections/executionContractTrustGraph.js';

test('TrustGraph retrieval defaults to a 20-second timeout for local runtimes', () => {
    const config = buildExecutionContractTrustGraphSection({}, () => undefined);

    assert.equal(config.timeoutMs, 20_000);
});

test('TrustGraph retrieval preserves an explicitly configured timeout', () => {
    const config = buildExecutionContractTrustGraphSection(
        { EXECUTION_CONTRACT_TRUSTGRAPH_TIMEOUT_MS: '4500' },
        () => undefined
    );

    assert.equal(config.timeoutMs, 4500);
});
