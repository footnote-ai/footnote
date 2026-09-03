/**
 * @description: Defines the shared runtime boundary that backend code uses for text and image generation.
 * This package keeps provider-specific request details behind one Footnote-owned interface so backend workflows can stay stable while adapters change underneath.
 * @footnote-scope: core
 * @footnote-module: AgentRuntimeBoundary
 * @footnote-risk: high - An incorrect runtime seam can leak framework assumptions or block later runtime migration work.
 * @footnote-ethics: high - This boundary protects Footnote-owned provenance and review semantics from being swallowed by framework-specific code.
 */
import type { JSONSchema7 } from 'ai';
import type {
    ImageGenerationQuality as ContractImageGenerationQuality,
    ImageGenerationSize as ContractImageGenerationSize,
    ModelProfileCapabilities,
    ModelProfileProviderRouting,
    PresentationGenerationSettings,
    SupportedImageOutputFormat,
    SupportedOpenAIImageModel,
    SupportedOpenAITextModel,
    SupportedProvider,
    SupportedReasoningEffort,
} from '@footnote/contracts';
import type { ToolExecutionContext } from '@footnote/contracts/policy';
import type { GenerationCompletion } from '@footnote/contracts/policy';
import type {
    InternalTtsCosts,
    InternalTtsOptions,
    InternalTtsUsage,
    InternalVoiceOutputFormat,
    InternalVoiceRealtimeClientEvent,
    InternalVoiceRealtimeOptions,
    InternalVoiceRealtimeServerEvent,
} from '@footnote/contracts/voice';

/**
 * Runtime-facing role labels for one normalized generation transcript.
 */
export type RuntimeMessageRole = 'system' | 'user' | 'assistant';

/**
 * Shared reasoning effort levels that runtime adapters may support.
 */
export type GenerationReasoningEffort = SupportedReasoningEffort;

/**
 * Reasoning efforts currently supported by image-prompt Responses requests.
 */
export type ImagePromptReasoningEffort = Extract<
    GenerationReasoningEffort,
    'low'
>;

/**
 * Shared verbosity levels that runtime adapters may support.
 */
export type GenerationVerbosity = 'low' | 'medium' | 'high';

/**
 * Coarse retrieval breadth hints used across runtime adapters.
 */
export type GenerationSearchContextSize = 'low' | 'medium' | 'high';

/**
 * Search intent labels used by backend planning and runtime adapters.
 */
export type GenerationSearchIntent = 'repo_explainer' | 'current_facts';

/**
 * Normalized provenance labels that runtime adapters can surface.
 */
export type GenerationProvenance = 'Retrieved' | 'Inferred' | 'Speculative';

/**
 * One normalized message supplied to a generation runtime.
 *
 * The runtime boundary stays text-only for now because backend Reflect is the
 * first consumer, but the naming is general enough for future callers.
 */
export interface RuntimeMessage {
    /**
     * Message role in the generation transcript.
     */
    role: RuntimeMessageRole;
    /**
     * Plain text content to pass to the runtime.
     */
    content: string;
}

/**
 * Retrieval settings a runtime may use when search is enabled.
 *
 * Public API contracts still belong to backend and shared package boundaries.
 * This shape only describes what the runtime should attempt.
 */
export interface GenerationSearchRequest {
    /**
     * Concise search query chosen by backend planning logic.
     */
    query: string;
    /**
     * Coarse retrieval breadth hint supplied by backend planning logic.
     */
    contextSize: GenerationSearchContextSize;
    /**
     * Search mode requested by backend planning logic.
     */
    intent: GenerationSearchIntent;
    /**
     * Optional focus tags that can help repo- or domain-specific retrieval.
     */
    repoHints?: string[];
    /**
     * Optional bounded free-form hints used as advisory ranking signals.
     * Runtime adapters should treat unknown hints as non-fatal and ignore them.
     */
    topicHints?: string[];
}

/**
 * @description: Serializable schema constraint for one structured generation result.
 * Runtime adapters map it to a provider-native response format, while backend owns when it is used.
 * @footnote-scope: core
 * @footnote-module: AgentRuntimeBoundary
 * @footnote-risk: medium - An invalid structured-output mapping can make a provider response unusable.
 * @footnote-ethics: medium - Backend ownership prevents provider adapters from deciding Footnote review semantics.
 */
