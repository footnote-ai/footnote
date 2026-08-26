/**
 * @description: Validates TrustGraph access against one backend-configured deployment collection.
 * This is the short-term single-tenant seam; it does not infer authority from caller-selected IDs.
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
    collectionId: string;
}): ScopeOwnershipValidator => ({
    validatorSource: 'backend_tenancy_service',
    validatorId: input.validatorId,
    async validateOwnership(
        scope: ScopeTuple
    ): Promise<TrustGraphScopeOwnershipValidationResult> {
        const checkedAt = new Date().toISOString();
        const isAllowed =
            scope.collectionId === input.collectionId &&
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
                'Scope is outside the backend-configured TrustGraph deployment collection.',
            evidence: [...DEPLOYMENT_SCOPE_EVIDENCE],
        };
    },
});
