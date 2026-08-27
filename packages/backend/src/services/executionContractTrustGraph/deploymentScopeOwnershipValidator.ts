/**
 * @description: Validates TrustGraph access against backend-configured deployment collections.
 * It does not infer authority from caller-selected IDs or discover additional collections.
 * @footnote-scope: core
 * @footnote-module: ExecutionContractDeploymentScopeOwnershipValidator
 * @footnote-risk: high - Incorrect fixed-scope validation could expose the wrong repository context.
 * @footnote-ethics: high - This boundary decides which users may receive provenance-backed external evidence.
 */

import type {
    ScopeOwnershipValidator,
    ScopeTuple,
    TrustGraphScopeOwnershipValidationResult,
} from './trustGraphEvidenceTypes.js';

const DEPLOYMENT_SCOPE_EVIDENCE = ['configured deployment scope'];

export const createDeploymentScopedOwnershipValidator = (input: {
    validatorId: string;
    collectionIds: readonly string[];
}): ScopeOwnershipValidator => ({
    validatorSource: 'backend_tenancy_service',
    validatorId: input.validatorId,
    async validateOwnership(
        scope: ScopeTuple
    ): Promise<TrustGraphScopeOwnershipValidationResult> {
        const checkedAt = new Date().toISOString();
        const isAllowed =
            scope.collectionId !== undefined &&
            input.collectionIds.includes(scope.collectionId) &&
            scope.projectId === undefined;

        if (isAllowed) {
            return {
                decision: 'allow',
                validatorId: input.validatorId,
                checkedAt,
                evidence: [...DEPLOYMENT_SCOPE_EVIDENCE],
            };
        }

        return {
            decision: 'deny',
            validatorId: input.validatorId,
            checkedAt,
            denialReason: 'scope_not_found',
            details:
                'Scope is outside the backend-configured TrustGraph deployment collections.',
            evidence: [...DEPLOYMENT_SCOPE_EVIDENCE],
        };
    },
});