export interface GenerationStructuredOutput {
    schema: JSONSchema7;
    name?: string;
    description?: string;
}

/**
 * Backend-to-runtime input for one generation attempt.
 *
 * The request only carries generation concerns. Planner state, auth,
 * rate-limiting, trace persistence, and incident/review behavior remain owned
 * by backend code outside this package.
 */
export interface GenerationRequest {
    /**
     * Normalized text conversation to hand to the runtime.
     */
    messages: RuntimeMessage[];
    /**
     * Preferred model identifier, when the caller wants to steer runtime
     * selection without coupling to one provider implementation.
     */
    model?: string;
    /**
     * Preferred provider identifier resolved by backend model routing.
     */
    provider?: SupportedProvider;
    /**
     * Runtime capability flags resolved from the active model profile.
     */
    capabilities?: ModelProfileCapabilities;
    /** Provider routing policy resolved from the selected backend profile. */
    providerRouting?: ModelProfileProviderRouting;
    /**
     * Optional max token/output budget hint for the runtime.
     */
    maxOutputTokens?: number;
    /** Optional provider-common sampling temperature. */
    temperature?: number;
    /** Optional provider-common nucleus sampling control. */
    topP?: number;
    /**
     * Requested reasoning effort level for the generation attempt.
     */
    reasoningEffort?: GenerationReasoningEffort;
    /**
     * Optional backend-derived pseudonymous identifier forwarded only to
     * providers that support abuse-monitoring identifiers. Raw caller IDs
     * must never cross this runtime boundary in this field.
     */
    safetyIdentifier?: string;
    /**
     * Requested verbosity level for the generation attempt.
     */
    verbosity?: GenerationVerbosity;
    /**
     * Optional provider-enforced schema constraint for structured output.
     */
    structuredOutput?: GenerationStructuredOutput;
    /**
     * Retrieval settings. Omit this field when search should stay disabled.
     */
    search?: GenerationSearchRequest;
    /**
     * Optional stable caller/user identifier reserved for future memory flows.
     */
    userId?: string;
    /**
     * Optional cancellation signal forwarded from backend orchestration.
     */
    signal?: AbortSignal;
}

/** Provider/account failure reasons that can safely suppress later automatic routes. */
export type ProviderTemporaryUnavailableReason =
    'billing_or_quota' | 'account_unavailable';

/** Narrow normalized runtime failure facts used by backend routing policy. */
export type GenerationRuntimeErrorDetails =
    | {
          classification: 'transient';
      }
    | {
          classification: 'provider_temporary_unavailable';
          availabilityReason: ProviderTemporaryUnavailableReason;
      };

/**
 * Error raised by a runtime adapter when its upstream error has a safe,
 * provider-neutral classification. Unknown adapter errors remain unchanged so
 * backend routing can preserve fail-open behavior without guessing.
 */
export class GenerationRuntimeError extends Error {
    readonly details: GenerationRuntimeErrorDetails;

    constructor(message: string, details: GenerationRuntimeErrorDetails) {
        super(message);
        this.name = 'GenerationRuntimeError';
        this.details = details;
    }
}

export const isGenerationRuntimeError = (
    error: unknown
): error is GenerationRuntimeError => error instanceof GenerationRuntimeError;

/**
 * One normalized citation surfaced by a runtime adapter.
 *
 * Backend code can use these facts when deriving Footnote-owned provenance
 * metadata later, but the runtime package does not own the public metadata
 * contract itself.
 */
export interface GenerationCitation {
    /**
     * Human-readable citation label or source title.
     */
    title: string;
    /**
     * Canonical URL for the cited source.
     */
    url: string;
    /**
     * Optional source excerpt, when the runtime exposes one safely.
     */
    snippet?: string;
}

/**
 * Normalized token accounting returned by a runtime adapter.
 */
