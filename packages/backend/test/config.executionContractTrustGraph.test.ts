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

test('TrustGraph retrieval defaults to a 60-second timeout for local runtimes', () => {
    const config = buildExecutionContractTrustGraphSection({}, () => undefined);

    assert.equal(config.timeoutMs, 60_000);
});

test('TrustGraph retrieval preserves an explicitly configured timeout', () => {
    const config = buildExecutionContractTrustGraphSection(
        { EXECUTION_CONTRACT_TRUSTGRAPH_TIMEOUT_MS: '4500' },
        () => undefined
    );

    assert.equal(config.timeoutMs, 4500);
});

test('TrustGraph target configuration accepts an explicit bounded target set', () => {
    const config = buildExecutionContractTrustGraphSection(
        {
            EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED: 'true',
            EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: JSON.stringify([
                {
                    id: 'meeting-archive',
                    flow: 'meeting-flow',
                    collection: 'meeting-archive',
                    description: 'Historical meeting notes and decisions.',
                    workspaceRef: 'footnote',
                },
                {
                    id: 'product-docs',
                    flow: 'product-flow',
                    collection: 'product-docs',
                    description: 'Current product documentation.',
                    workspaceRef: 'footnote',
                },
            ]),
        },
        () => undefined
    );

    assert.deepEqual(config.adapter.targets, [
        {
            id: 'meeting-archive',
            flow: 'meeting-flow',
            collection: 'meeting-archive',
            description: 'Historical meeting notes and decisions.',
            workspaceRef: 'footnote',
        },
        {
            id: 'product-docs',
            flow: 'product-flow',
            collection: 'product-docs',
            description: 'Current product documentation.',
            workspaceRef: 'footnote',
        },
    ]);
});

test('TrustGraph target configuration rejects duplicate identities', () => {
    assert.throws(
        () =>
            buildExecutionContractTrustGraphSection(
                {
                    EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED: 'true',
                    EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: JSON.stringify([
                        {
                            id: 'duplicate',
                            flow: 'flow-a',
                            collection: 'collection-a',
                            description: 'First target.',
                        },
                        {
                            id: 'duplicate',
                            flow: 'flow-b',
                            collection: 'collection-b',
                            description: 'Second target.',
                        },
                    ]),
                },
                () => undefined
            ),
        /execution_contract_trustgraph_invalid_targets_duplicate_id/
    );
});

test('TrustGraph target configuration rejects malformed target JSON', () => {
    assert.throws(
        () =>
            buildExecutionContractTrustGraphSection(
                {
                    EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED: 'true',
                    EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: '{not-json',
                },
                () => undefined
            ),
        /execution_contract_trustgraph_invalid_targets_json/
    );
});

test('TrustGraph target configuration requires a bounded description', () => {
    assert.throws(
        () =>
            buildExecutionContractTrustGraphSection(
                {
                    EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED: 'true',
                    EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: JSON.stringify([
                        {
                            id: 'product-docs',
                            flow: 'product-flow',
                            collection: 'product-docs',
                        },
                    ]),
                },
                () => undefined
            ),
        /execution_contract_trustgraph_invalid_targets_missing_description/
    );
});

test('Disabled TrustGraph ignores malformed target JSON so local chat stays available', () => {
    const config = buildExecutionContractTrustGraphSection(
        {
            EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: '{not-json',
        },
        () => undefined
    );

    assert.equal(config.enabled, false);
    assert.deepEqual(config.adapter.targets, []);
});
