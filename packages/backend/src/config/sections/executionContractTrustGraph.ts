/**
 * @description: Builds Execution Contract TrustGraph runtime config for advisory external retrieval wiring.
 * This keeps runtime policy, adapter mode, tenancy binding, and kill-switch controls centralized.
 * @footnote-scope: utility
 * @footnote-module: ExecutionContractTrustGraphConfigSection
 * @footnote-risk: high - Misparsed TrustGraph runtime config can silently change external retrieval behavior.
 * @footnote-ethics: high - This config controls tenancy validation and advisory evidence governance boundaries.
 */

import {
    parseBooleanEnv,
    parseOptionalTrimmedString,
    parsePositiveIntEnv,
    parseStringUnionEnv,
} from '../parsers.js';
import type { RuntimeConfig, WarningSink } from '../types.js';
import type { TrustGraphTargetConfig } from '../../services/executionContractTrustGraph/trustGraphEvidenceTypes.js';

type AdapterMode =
    RuntimeConfig['executionContractTrustGraph']['adapter']['mode'];
type OwnershipBindingMode =
    RuntimeConfig['executionContractTrustGraph']['ownership']['bindingMode'];
type StubAdapterMode =
    RuntimeConfig['executionContractTrustGraph']['adapter']['stubMode'];

const ADAPTER_MODES: ReadonlySet<AdapterMode> = new Set([
    'none',
    'stub',
    'http',
]);
const OWNERSHIP_BINDING_MODES: ReadonlySet<OwnershipBindingMode> = new Set([
    'none',
    'http',
    'deployment',
]);
const STUB_ADAPTER_MODES: ReadonlySet<StubAdapterMode> = new Set([
    'success',
    'failure',
    'timeout',
    'poisoned',
]);

const MAX_CONFIGURED_TARGETS = 8;
const TARGET_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

const invalidTargets = (reason: string): never => {
    throw new Error(`execution_contract_trustgraph_invalid_targets_${reason}`);
};

const parseTargetString = (
    value: unknown,
    field: 'id' | 'flow' | 'collection',
    index: number
): string => {
    if (typeof value !== 'string') {
        return invalidTargets(`missing_${field}_${index}`);
    }
    if (value.trim().length === 0) {
        return invalidTargets(`missing_${field}_${index}`);
    }

    const trimmed = value.trim();
    if (field === 'id' && !TARGET_ID_PATTERN.test(trimmed)) {
        invalidTargets(`invalid_id_${index}`);
    }

    return trimmed;
};

const parseConfiguredTargets = (
    rawTargets: string | undefined
): TrustGraphTargetConfig[] | undefined => {
    if (rawTargets === undefined) {
        return undefined;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawTargets);
    } catch {
        invalidTargets('json');
    }

    if (!Array.isArray(parsed)) {
        return invalidTargets('shape');
    }
    if (parsed.length > MAX_CONFIGURED_TARGETS) {
        invalidTargets('too_many');
    }

    const targetCandidates: unknown[] = parsed;
    const identities = new Set<string>();
    return targetCandidates.map((candidate, index): TrustGraphTargetConfig => {
        if (candidate === null || typeof candidate !== 'object') {
            return invalidTargets(`shape_${index}`);
        }

        const record = candidate as Record<string, unknown>;
        const id = parseTargetString(record.id, 'id', index);
        if (identities.has(id)) {
            invalidTargets(`duplicate_id_${id}`);
        }
        identities.add(id);

        const workspaceRef = record.workspaceRef;
        if (
            workspaceRef !== undefined &&
            workspaceRef !== null &&
            (typeof workspaceRef !== 'string' ||
                workspaceRef.trim().length === 0)
        ) {
            invalidTargets(`invalid_workspace_${index}`);
        }

        return {
            id,
            flow: parseTargetString(record.flow, 'flow', index),
            collection: parseTargetString(
                record.collection,
                'collection',
                index
            ),
            ...(workspaceRef !== undefined && {
                workspaceRef:
                    workspaceRef === null
                        ? null
                        : (workspaceRef as string).trim(),
            }),
        };
    });
};

const parseLegacyTarget = (
    flow: string | undefined,
    collection: string | undefined,
    workspaceRef: string | undefined
): TrustGraphTargetConfig[] => {
    if (flow === undefined && collection === undefined) {
        return [];
    }
    if (flow === undefined || collection === undefined) {
        return invalidTargets('legacy_target');
    }

    const requiredFlow = flow;
    const requiredCollection = collection;

    return [
        {
            id: 'legacy-default',
            flow: requiredFlow,
            collection: requiredCollection,
            ...(workspaceRef !== undefined && { workspaceRef }),
        },
    ];
};