export interface GenerationUsage {
    /**
     * Input or prompt token count, when the runtime exposes it.
     */
    promptTokens?: number;
    /**
     * Input tokens read from the provider prompt cache, when reported.
     */
    cachedInputTokens?: number;
    /**
     * Input tokens written to the provider prompt cache, when reported.
     */
    cacheWriteTokens?: number;
    /**
     * Output or completion token count, when the runtime exposes it.
     */
    completionTokens?: number;
    /** Hidden reasoning tokens included in provider output accounting, when reported. */
    reasoningTokens?: number;
    /**
     * Total token count, when the runtime exposes it.
     */
    totalTokens?: number;
}

/**
 * Retrieval facts surfaced by a runtime adapter.
 */
export interface GenerationRetrieval {
    /**
     * Whether backend asked the runtime to attempt retrieval.
     */
    requested: boolean;
    /**
     * Whether the runtime actually used retrieval during execution.
     */
    used: boolean;
}

/**
 * Runtime-to-backend result for one generation attempt.
 *
 * The result stays deliberately narrow. It returns normalized output text plus
 * the facts backend needs for metadata assembly, cost accounting, and runtime
 * diagnostics.
 */
export interface GenerationResult {
    /**
     * Final user-visible text generated by the runtime.
     */
    text: string;
    /**
     * Model identifier actually used by the runtime, when known.
     */
    model?: string;
    /**
     * Safe, upstream-reported execution facts. These are attribution signals,
     * not independently verified Footnote facts, and never include text.
     */
    upstreamAttribution?: {
        resolvedModel?: string;
        inferenceProvider?: string;
        routingAttempt?: number;
        routingAttemptCount?: number;
        upstreamReportedCostUsd?: number;
    };
    /** Provider-reported presentation controls, when the adapter exposes them verbatim. */
    providerObservedSettings?: PresentationGenerationSettings;
    /**
     * Optional provider/runtime finish reason for debugging or metadata
     * assembly.
     */
    finishReason?: string;
    /** Safe completion facts; never includes hidden reasoning content. */
    completion?: GenerationCompletion;
    /**
     * Normalized token usage facts, when the runtime exposes them.
     */
    usage?: GenerationUsage;
    /**
     * Optional citations surfaced by the runtime.
     */
    citations?: GenerationCitation[];
    /**
     * Retrieval request and execution facts for this attempt.
     */
    retrieval?: GenerationRetrieval;
    /**
     * Runtime-reported provenance classification, when available.
     */
    provenance?: GenerationProvenance;
    /**
     * Optional canonical tool execution outcome reported by the runtime.
     * Backend orchestration can still override this when policy requires
     * deterministic fail-open semantics.
     */
    toolExecution?: ToolExecutionContext;
    /**
     * Placeholder memory retrieval payload reserved for future memory features.
     * Current flows should leave this undefined.
     */
    memoryRetrievals?: [];
}

/**
 * Replaceable runtime implementation for text generation.
 *
 * Future adapters such as a legacy adapter or VoltAgent adapter should satisfy
 * this interface so backend code can depend on one stable seam.
 */
export interface GenerationRuntime {
    /**
     * Stable runtime identifier used for wiring and diagnostics.
     */
    readonly kind: string;
    /**
     * Run one text-only generation request.
     */
    generate(request: GenerationRequest): Promise<GenerationResult>;
}

/**
 * Output formats supported by the shared image runtime seam.
 */
export type ImageOutputFormat = SupportedImageOutputFormat;

/**
 * Quality levels supported by the shared image runtime seam.
 */
export type ImageGenerationQuality = ContractImageGenerationQuality;

/**
 * Canvas sizes supported by the shared image runtime seam.
 */
export type ImageGenerationSize = ContractImageGenerationSize;

/**
 * Background treatments supported by the shared image runtime seam.
 */
export type ImageGenerationBackground = 'auto' | 'transparent' | 'opaque';

/**
 * One partial image preview emitted during streamed image generation.
 */
export interface ImageGenerationPartialImage {
    index: number;
    base64: string;
}

/**
 * Runtime-facing prompt bundle for one image generation request.
 */
