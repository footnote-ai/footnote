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

/**
 * Resolves explicit runtime policy and connection settings for advisory
 * TrustGraph integration.
 */
export const buildExecutionContractTrustGraphSection = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): RuntimeConfig['executionContractTrustGraph'] => ({
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
        800,
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
        flow: parseOptionalTrimmedString(
            env.EXECUTION_CONTRACT_TRUSTGRAPH_FLOW
        ),
        collection: parseOptionalTrimmedString(
            env.EXECUTION_CONTRACT_TRUSTGRAPH_COLLECTION
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
});
