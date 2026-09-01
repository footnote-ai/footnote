/**
 * @description: Builds trusted backend service auth and request-body limit settings.
 * @footnote-scope: utility
 * @footnote-module: BackendServiceSections
 * @footnote-risk: medium - Wrong tokens or size limits can break internal service traffic or trace writes.
 * @footnote-ethics: medium - These settings affect trusted request handling and observability reliability.
 */

import { envDefaultValues } from '@footnote/config-spec';
import type { WorkflowModeId } from '@footnote/contracts/policy';
import {
    parseBooleanEnv,
    parseCsvEnv,
    parseNonNegativeIntEnv,
    parseOptionalTrimmedString,
    parsePositiveIntEnv,
    parseStringUnionEnv,
} from '../parsers.js';
import type { RuntimeConfig, WarningSink } from '../types.js';

const CHAT_WORKFLOW_MODE_IDS: ReadonlySet<WorkflowModeId> = new Set([
    'express',
    'balanced',
    'grounded',
]);
const REVERSE_IMAGE_SEARCH_PROVIDER_MODES = new Set([
    'none',
    'serpapi',
] as const);
type ReverseImageSearchProviderMode = 'none' | 'serpapi';
type WebSearchProviderMode = 'searxng' | 'brave' | 'serpapi';
const WEB_SEARCH_PROVIDER_MODES: ReadonlySet<WebSearchProviderMode> = new Set([
    'searxng',
    'brave',
    'serpapi',
]);
const PROJECT_DOCS_EMBEDDING_PROVIDERS: ReadonlySet<string> = new Set([
    'openai',
    'openrouter',
]);
const PROJECT_DOCS_MAX_CHUNK_BYTES = 32 * 1024;
const PROJECT_DOCS_MAX_CHUNKS = 5_000;
const PROJECT_DOCS_MAX_TOP_K_PER_CATEGORY = 50;
const PROJECT_DOCS_MAX_MATCHES = 20;
const PROJECT_DOCS_MAX_TIMEOUT_MS = 30_000;
const CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE_MAXIMUM = 128_000;

const parseOptionalWorkflowTokenOverride = (
    value: string | undefined,
    warn: WarningSink
): number | undefined => {
    if (value === undefined || value.trim().length === 0) return undefined;

    const parsed = Number(value.trim());
    if (
        Number.isFinite(parsed) &&
        Number.isInteger(parsed) &&
        parsed > 0 &&
        parsed <= CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE_MAXIMUM
    ) {
        return parsed;
    }

    warn(
        `Ignoring invalid CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: "${value}". Use a positive integer no greater than ${CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE_MAXIMUM}.`
    );
    return undefined;
};

const parseProjectDocsLimit = (
    raw: string | undefined,
    fallback: number,
    key: string,
    maximum: number,
    warn: WarningSink
): number => {
    const parsed = parsePositiveIntEnv(raw, fallback, key, warn);
    if (parsed <= maximum) return parsed;
    warn(`${key} exceeds the project-context safety cap; using ${maximum}.`);
    return maximum;
};

const parseProjectDocsScore = (
    raw: string | undefined,
    fallback: number,
    key: string,
    warn: WarningSink
): number => {
    if (raw === undefined) return fallback;
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= -1 && parsed <= 1) {
        return parsed;
    }
    warn(
        `Ignoring invalid similarity score for ${key}: "${raw}". Using default (${fallback}).`
    );
    return fallback;
};

const parseWebSearchProviderPriority = (
    raw: string | undefined,
    warn: WarningSink
): WebSearchProviderMode[] => {
    const fallback: WebSearchProviderMode[] = ['searxng', 'brave', 'serpapi'];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return fallback;
    }

    const normalized = raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0);
    if (normalized.length === 0) {
        return fallback;
    }

    const priority: WebSearchProviderMode[] = [];
    for (const candidate of normalized) {
        if (
            !WEB_SEARCH_PROVIDER_MODES.has(candidate as WebSearchProviderMode)
        ) {
            warn(
                `Ignoring unsupported web-search provider "${candidate}" in CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY.`
            );
            continue;
        }
        const provider = candidate as WebSearchProviderMode;
        if (!priority.includes(provider)) {
            priority.push(provider);
        }
    }

    if (priority.length === 0) {
        return fallback;
    }
    return priority;
};