/**
 * Resolves explicit runtime policy and connection settings for advisory
 * TrustGraph integration.
 */
export const buildExecutionContractTrustGraphSection = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): RuntimeConfig['executionContractTrustGraph'] => {
    const flow = parseOptionalTrimmedString(
        env.EXECUTION_CONTRACT_TRUSTGRAPH_FLOW
    );
    const collection = parseOptionalTrimmedString(
        env.EXECUTION_CONTRACT_TRUSTGRAPH_COLLECTION
    );
    const workspaceRef = parseOptionalTrimmedString(
        env.EXECUTION_CONTRACT_TRUSTGRAPH_WORKSPACE_REF
    );
    const explicitTargets = parseConfiguredTargets(
        env.EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS
    );

    return {
        enabled: parseBooleanEnv(
            env.EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED,
            false,
            'EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED',
            warn
        ),
        killSwitchExternalRetrieval: parseBooleanEnv(
            env.EXECUTION_CONTRACT_TRUSTGRAPH_KILL_SWITCH,
            false,
            'EXECUTION_CONTRACT_TRUSTGRAPH_KILL_SWITCH',
            warn
        ),
        policyId:
            parseOptionalTrimmedString(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_POLICY_ID
            ) ?? 'server_chat_runtime_policy',
        timeoutMs: parsePositiveIntEnv(
            env.EXECUTION_CONTRACT_TRUSTGRAPH_TIMEOUT_MS,
            30_000,
            'EXECUTION_CONTRACT_TRUSTGRAPH_TIMEOUT_MS',
            warn
        ),
        maxCalls: parsePositiveIntEnv(
            env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_CALLS,
            1,
            'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_CALLS',
            warn
        ),
        adapter: {
            mode: parseStringUnionEnv<AdapterMode>(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_MODE,
                'none',
                'EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_MODE',
                ADAPTER_MODES,
                warn
            ),
            baseUrl: parseOptionalTrimmedString(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_BASE_URL
            ),
            targets:
                explicitTargets ??
                parseLegacyTarget(
                    flow ?? undefined,
                    collection ?? undefined,
                    workspaceRef ?? undefined
                ),
            apiToken: parseOptionalTrimmedString(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_API_TOKEN
            ),
            workspaceRef: parseOptionalTrimmedString(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_WORKSPACE_REF
            ),
            graphRagLimits: {
                maxQueryChars: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_QUERY_CHARS,
                    8000,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_QUERY_CHARS',
                    warn
                ),
                entityLimit: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_ENTITY_LIMIT,
                    50,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_ENTITY_LIMIT',
                    warn
                ),
                tripleLimit: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_TRIPLE_LIMIT,
                    30,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_TRIPLE_LIMIT',
                    warn
                ),
                maxSubgraphSize: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SUBGRAPH_SIZE,
                    1000,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SUBGRAPH_SIZE',
                    warn
                ),
                maxPathLength: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_PATH_LENGTH,
                    2,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_PATH_LENGTH',
                    warn
                ),
                maxResponseChars: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_RESPONSE_CHARS,
                    12000,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_RESPONSE_CHARS',
                    warn
                ),
                maxSources: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SOURCES,
                    20,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SOURCES',
                    warn
                ),
                maxSourceUriChars: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SOURCE_URI_CHARS,
                    2048,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SOURCE_URI_CHARS',
                    warn
                ),
                maxSourceTitleChars: parsePositiveIntEnv(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SOURCE_TITLE_CHARS,
                    512,
                    'EXECUTION_CONTRACT_TRUSTGRAPH_MAX_SOURCE_TITLE_CHARS',
                    warn
                ),
            },
            stubMode: parseStringUnionEnv<StubAdapterMode>(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_STUB_ADAPTER_MODE,
                'success',
                'EXECUTION_CONTRACT_TRUSTGRAPH_STUB_ADAPTER_MODE',
                STUB_ADAPTER_MODES,
                warn
            ),
        },
        ownership: (() => {
            const bindingMode = parseStringUnionEnv<OwnershipBindingMode>(
                env.EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_BINDING_MODE,
                'none',
                'EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_BINDING_MODE',
                OWNERSHIP_BINDING_MODES,
                warn
            );

            return {
                bindingMode,
                validatorId:
                    parseOptionalTrimmedString(
                        env.EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_VALIDATOR_ID
                    ) ??
                    (bindingMode === 'deployment'
                        ? 'backend_deployment_scope_v1'
                        : 'backend_tenancy_http_v1'),
                endpointUrl: parseOptionalTrimmedString(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_ENDPOINT_URL
                ),
                apiToken: parseOptionalTrimmedString(
                    env.EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_API_TOKEN
                ),
            };
        })(),
    };
};
