/**
 * @description: Resolves runtime TrustGraph integration wiring from config into chat-service options.
 * This centralizes enable/kill-switch policy, adapter binding, and tenancy ownership validator binding.
 * @footnote-scope: core
 * @footnote-module: ExecutionContractTrustGraphRuntimeWiring
 * @footnote-risk: high - Miswiring here can either disable retrieval silently or weaken retrieval safety boundaries.
 * @footnote-ethics: high - Runtime wiring choices govern tenancy checks and advisory-evidence behavior in production.
 */

import type { RuntimeConfig } from '../../config/types.js';
import type { CreateChatServiceOptions } from '../chatService.js';
import { logger } from '../../utils/logger.js';
import { createDeploymentScopedOwnershipValidator } from './deploymentScopeOwnershipValidator.js';
import { createScopeOwnershipValidatorFromTenancyService } from './tenancyOwnershipValidator.js';
import { createBackendTenancyOwnershipHttpService } from './tenancyOwnershipHttpService.js';
import { createHttpTrustGraphEvidenceAdapter } from './trustGraphHttpAdapter.js';
import { StubTrustGraphEvidenceAdapter } from './trustGraphEvidenceAdapter.js';
import {
    TrustGraphOwnershipValidationPolicy,
    type TrustGraphTargetConfig,
} from './trustGraphEvidenceTypes.js';

type ExecutionContractTrustGraphRuntimeConfig =
    RuntimeConfig['executionContractTrustGraph'];

const isNonEmptyString = (value: string | null): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const MAX_LOGGED_FAILURE_DETAIL_LENGTH = 256;

const normalizeFailureDetail = (value: unknown): string => {
    if (typeof value !== 'string') {
        return '';
    }

    let normalized = '';
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        normalized += codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
    }

    return normalized.trim().slice(0, MAX_LOGGED_FAILURE_DETAIL_LENGTH);
};

const describeTargetFailure = (
    error: unknown
): { errorName: string; reason: string } => {
    if (error instanceof Error) {
        const errorName = normalizeFailureDetail(error.name) || 'Error';
        const reason = normalizeFailureDetail(error.message) || errorName;
        return { errorName, reason };
    }

    if (typeof error === 'object' && error !== null) {
        const errorRecord = error as Record<string, unknown>;
        const errorName =
            normalizeFailureDetail(errorRecord.name) || 'UnknownError';
        const reason = normalizeFailureDetail(errorRecord.message) || errorName;
        return { errorName, reason };
    }

    const reason = normalizeFailureDetail(error) || 'unknown_error';
    const errorName =
        reason === 'trustgraph_adapter_aborted_by_signal'
            ? 'AbortError'
            : 'UnknownError';
    return { errorName, reason };
};

const requireHttpAdapterConfig = (input: {
    baseUrl: string | null;
    targets: readonly TrustGraphTargetConfig[];
    apiToken: string | null;
}): {
    baseUrl: string;
    targets: readonly TrustGraphTargetConfig[];
    apiToken: string;
} => {
    if (!isNonEmptyString(input.baseUrl)) {
        throw new Error(
            'execution_contract_trustgraph_http_adapter_missing_base_url'
        );
    }
    if (input.targets.length === 0) {
        throw new Error(
            'execution_contract_trustgraph_http_adapter_missing_targets'
        );
    }
    if (!isNonEmptyString(input.apiToken)) {
        throw new Error(
            'execution_contract_trustgraph_http_adapter_missing_api_token'
        );
    }

    return {
        baseUrl: input.baseUrl,
        targets: input.targets,
        apiToken: input.apiToken,
    };
};

/**
 * Converts TrustGraph runtime config into the optional chat-service seam.
 *
 * This module wires adapters and validators. It does not decide whether
 * external evidence is sufficient for an answer, and it does not create a
 * second policy authority beside the backend execution contract.
 */
