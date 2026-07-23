/**
 * @description: Defines the backend config shapes returned by the startup config builders.
 * @footnote-scope: utility
 * @footnote-module: BackendRuntimeConfigTypes
 * @footnote-risk: medium - Wrong config typing can hide missing sections or invalid defaults.
 * @footnote-ethics: medium - These types shape safety-relevant runtime behavior.
 */

import type {
    ConfiguredProviderModel,
    SupportedLogLevel,
    SupportedNodeEnv,
    SupportedOpenAIRealtimeModel,
    SupportedOpenAITtsVoice,
    SupportedReasoningEffort,
    SupportedVerbosity,
} from '@footnote/contracts/providers';
import type { ModelProfile } from '@footnote/contracts';
import type { StepRoutingChainsConfig } from '@footnote/contracts';
import type { WorkflowModeId } from '@footnote/contracts/policy';
import type { BotProfileConfig } from './profile.js';

/**
 * Sink used by config builders to report ignored or risky env values without
 * throwing immediately.
 */
export type WarningSink = (message: string) => void;

/**
 * Shared shape for "limit per window" settings used by rate-limited endpoints.
 */
export type RateLimitConfig = {
    limit: number;
    windowMs: number;
};

/**
 * Canonical backend runtime config assembled from env parsing helpers.
 */
