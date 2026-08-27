/**
 * @description: Verifies deployment-scoped TrustGraph ownership decisions stay fixed to backend configuration.
 * @footnote-scope: test
 * @footnote-module: ExecutionContractDeploymentScopeOwnershipValidatorTests
 * @footnote-risk: high - Missing coverage could allow caller-selected TrustGraph collections.
 * @footnote-ethics: high - Scope decisions determine which repository context a chat request may inspect.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeploymentScopedOwnershipValidator } from '../src/services/executionContractTrustGraph/deploymentScopeOwnershipValidator.js';

test('deployment scope validator allows the configured collection without a project selector', async () => {
    const validator = createDeploymentScopedOwnershipValidator({
        validatorId: 'backend_deployment_scope_v1',
        collectionIds: ['footnote-repository-context'],
    });

    const result = await validator.validateOwnership({
        userId: 'user_1',
        collectionId: 'footnote-repository-context',
    });

    assert.equal(result.decision, 'allow');
    assert.equal(result.validatorId, 'backend_deployment_scope_v1');
});

test('deployment scope validator denies caller-selected collections and projects', async () => {
    const validator = createDeploymentScopedOwnershipValidator({
        validatorId: 'backend_deployment_scope_v1',
        collectionIds: ['footnote-repository-context'],
    });

    const wrongCollection = await validator.validateOwnership({
        userId: 'user_1',
        collectionId: 'other-context',
    });
    const projectSelector = await validator.validateOwnership({
        userId: 'user_1',
        collectionId: 'footnote-repository-context',
        projectId: 'caller-selected-project',
    });

    assert.equal(wrongCollection.decision, 'deny');
    assert.equal(wrongCollection.denialReason, 'scope_not_found');
    assert.equal(projectSelector.decision, 'deny');
    assert.equal(projectSelector.denialReason, 'scope_not_found');
});

test('deployment scope validator allows every explicitly configured collection', async () => {
    const validator = createDeploymentScopedOwnershipValidator({
        validatorId: 'backend_deployment_scope_v1',
        collectionIds: ['history', 'operator'],
    });

    const history = await validator.validateOwnership({
        userId: 'user_1',
        collectionId: 'history',
    });
    const operator = await validator.validateOwnership({
        userId: 'user_1',
        collectionId: 'operator',
    });

    assert.equal(history.decision, 'allow');
    assert.equal(operator.decision, 'allow');
});