export interface ImageGenerationRequest {
    prompt: string;
    systemPrompt: string;
    developerPrompt: string;
    textModel: SupportedOpenAITextModel;
    /**
     * Backend-selected effort for the image-prompt Responses request. This is
     * deliberately separate from Workflow reasoning configuration.
     */
    reasoningEffort?: ImagePromptReasoningEffort;
    imageModel: SupportedOpenAIImageModel;
    quality: ImageGenerationQuality;
    size: ImageGenerationSize;
    background: ImageGenerationBackground;
    style: string;
    allowPromptAdjustment: boolean;
    outputFormat: ImageOutputFormat;
    outputCompression: number;
    followUpResponseId?: string;
    signal?: AbortSignal;
    stream?: boolean;
    onPartialImage?: (
        payload: ImageGenerationPartialImage
    ) => Promise<void> | void;
}

/**
 * Normalized annotation bundle returned by an image runtime adapter.
 */
export interface ImageGenerationAnnotations {
    title: string | null;
    description: string | null;
    note: string | null;
    adjustedPrompt?: string | null;
}

/**
 * Normalized usage facts returned by an image runtime adapter.
 */
export interface ImageGenerationUsage {
    inputTokens: number;
    /** Input tokens read from the provider cache, when the provider reports them. */
    cachedInputTokens?: number;
    /** Input tokens written to the provider cache, when the provider reports them. */
    cacheWriteTokens?: number;
    outputTokens: number;
    totalTokens: number;
    imageCount: number;
    /** Preview images emitted before the final render, which are billed separately. */
    partialImageCount: number;
    /** Whether the provider supplied a usage payload for this request. */
    providerUsageAvailable?: boolean;
}

/**
 * Normalized cost facts returned by an image runtime adapter.
 */
export interface ImageGenerationCosts {
    text: number;
    image: number;
    total: number;
    perImage: number;
}

/**
 * Runtime-to-backend result for one image generation attempt.
 */
export interface ImageGenerationResult {
    responseId: string | null;
    textModel: SupportedOpenAITextModel;
    /** Effective backend-owned reasoning effort for the prompt request. */
    reasoningEffort?: ImagePromptReasoningEffort;
    imageModel: SupportedOpenAIImageModel;
    revisedPrompt: string | null;
    finalStyle: string;
    annotations: ImageGenerationAnnotations;
    finalImageBase64: string;
    outputFormat: ImageOutputFormat;
    outputCompression: number;
    usage: ImageGenerationUsage;
    costs: ImageGenerationCosts;
    generationTimeMs: number;
}

/**
 * Replaceable runtime implementation for image generation.
 */
export interface ImageGenerationRuntime {
    readonly kind: string;
    generateImage(
        request: ImageGenerationRequest
    ): Promise<ImageGenerationResult>;
}

/**
 * Backend-to-runtime input for one text-to-speech request.
 */
export interface TextToSpeechRequest {
    text: string;
    options: InternalTtsOptions;
    outputFormat: InternalVoiceOutputFormat;
    signal?: AbortSignal;
}

/**
 * Runtime-to-backend result for one text-to-speech request.
 */
export interface TextToSpeechResult {
    audioBase64: string;
    outputFormat: InternalVoiceOutputFormat;
    mimeType: string;
    model: InternalTtsOptions['model'];
    voice: InternalTtsOptions['voice'];
    usage: InternalTtsUsage;
    costs: InternalTtsCosts;
    generationTimeMs: number;
}

/**
 * Replaceable runtime implementation for text-to-speech.
 */
export interface TextToSpeechRuntime {
    readonly kind: string;
    synthesize(request: TextToSpeechRequest): Promise<TextToSpeechResult>;
}

/**
 * Client events accepted by a live realtime voice session.
 */
export type RealtimeVoiceClientCommand = Exclude<
    InternalVoiceRealtimeClientEvent,
    { type: 'session.start' }
>;

/**
 * Live realtime session instance returned by voice runtime adapters.
 */
export interface RealtimeVoiceSession {
    send(event: RealtimeVoiceClientCommand): Promise<void>;
    onEvent(listener: (event: InternalVoiceRealtimeServerEvent) => void): void;
    close(reason?: string): void;
}

/**
 * Backend-to-runtime input for one realtime voice session.
 */
export interface RealtimeVoiceSessionRequest {
    instructions: string;
    options?: InternalVoiceRealtimeOptions;
    signal?: AbortSignal;
}

/**
 * Replaceable runtime implementation for realtime voice sessions.
 */