export const resolveExecutionContractTrustGraphRuntimeOptions = (
    config: ExecutionContractTrustGraphRuntimeConfig
): CreateChatServiceOptions['executionContractTrustGraph'] | undefined => {
    if (!config.enabled) {
        logger.info(
            'chat.execution_contract_trustgraph.runtime_disabled (reason=disabled_by_config)'
        );
        return undefined;
    }

    if (config.killSwitchExternalRetrieval) {
        logger.warn(
            'chat.execution_contract_trustgraph.runtime_disabled (reason=kill_switch_active)'
        );
        return undefined;
    }

    const ownershipValidationPolicy =
        TrustGraphOwnershipValidationPolicy.required({
            policyId: config.policyId,
        });

    const deploymentCollectionIds = config.adapter.targets.map(
        (target) => target.collection
    );
    const deploymentCollectionId =
        config.ownership.bindingMode === 'deployment'
            ? deploymentCollectionIds[0]
            : undefined;
    if (
        config.ownership.bindingMode === 'deployment' &&
        deploymentCollectionIds.length === 0
    ) {
        logger.warn(
            `chat.execution_contract_trustgraph.runtime_disabled (reason=deployment_scope_missing_targets, bindingMode=${config.ownership.bindingMode})`
        );
        return undefined;
    }

    let adapter: NonNullable<
        CreateChatServiceOptions['executionContractTrustGraph']
    >['adapter'];
    if (config.adapter.mode === 'http') {
        const adapterConfig = requireHttpAdapterConfig({
            baseUrl: config.adapter.baseUrl,
            targets: config.adapter.targets,
            apiToken: config.adapter.apiToken,
        });
        adapter = createHttpTrustGraphEvidenceAdapter({
            baseUrl: adapterConfig.baseUrl,
            targets: adapterConfig.targets,
            apiToken: adapterConfig.apiToken,
            workspaceRef: config.adapter.workspaceRef,
            limits: config.adapter.graphRagLimits,
            onTargetFailure: (target, error) => {
                const failure = describeTargetFailure(error);
                const event =
                    'chat.execution_contract_trustgraph.target_failed';
                logger.warn(
                    `${event} (targetId=${target.id}, flow=${target.flow}, collection=${target.collection}, errorName=${failure.errorName}, reason=${failure.reason})`,
                    {
                        event,
                        targetId: target.id,
                        flow: target.flow,
                        collection: target.collection,
                        errorName: failure.errorName,
                        reason: failure.reason,
                    }
                );
            },
            onTargetResponseTruncated: (target, details) => {
                const event =
                    'chat.execution_contract_trustgraph.target_response_truncated';
                logger.warn(
                    `${event} (targetId=${target.id}, flow=${target.flow}, collection=${target.collection}, originalResponseChars=${details.originalResponseChars}, retainedResponseChars=${details.retainedResponseChars})`,
                    {
                        event,
                        targetId: target.id,
                        flow: target.flow,
                        collection: target.collection,
                        originalResponseChars: details.originalResponseChars,
                        retainedResponseChars: details.retainedResponseChars,
                    }
                );
            },
        });
    } else if (config.adapter.mode === 'stub') {
        adapter = new StubTrustGraphEvidenceAdapter(config.adapter.stubMode);
    } else {
        adapter = undefined;
    }

    let scopeOwnershipValidator:
        | NonNullable<
              CreateChatServiceOptions['executionContractTrustGraph']
          >['scopeOwnershipValidator']
        | undefined;
    if (config.ownership.bindingMode === 'deployment') {
        if (deploymentCollectionIds.length === 0) {
            return undefined;
        }

        // Deployment mode deliberately ignores caller-selected project and
        // collection IDs. The configured target set is the backend authority.
        scopeOwnershipValidator = createDeploymentScopedOwnershipValidator({
            validatorId: config.ownership.validatorId,
            collectionIds: deploymentCollectionIds,
        });
    } else if (config.ownership.bindingMode === 'http') {
        // Missing ownership wiring fails open at the adapter seam. Retrieval may
        // still be disabled later by downstream validation or caller policy.
        if (!isNonEmptyString(config.ownership.endpointUrl)) {
            logger.warn(
                `chat.execution_contract_trustgraph.ownership_wiring (reason=ownership_http_missing_endpoint, bindingMode=${config.ownership.bindingMode})`
            );
            scopeOwnershipValidator = undefined;
        } else {
            const tenancyService = createBackendTenancyOwnershipHttpService({
                endpointUrl: config.ownership.endpointUrl,
                apiToken: config.ownership.apiToken,
                timeoutMs: config.timeoutMs,
            });
            scopeOwnershipValidator =
                createScopeOwnershipValidatorFromTenancyService({
                    validatorId: config.ownership.validatorId,
                    service: tenancyService,
                });
        }
    } else {
        scopeOwnershipValidator = undefined;
    }

    logger.info(
        `chat.execution_contract_trustgraph.runtime_wiring (enabled=true, adapterMode=${config.adapter.mode}, targetCount=${config.adapter.targets.length}, adapterConfigured=${String(
            adapter !== undefined
        )}, workspaceRefConfigured=${String(isNonEmptyString(config.adapter.workspaceRef))}, ownershipBindingMode=${config.ownership.bindingMode}, ownershipValidatorConfigured=${String(
            scopeOwnershipValidator !== undefined
        )}, policyId=${config.policyId})`
    );

    return {
        adapter,
        ...(deploymentCollectionId !== undefined && {
            deploymentCollectionId,
        }),
        budget: {
            timeoutMs: config.timeoutMs,
            maxCalls: config.maxCalls,
        },
        ownershipValidationPolicy,
        scopeValidationPolicy: {
            ownershipValidationTimeoutMs: config.timeoutMs,
        },
        scopeOwnershipValidator,
    };
};
