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

test('TrustGraph target configuration preserves the legacy single target shape', () => {
    const config = buildExecutionContractTrustGraphSection(
        {
            EXECUTION_CONTRACT_TRUSTGRAPH_FLOW: 'project-history-graphrag',
            EXECUTION_CONTRACT_TRUSTGRAPH_COLLECTION:
                'footnote-project-history',
            EXECUTION_CONTRACT_TRUSTGRAPH_WORKSPACE_REF: 'footnote',
        },
        () => undefined
    );

    assert.deepEqual(config.adapter.targets, [
        {
            id: 'legacy-default',
            flow: 'project-history-graphrag',
            collection: 'footnote-project-history',
            workspaceRef: 'footnote',
        },
    ]);
});

test('TrustGraph target configuration accepts an explicit bounded target set', () => {
    const config = buildExecutionContractTrustGraphSection(
        {
            EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: JSON.stringify([
                {
                    id: 'project-history',
                    flow: 'project-history-graphrag',
                    collection: 'footnote-project-history',
                    workspaceRef: 'footnote',
                },
                {
                    id: 'jordan-context',
                    flow: 'jordan-context-graphrag',
                    collection: 'jordan-context',
                    workspaceRef: 'footnote',
                },
            ]),
        },
        () => undefined
    );

    assert.deepEqual(config.adapter.targets, [
        {
            id: 'project-history',
            flow: 'project-history-graphrag',
            collection: 'footnote-project-history',
            workspaceRef: 'footnote',
        },
        {
            id: 'jordan-context',
            flow: 'jordan-context-graphrag',
            collection: 'jordan-context',
            workspaceRef: 'footnote',
        },
    ]);
});

test('TrustGraph target configuration rejects duplicate identities', () => {
    assert.throws(
        () =>
            buildExecutionContractTrustGraphSection(
                {
                    EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: JSON.stringify([
                        {
                            id: 'duplicate',
                            flow: 'flow-a',
                            collection: 'collection-a',
                        },
                        {
                            id: 'duplicate',
                            flow: 'flow-b',
                            collection: 'collection-b',
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
                    EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: '{not-json',
                },
                () => undefined
            ),
        /execution_contract_trustgraph_invalid_targets_json/
    );
});

test('TrustGraph target configuration gives explicit targets precedence over legacy fields', () => {
    const config = buildExecutionContractTrustGraphSection(
        {
            EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS: JSON.stringify([
                {
                    id: 'explicit',
                    flow: 'explicit-flow',
                    collection: 'explicit-collection',
                },
            ]),
            EXECUTION_CONTRACT_TRUSTGRAPH_FLOW: 'legacy-flow',
            EXECUTION_CONTRACT_TRUSTGRAPH_COLLECTION: 'legacy-collection',
        },
        () => undefined
    );

    assert.deepEqual(config.adapter.targets, [
        {
            id: 'explicit',
            flow: 'explicit-flow',
            collection: 'explicit-collection',
        },
    ]);
});