export type RuntimeConfig = {
    runtime: {
        nodeEnv: SupportedNodeEnv;
        isProduction: boolean;
        isDevelopment: boolean;
        flyAppName: string | null;
        promptConfigPath: string | null;
        projectRoot: string;
    };
    server: {
        dataDir: string;
        host: string;
        port: number;
        trustProxy: boolean;
    };
    accountAuth:
        | {
              enabled: false;
          }
        | {
              enabled: true;
              issuerUrl: string;
              clientId: string;
              clientSecret: string;
              redirectUri: string;
              secureCookies: boolean;
          };
    openai: {
        apiKey: string | null;
        safetyIdentifierSecret: string | null;
        defaultModel: ConfiguredProviderModel;
        plannerStructuredOutputEnabled: boolean;
        plannerAllowTextJsonCompatibilityFallback: boolean;
        defaultRealtimeModel: SupportedOpenAIRealtimeModel;
        defaultRealtimeVoice: SupportedOpenAITtsVoice;
        defaultReasoningEffort: SupportedReasoningEffort;
        defaultVerbosity: SupportedVerbosity;
        defaultChannelContext: { channelId: string };
        requestTimeoutMs: number;
    };
    ollama: {
        baseUrl: string | null;
        apiKey: string | null;
        localInferenceEnabled: boolean;
    };
    openrouter: {
        apiKey: string | null;
        baseUrl: string;
    };
    modelProfiles: {
        defaultProfileId: string;
        plannerProfileId: string;
        catalogPath: string;
        catalog: ModelProfile[];
        pools: Record<string, string[]>;
        stepRoutingChains: StepRoutingChainsConfig;
    };
    voltagent: {
        publicKey: string | null;
        secretKey: string | null;
        observabilityEnabled: boolean;
    };
    cors: {
        allowedOrigins: string[];
    };
    csp: {
        frameAncestors: string[];
    };
    reflect: {
        serviceToken: string | null;
        maxBodyBytes: number;
    };
    adminSettings: {
        token: string | null;
        maxBodyBytes: number;
    };
    trace: {
        apiToken: string | null;
        maxBodyBytes: number;
    };
    langfuseMetadataMirror: {
        enabled: boolean;
        baseUrl: string | null;
        publicKey: string | null;
        secretKey: string | null;
        timeoutMs: number;
    };
    chatWorkflow: {
        modeId: WorkflowModeId;
        reviewLoopEnabled: boolean;
        maxIterations: number;
        maxDurationMs: number;
        maxRequestReviewCycles: number;
        presentation: {
            /** Optional draft-first presentation flow after planning and context collection. */
            enabled: boolean;
            /** Deployment-owned model profile. Persona identity never selects this. */
            profileId: string | null;
            /** Separate deployment-owned profile for bounded presentation audits. */
            validatorProfileId: string | null;
            /** Hard timeout for one presentation-draft call. */
            timeoutMs: number;
            /** Hard timeout for the bounded audit when a presentation draft is finalized. */
            validatorTimeoutMs: number;
        };
        contextIntegrations: {
            /**
             * Web-search context integration controls for chat workflow execution.
             */
            webSearch: {
                /** Master enable/disable for web-search context integration. */
                enabled: boolean;
                /** Ordered provider priority used for deterministic fallback. */
                providerPriority: Array<'searxng' | 'brave' | 'serpapi'>;
                /** Optional SearXNG base URL (required when searxng is enabled). */
                searxngBaseUrl: string | null;
                /** Optional Brave API key (required when brave is enabled). */
                braveApiKey: string | null;
                /** Optional SerpAPI key (required when serpapi is enabled). */
                serpApiKey: string | null;
                /** Optional SerpAPI engine override (defaults to google). */
                serpApiEngine: string | null;
                /** Optional SerpAPI country code (gl). */
                serpApiGl: string | null;
                /** Optional SerpAPI language code (hl). */
                serpApiHl: string | null;
                /** Timeout budget for each web-search provider attempt. */
                providerTimeoutMs: number;
                /** Max normalized results retained from provider responses. */
                maxResults: number;
                /**
                 * Optional OpenAI-native follow-up search execution from
                 * context-step `searchHints`. Enabled by default.
                 */
                openAiNativeSearchFromHintsEnabled: boolean;
            };
            /** Backend-owned read-only GitHub repository context controls. */
            github: {
                enabled: boolean;
                /** Read-only credential; never exposed in metadata or prompts. */
                token: string | null;
                timeoutMs: number;
                maxRecordsPerSection: number;
                privateRepositoryAllowlist: string[];
                cacheTtlMs: number;
                staleResultLimitMs: number;
            };
            /**
             * Backend-owned project-document context controls.
             *
             * Embedding provider and model are independently configured and must
             * not implicitly inherit the chat provider.
             */
            projectDocs: {
                enabled: boolean;
                embeddingProvider: string;
                embeddingModel: string;
                maxChunkBytes: number;
                maxChunks: number;
                topKPerCategory: number;
                maxMatches: number;
                minScore: number;
                embeddingTimeoutMs: number;
            };
            /**
             * Reverse-image context integration controls for chat workflow execution.
             */
            reverseImageSearch: {
                /** Enables or disables reverse-image context integration entirely. */
                enabled: boolean;
                /**
                 * When true, auto-runs reverse-image context step for requests with
                 * image attachments unless planner explicitly disables it.
                 */
                autoRunWithImageAttachments: boolean;
                /** Positive integer cap for matches surfaced per image attachment. */
                maxMatchesPerImage: number;
                /** Provider mode for reverse-image lookup execution. */
                provider: 'none' | 'serpapi';
                /** Optional SerpAPI key when provider mode is serpapi. */
                serpApiKey: string | null;
                /** Timeout budget for reverse-image provider requests. */
                providerTimeoutMs: number;
            };
        };
    };
    executionContractTrustGraph: {
        enabled: boolean;
        killSwitchExternalRetrieval: boolean;
        policyId: string;
        timeoutMs: number;
        maxCalls: number;
        adapter: {
            mode: 'none' | 'stub' | 'http';
            endpointUrl: string | null;
            apiToken: string | null;
            configRef: string | null;
            stubMode: 'success' | 'failure' | 'timeout' | 'poisoned';
        };
        ownership: {
            bindingMode: 'none' | 'http';
            validatorId: string;
            endpointUrl: string | null;
            apiToken: string | null;
        };
    };
    turnstile: {
        secretKey: string | null;
        siteKey: string | null;
        allowedHostnames: string[];
        enabled: boolean;
    };
    rateLimits: {
        web: {
            ip: RateLimitConfig;
            session: RateLimitConfig;
        };
        chatService: RateLimitConfig;
        traceApi: RateLimitConfig;
    };
    storage: {
        provenanceSqlitePath: string | null;
        incidentPseudonymizationSecret: string | null;
        incidentSqlitePath: string | null;
    };
    logging: {
        directory: string;
        level: SupportedLogLevel;
    };
    litestream: {
        replicaUrl: string | null;
        latestSnapshotAt: string | null;
    };
    alerts: {
        discord: {
            enabled: boolean;
            botToken: string | null;
            channelId: string | null;
            roleId: string | null;
        };
        email: {
            enabled: boolean;
            smtpHost: string | null;
            smtpPort: number;
            smtpSecure: boolean;
            smtpUsername: string | null;
            smtpPassword: string | null;
            from: string | null;
            to: string[];
        };
    };
    settings: {
        path: string;
        discordBots: Array<{
            id?: string;
            enabled?: boolean;
            required?: boolean;
            credentials?: {
                discordTokenEnv?: string;
                discordClientIdEnv?: string;
                discordGuildIdsEnv?: string;
                discordUserIdEnv?: string;
                incidentSecretEnv?: string;
            };
            profile?: {
                id?: string;
                displayName?: string;
                overlayPath?: string;
                mentionAliases?: string[];
            };
        }> | null;
    };
    profile: BotProfileConfig;
};