/**
 * Resolves auth tokens and body-size limits for trusted backend-only service
 * endpoints.
 */
export const buildServiceSections = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): Pick<
    RuntimeConfig,
    | 'reflect'
    | 'adminSettings'
    | 'trace'
    | 'langfuseMetadataMirror'
    | 'chatWorkflow'
> => ({
    reflect: {
        serviceToken: parseOptionalTrimmedString(env.REFLECT_SERVICE_TOKEN),
        maxBodyBytes: parsePositiveIntEnv(
            env.REFLECT_API_MAX_BODY_BYTES,
            envDefaultValues.REFLECT_API_MAX_BODY_BYTES,
            'REFLECT_API_MAX_BODY_BYTES',
            warn
        ),
    },
    adminSettings: {
        token: parseOptionalTrimmedString(env.SETTINGS_ADMIN_TOKEN),
        maxBodyBytes: parsePositiveIntEnv(
            env.SETTINGS_ADMIN_MAX_BODY_BYTES,
            envDefaultValues.SETTINGS_ADMIN_MAX_BODY_BYTES,
            'SETTINGS_ADMIN_MAX_BODY_BYTES',
            warn
        ),
    },
    trace: {
        apiToken: parseOptionalTrimmedString(env.TRACE_API_TOKEN),
        maxBodyBytes: parsePositiveIntEnv(
            env.TRACE_API_MAX_BODY_BYTES,
            envDefaultValues.TRACE_API_MAX_BODY_BYTES,
            'TRACE_API_MAX_BODY_BYTES',
            warn
        ),
    },
    langfuseMetadataMirror: {
        enabled: parseBooleanEnv(
            env.LANGFUSE_METADATA_MIRROR_ENABLED,
            envDefaultValues.LANGFUSE_METADATA_MIRROR_ENABLED,
            'LANGFUSE_METADATA_MIRROR_ENABLED',
            warn
        ),
        baseUrl: parseOptionalTrimmedString(
            env.LANGFUSE_METADATA_MIRROR_BASE_URL
        ),
        publicKey: parseOptionalTrimmedString(
            env.LANGFUSE_METADATA_MIRROR_PUBLIC_KEY
        ),
        secretKey: parseOptionalTrimmedString(
            env.LANGFUSE_METADATA_MIRROR_SECRET_KEY
        ),
        timeoutMs: parsePositiveIntEnv(
            env.LANGFUSE_METADATA_MIRROR_TIMEOUT_MS,
            envDefaultValues.LANGFUSE_METADATA_MIRROR_TIMEOUT_MS,
            'LANGFUSE_METADATA_MIRROR_TIMEOUT_MS',
            warn
        ),
    },
    chatWorkflow: {
        modeId: parseStringUnionEnv<WorkflowModeId>(
            env.CHAT_WORKFLOW_MODE_ID,
            'balanced',
            'CHAT_WORKFLOW_MODE_ID',
            CHAT_WORKFLOW_MODE_IDS,
            warn
        ),
        reviewLoopEnabled: parseBooleanEnv(
            env.CHAT_REVIEW_LOOP_ENABLED,
            false,
            'CHAT_REVIEW_LOOP_ENABLED',
            warn
        ),
        maxIterations: parseNonNegativeIntEnv(
            env.CHAT_REVIEW_LOOP_MAX_ITERATIONS,
            2,
            'CHAT_REVIEW_LOOP_MAX_ITERATIONS',
            warn
        ),
        maxDurationMs: parsePositiveIntEnv(
            env.CHAT_REVIEW_LOOP_MAX_DURATION_MS,
            15000,
            'CHAT_REVIEW_LOOP_MAX_DURATION_MS',
            warn
        ),
        maxRequestReviewCycles: parseNonNegativeIntEnv(
            env.CHAT_MAX_REQUEST_REVIEW_CYCLES,
            7,
            'CHAT_MAX_REQUEST_REVIEW_CYCLES',
            warn
        ),
        maxTokensTotalOverride: parseOptionalWorkflowTokenOverride(
            env.CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE,
            warn
        ),
        presentation: {
            enabled: parseBooleanEnv(
                env.CHAT_PRESENTATION_ENABLED,
                false,
                'CHAT_PRESENTATION_ENABLED',
                warn
            ),
            profileId:
                parseOptionalTrimmedString(env.CHAT_PRESENTATION_PROFILE_ID) ??
                envDefaultValues.CHAT_PRESENTATION_PROFILE_ID,
            timeoutMs: parsePositiveIntEnv(
                env.CHAT_PRESENTATION_TIMEOUT_MS,
                envDefaultValues.CHAT_PRESENTATION_TIMEOUT_MS,
                'CHAT_PRESENTATION_TIMEOUT_MS',
                warn
            ),
        },
        contextIntegrations: {
            webSearch: {
                enabled: parseBooleanEnv(
                    env.CHAT_CONTEXT_WEB_SEARCH_ENABLED,
                    true,
                    'CHAT_CONTEXT_WEB_SEARCH_ENABLED',
                    warn
                ),
                providerPriority: parseWebSearchProviderPriority(
                    env.CHAT_CONTEXT_WEB_SEARCH_PROVIDER_PRIORITY,
                    warn
                ),
                searxngBaseUrl: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_WEB_SEARCH_SEARXNG_BASE_URL
                ),
                braveApiKey: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_WEB_SEARCH_BRAVE_API_KEY
                ),
                serpApiKey: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_WEB_SEARCH_SERPAPI_API_KEY
                ),
                serpApiEngine: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_WEB_SEARCH_SERPAPI_ENGINE
                ),
                serpApiGl: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_WEB_SEARCH_SERPAPI_GL
                ),
                serpApiHl: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_WEB_SEARCH_SERPAPI_HL
                ),
                providerTimeoutMs: parsePositiveIntEnv(
                    env.CHAT_CONTEXT_WEB_SEARCH_PROVIDER_TIMEOUT_MS,
                    12000,
                    'CHAT_CONTEXT_WEB_SEARCH_PROVIDER_TIMEOUT_MS',
                    warn
                ),
                maxResults: Math.max(
                    1,
                    parsePositiveIntEnv(
                        env.CHAT_CONTEXT_WEB_SEARCH_MAX_RESULTS,
                        6,
                        'CHAT_CONTEXT_WEB_SEARCH_MAX_RESULTS',
                        warn
                    )
                ),
                openAiNativeSearchFromHintsEnabled: parseBooleanEnv(
                    env.CHAT_CONTEXT_WEB_SEARCH_OPENAI_NATIVE_FROM_HINTS_ENABLED,
                    true,
                    'CHAT_CONTEXT_WEB_SEARCH_OPENAI_NATIVE_FROM_HINTS_ENABLED',
                    warn
                ),
            },
            github: {
                enabled: parseBooleanEnv(
                    env.CHAT_CONTEXT_GITHUB_ENABLED,
                    false,
                    'CHAT_CONTEXT_GITHUB_ENABLED',
                    warn
                ),
                token: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_GITHUB_TOKEN
                ),
                timeoutMs: Math.min(
                    5000,
                    parsePositiveIntEnv(
                        env.CHAT_CONTEXT_GITHUB_TIMEOUT_MS,
                        5000,
                        'CHAT_CONTEXT_GITHUB_TIMEOUT_MS',
                        warn
                    )
                ),
                maxRecordsPerSection: Math.min(
                    5,
                    parsePositiveIntEnv(
                        env.CHAT_CONTEXT_GITHUB_MAX_RECORDS_PER_SECTION,
                        5,
                        'CHAT_CONTEXT_GITHUB_MAX_RECORDS_PER_SECTION',
                        warn
                    )
                ),
                privateRepositoryAllowlist: parseCsvEnv(
                    env.CHAT_CONTEXT_GITHUB_PRIVATE_REPOSITORY_ALLOWLIST,
                    []
                ).map((slug) => slug.toLowerCase()),
                cacheTtlMs: parsePositiveIntEnv(
                    env.CHAT_CONTEXT_GITHUB_CACHE_TTL_MS,
                    60000,
                    'CHAT_CONTEXT_GITHUB_CACHE_TTL_MS',
                    warn
                ),
                staleResultLimitMs: parsePositiveIntEnv(
                    env.CHAT_CONTEXT_GITHUB_STALE_RESULT_LIMIT_MS,
                    900000,
                    'CHAT_CONTEXT_GITHUB_STALE_RESULT_LIMIT_MS',
                    warn
                ),
            },
            reverseImageSearch: {
                enabled: parseBooleanEnv(
                    env.CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_ENABLED,
                    true,
                    'CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_ENABLED',
                    warn
                ),
                autoRunWithImageAttachments: parseBooleanEnv(
                    env.CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_AUTORUN,
                    true,
                    'CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_AUTORUN',
                    warn
                ),
                maxMatchesPerImage: Math.max(
                    1,
                    parsePositiveIntEnv(
                        env.CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_MAX_MATCHES_PER_IMAGE,
                        2,
                        'CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_MAX_MATCHES_PER_IMAGE',
                        warn
                    )
                ),
                provider: parseStringUnionEnv<ReverseImageSearchProviderMode>(
                    env.CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_PROVIDER,
                    'none',
                    'CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_PROVIDER',
                    REVERSE_IMAGE_SEARCH_PROVIDER_MODES,
                    warn
                ),
                serpApiKey: parseOptionalTrimmedString(
                    env.CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_SERPAPI_API_KEY
                ),
                providerTimeoutMs: parsePositiveIntEnv(
                    env.CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_PROVIDER_TIMEOUT_MS,
                    12000,
                    'CHAT_CONTEXT_REVERSE_IMAGE_SEARCH_PROVIDER_TIMEOUT_MS',
                    warn
                ),
            },
            projectDocs: {
                enabled: parseBooleanEnv(
                    env.CHAT_CONTEXT_PROJECT_DOCS_ENABLED,
                    false,
                    'CHAT_CONTEXT_PROJECT_DOCS_ENABLED',
                    warn
                ),
                embeddingProvider: parseStringUnionEnv(
                    env.CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER,
                    'openai' as const,
                    'CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER',
                    PROJECT_DOCS_EMBEDDING_PROVIDERS,
                    warn
                ),
                embeddingModel:
                    parseOptionalTrimmedString(
                        env.CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_MODEL
                    ) ?? 'text-embedding-3-small',
                maxChunkBytes: parseProjectDocsLimit(
                    env.CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES,
                    2000,
                    'CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES',
                    PROJECT_DOCS_MAX_CHUNK_BYTES,
                    warn
                ),
                maxChunks: parseProjectDocsLimit(
                    env.CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS,
                    200,
                    'CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS',
                    PROJECT_DOCS_MAX_CHUNKS,
                    warn
                ),
                topKPerCategory: parseProjectDocsLimit(
                    env.CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY,
                    5,
                    'CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY',
                    PROJECT_DOCS_MAX_TOP_K_PER_CATEGORY,
                    warn
                ),
                maxMatches: parseProjectDocsLimit(
                    env.CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES,
                    6,
                    'CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES',
                    PROJECT_DOCS_MAX_MATCHES,
                    warn
                ),
                minScore: parseProjectDocsScore(
                    env.CHAT_CONTEXT_PROJECT_DOCS_MIN_SCORE,
                    0.35,
                    'CHAT_CONTEXT_PROJECT_DOCS_MIN_SCORE',
                    warn
                ),
                embeddingTimeoutMs: parseProjectDocsLimit(
                    env.CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS,
                    8000,
                    'CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS',
                    PROJECT_DOCS_MAX_TIMEOUT_MS,
                    warn
                ),
            },
        },
    },
});