export interface RealtimeVoiceRuntime {
    readonly kind: string;
    createSession(
        request: RealtimeVoiceSessionRequest
    ): Promise<RealtimeVoiceSession>;
}

export {
    extractMarkdownLinkCitations,
    normalizeRecoveredCitationTitle,
    type RuntimeCitation,
} from './citationRecovery.js';

import {
    createVoltAgentRuntime,
    type CreateVoltAgentRuntimeOptions,
} from './voltagentRuntime.js';

/**
 * Explicit construction options for the shared runtime factory.
 *
 * The factory is intentionally strict so callers have to provide the
 * dependencies each runtime needs instead of relying on hidden defaults.
 */
export type CreateGenerationRuntimeOptions = {
    kind: 'voltagent';
} & Pick<CreateVoltAgentRuntimeOptions, 'defaultModel' | 'createExecutor'>;

/**
 * Creates one configured generation runtime implementation.
 */
export function createGenerationRuntime(
    options: CreateGenerationRuntimeOptions
): GenerationRuntime {
    return createVoltAgentRuntime({
        defaultModel: options.defaultModel,
        createExecutor: options.createExecutor,
    });
}

/**
 * Backend-to-runtime input for one embedding request.
 *
 * Provider and model are explicit because embedding runs are independently
 * configured and must not implicitly inherit the chat provider.
 */
export interface EmbeddingRequest {
    /** Text chunks to embed. At least one item is required. */
    texts: string[];
    /** Embedding model identifier. */
    model: string;
    /** Embedding provider identifier. */
    provider: string;
    /** Optional caller-provided cancellation signal. */
    signal?: AbortSignal;
}

/**
 * Runtime-to-backend result for one embedding request.
 *
 * This is deliberately an observable union, never a silent `[]`. The embedding
 * runtime does not own fail-open behavior; the project-context integration
 * decides continuation when an error result is observed.
 */
export type EmbeddingRuntimeResult =
    | {
          status: 'success';
          embeddings: number[][];
          model: string;
          provider: string;
          texts: string[];
          /** Provider-reported input tokens when the embedding API returns them. */
          promptTokens?: number;
          /** Provider-reported total tokens when the embedding API returns them. */
          totalTokens?: number;
          generationTimeMs: number;
      }
    | {
          status: 'error';
          reason: string;
          model?: string;
          provider?: string;
      };

/**
 * Replaceable runtime implementation for text embeddings.
 */
export interface EmbeddingRuntime {
    readonly kind: string;
    embed(request: EmbeddingRequest): Promise<EmbeddingRuntimeResult>;
}

export {
    createOpenAiImageRuntime,
    type CreateOpenAiImageRuntimeOptions,
    type OpenAiImageRuntimeLogger,
    type OpenAiImageRuntimeResponseClient,
    type OpenAiImageRuntimeResponseStream,
} from './openAiImageRuntime.js';
export {
    createOpenAiTtsRuntime,
    type CreateOpenAiTtsRuntimeOptions,
    type OpenAiTtsRuntimeLogger,
} from './openAiTtsRuntime.js';
export {
    createOpenAiEmbeddingRuntime,
    type CreateOpenAiEmbeddingRuntimeOptions,
    type OpenAiEmbeddingRuntimeClient,
    type OpenAiEmbeddingRuntimeLogger,
} from './openAiEmbeddingRuntime.js';
export {
    createOpenAiRealtimeVoiceRuntime,
    type CreateOpenAiRealtimeVoiceRuntimeOptions,
    type OpenAiRealtimeRuntimeLogger,
} from './openAiRealtimeVoiceRuntime.js';
export {
    createVoltAgentRuntime,
    type CreateVoltAgentRuntimeOptions,
    type VoltAgentExecutorFactory,
    type VoltAgentGenerateTextOptions,
    type VoltAgentLogger,
    type VoltAgentProviderOptions,
    type ProviderToolFactory,
    type ProviderToolRegistry,
    type VoltAgentResponseMetadata,
    type VoltAgentTextExecutor,
    type VoltAgentTextResult,
    type VoltAgentUsage,
    getToolForProvider,
    hasToolForProvider,
    providerToolRegistry,
} from './voltagentRuntime.js';
