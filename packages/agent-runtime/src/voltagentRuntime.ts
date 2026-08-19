/**
 * @description: VoltAgent-backed generation runtime used to prove the shared runtime seam can host a second implementation.
 * @footnote-scope: core
 * @footnote-module: VoltAgentRuntime
 * @footnote-risk: high - Incorrect request mapping here can silently change model selection, retrieval handling, or usage facts.
 * @footnote-ethics: high - This adapter must preserve Footnote's sourcing and transparency expectations even before VoltAgent becomes the active backend runtime.
 */
import {
    Agent,
    VoltOpsClient,
    type AgentOptions,
    type BaseMessage,
    type ProviderTool,
} from '@voltagent/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, Output } from 'ai';
import type {
    GenerationCitation,
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
    GenerationSearchRequest,
    GenerationStructuredOutput,
    GenerationUsage,
    RuntimeMessage,
} from './index.js';
import { extractMarkdownLinkCitations } from './citationRecovery.js';
import type { ModelProfileProviderRouting } from '@footnote/contracts';
import type { ToolExecutionContext } from '@footnote/contracts/policy';

type VoltAgentOpenAiProviderOptions = {
    reasoningEffort?: GenerationRequest['reasoningEffort'];
    textVerbosity?: 'low' | 'medium' | 'high';
    safetyIdentifier?: string;
};

/**
 * Provider-agnostic options accepted at the GenerationRuntime seam.
 *
 * The adapter can translate these into provider-specific payloads internally.
 */
export type VoltAgentProviderOptions = {
    reasoningEffort?: VoltAgentOpenAiProviderOptions['reasoningEffort'];
    verbosity?: VoltAgentOpenAiProviderOptions['textVerbosity'];
    searchContextSize?: GenerationSearchRequest['contextSize'];
    safetyIdentifier?: string;
    providerHints?: Record<string, unknown>;
};

type OpenRouterRouting = NonNullable<ModelProfileProviderRouting['openrouter']>;

type OpenRouterProviderPayload = {
    order?: string[];
    only?: string[];
    allow_fallbacks?: boolean;
    data_collection?: 'allow' | 'deny';
    zdr?: boolean;
};

/**
 * Narrow execution options the VoltAgent adapter passes into one text call.
 */
export interface VoltAgentGenerateTextOptions {
    maxOutputTokens?: number;
    providerOptions?: VoltAgentProviderOptions;
    search?: GenerationSearchRequest;
    structuredOutput?: GenerationStructuredOutput;
    signal?: AbortSignal;
}

/**
 * Narrow usage shape the VoltAgent adapter needs from one text call.
 */
export interface VoltAgentUsage {
    promptTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

/**
 * Narrow response metadata the VoltAgent adapter needs from one text call.
 */
export interface VoltAgentResponseMetadata {
    modelId?: string;
    body?: unknown;
}

/**
 * Narrow text result shape exposed by the VoltAgent executor wrapper.
 */
export interface VoltAgentSource {
    url: string;
    title?: string;
}

type VoltAgentProviderTool = ProviderTool & {
    type: 'provider';
    id: string;
    name: string;
    args?: Record<string, unknown>;
};

export interface VoltAgentTextResult {
    text: string;
    finishReason?: string;
    usage?: VoltAgentUsage;
    response?: VoltAgentResponseMetadata;
    sources?: VoltAgentSource[];
    providerMetadata?: unknown;
}

/**
 * Minimal logger contract VoltAgent accepts.
 *
 * The backend can provide its own logger implementation so VoltAgent logs can
 * be routed somewhere other than the main process console.
 */
export interface VoltAgentLogger {
    trace(message: string, context?: object): void;
    debug(message: string, context?: object): void;
    info(message: string, context?: object): void;
    warn(message: string, context?: object): void;
    error(message: string, context?: object): void;
    fatal(message: string, context?: object): void;
    child(bindings: Record<string, unknown>): VoltAgentLogger;
}

/**
 * Small executor contract that keeps the adapter testable without depending on
 * VoltAgent internals in unit tests.
 */
export interface VoltAgentTextExecutor {
    generateText(
        messages: RuntimeMessage[],
        options: VoltAgentGenerateTextOptions
    ): Promise<VoltAgentTextResult>;
}

/**
 * Factory used to create one VoltAgent executor for a chosen model.
 */
export type VoltAgentExecutorFactory = (input: {
    model: string;
    logger?: VoltAgentLogger;
    voltOpsClient?: VoltOpsClient;
    ollama?: VoltAgentExecutorOllamaConfig;
    openrouter?: VoltAgentExecutorOpenRouterConfig;
    openrouterRouting?: ModelProfileProviderRouting['openrouter'];
}) => VoltAgentTextExecutor;

export type VoltAgentExecutorOllamaConfig = {
    provider: 'ollama' | 'ollama-cloud';
    baseUrl?: string;
    apiKey?: string;
    localInferenceEnabled: boolean;
};

export type VoltAgentExecutorOpenRouterConfig = {
    apiKey: string;
    baseUrl: string;
};

type VoltAgentLike = Pick<Agent, 'generateText'>;

type CreateVoltAgentAgentFactoryInput = {
    model: NonNullable<AgentOptions['model']>;
    /**
     * Trusted system-level instructions derived from leading system-role
     * transcript messages. Backend-composed content only; never user input.
     */
    instructions?: string;
    tools?: NonNullable<AgentOptions['tools']>;
    logger?: VoltAgentLogger;
    voltOpsClient?: VoltOpsClient;
};

/**
 * Constructor input for the VoltAgent runtime implementation.
 */
export interface CreateVoltAgentRuntimeOptions {
    defaultModel?: string;
    createExecutor?: VoltAgentExecutorFactory;
    kind?: string;
    logger?: VoltAgentLogger;
    ollama?: {
        baseUrl?: string;
        apiKey?: string;
        localInferenceEnabled?: boolean;
    };
    openrouter?: {
        apiKey?: string;
        baseUrl?: string;
    };
    voltOps?: {
        publicKey: string;
        secretKey: string;
    };
}

type VoltAgentCallOptions = NonNullable<Parameters<Agent['generateText']>[1]>;

/**
 * Turns the shared runtime transcript into the simple message shape VoltAgent
 * accepts for text generation.
 */
const toVoltAgentMessages = (messages: RuntimeMessage[]): BaseMessage[] =>
    messages.map((message) => ({
        role: message.role,
        content: message.content,
    }));

/**
 * Splits a transcript into a trusted system prompt and the remaining
 * conversation. Only a contiguous run of leading system-role messages is
 * promoted to instructions; any system message that appears after user or
 * assistant content is left in place so generation never blocks and no
 * user-visible content is dropped.
 *
 * @returns Instructions built from leading system messages (joined with a blank
 * line), and the remaining transcript with those messages removed.
 */
const splitLeadingSystemMessages = (
    messages: RuntimeMessage[]
): { instructions: string | undefined; transcript: RuntimeMessage[] } => {
    const instructionParts: string[] = [];
    let index = 0;
    while (index < messages.length && messages[index]?.role === 'system') {
        const content = messages[index]?.content;
        if (content !== undefined && content.trim().length > 0) {
            instructionParts.push(content);
        }
        index += 1;
    }
    const instructions =
        instructionParts.length > 0 ? instructionParts.join('\n\n') : undefined;
    return {
        instructions,
        transcript: messages.slice(index),
    };
};

/**
 * VoltAgent's model router expects provider-prefixed model ids.
 */
const toVoltAgentModel = (model: string, provider?: string): string => {
    const normalizedProvider = provider?.trim().toLowerCase();
    if (normalizedProvider) {
        return model.startsWith(`${normalizedProvider}/`)
            ? model
            : `${normalizedProvider}/${model}`;
    }
    return model.includes('/') ? model : `openai/${model}`;
};

const inferProviderFromModelId = (model?: string): string | undefined => {
    if (!model) {
        return undefined;
    }

    const trimmed = model.trim();
    if (!trimmed.includes('/')) {
        return undefined;
    }

    const [providerPart] = trimmed.split('/', 1);
    const normalizedProvider = providerPart?.trim().toLowerCase();
    return normalizedProvider && normalizedProvider.length > 0
        ? normalizedProvider
        : undefined;
};

const isLocalOllamaHost = (hostname: string): boolean =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === 'host.docker.internal';

const normalizeOllamaCloudBaseUrl = (baseUrl: string): string | undefined => {
    try {
        const parsed = new URL(baseUrl);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        if (normalizedPath === '/api') {
            parsed.pathname = '/v1';
        } else if (!normalizedPath.endsWith('/v1')) {
            parsed.pathname = `${normalizedPath}/v1`.replace(/\/{2,}/g, '/');
        } else {
            parsed.pathname = normalizedPath;
        }
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return undefined;
    }
};

const resolveVoltAgentProviderOverride = ({
    provider,
    ollama,
}: {
    provider: GenerationRequest['provider'];
    ollama?: CreateVoltAgentRuntimeOptions['ollama'];
}): string | undefined => {
    if (provider !== 'ollama') {
        return provider;
    }

    const configuredBaseUrl = ollama?.baseUrl?.trim();
    if (!configuredBaseUrl) {
        return provider;
    }

    try {
        const hostname = new URL(configuredBaseUrl).hostname.toLowerCase();
        if (
            isLocalOllamaHost(hostname) &&
            ollama?.localInferenceEnabled !== true
        ) {
            return provider;
        }

        return isLocalOllamaHost(hostname) ? 'ollama' : 'ollama-cloud';
    } catch {
        return provider;
    }
};

const resolveExecutorOllamaConfig = (
    provider: string,
    ollama: CreateVoltAgentRuntimeOptions['ollama'] | undefined
): VoltAgentExecutorOllamaConfig | undefined => {
    if (provider !== 'ollama' && provider !== 'ollama-cloud') {
        return undefined;
    }

    const normalizedLocalInferenceEnabled =
        ollama?.localInferenceEnabled === true;
    const normalizedApiKey = ollama?.apiKey?.trim() || undefined;
    const configuredBaseUrl = ollama?.baseUrl?.trim();
    if (provider === 'ollama-cloud') {
        const normalizedCloudBaseUrl = configuredBaseUrl
            ? (normalizeOllamaCloudBaseUrl(configuredBaseUrl) ??
              configuredBaseUrl)
            : undefined;
        return {
            provider: 'ollama-cloud',
            baseUrl: normalizedCloudBaseUrl,
            apiKey: normalizedApiKey,
            localInferenceEnabled: normalizedLocalInferenceEnabled,
        };
    }

    return {
        provider: 'ollama',
        baseUrl: configuredBaseUrl,
        apiKey: normalizedApiKey,
        localInferenceEnabled: normalizedLocalInferenceEnabled,
    };
};

const getVoltAgentProvider = (model: string): string => {
    const slashIndex = model.indexOf('/');
    if (slashIndex === -1) {
        return 'openai';
    }

    return model.slice(0, slashIndex).toLowerCase();
};

/**
 * Factory signature for one provider-specific tool payload.
 * The runtime asks for a tool by name, then this function shapes the
 * provider-native tool object to send into VoltAgent.
 */
export type ProviderToolFactory = (search: GenerationSearchRequest) => {
    type: 'provider';
    id: string;
    name: string;
    args?: Record<string, unknown>;
};

/**
 * Registry of tool-name -> provider -> tool factory.
 * Example: web_search -> openai -> openai.web_search factory.
 */
export type ProviderToolRegistry = Record<
    string,
    Record<string, ProviderToolFactory>
>;

export type ProviderToolResolution =
    | {
          supported: true;
          factory: ProviderToolFactory;
      }
    | {
          supported: false;
          reason: 'tool_not_registered' | 'provider_not_registered';
      };

/**
 * Canonical runtime registry for provider tool mappings.
 * Keep this data-only so new tools/providers can be added without branching
 * logic across generation code paths.
 */
export const providerToolRegistry: ProviderToolRegistry = {
    // Provider-neutral registry entry for search forwarding. Providers without
    // a mapping simply do not receive search tools.
    web_search: {
        openai: (search) => ({
            type: 'provider',
            id: 'openai.web_search',
            name: 'web_search',
            args: {
                searchContextSize: search.contextSize,
            },
        }),
        'ollama-cloud': (search) => ({
            type: 'provider',
            id: 'ollama-cloud.web_search',
            name: 'web_search',
            args: {
                searchContextSize: search.contextSize,
            },
        }),
    },
};

/**
 * Resolves one provider/tool mapping and returns deterministic support status.
 */
export const resolveToolForProvider = (
    toolName: string,
    provider: string
): ProviderToolResolution => {
    const toolMappings = providerToolRegistry[toolName];
    if (!toolMappings) {
        return {
            supported: false,
            reason: 'tool_not_registered',
        };
    }

    const factory = toolMappings[provider];
    if (!factory) {
        return {
            supported: false,
            reason: 'provider_not_registered',
        };
    }

    return {
        supported: true,
        factory,
    };
};

/**
 * Returns the provider factory for a named tool when one is registered.
 */
export const getToolForProvider = (
    toolName: string,
    provider: string
): ProviderToolFactory | undefined => {
    const mapping = resolveToolForProvider(toolName, provider);
    return mapping.supported ? mapping.factory : undefined;
};

/**
 * Fast capability check used before constructing tool instructions.
 */
export const hasToolForProvider = (
    toolName: string,
    provider: string
): boolean => resolveToolForProvider(toolName, provider).supported;

type VoltAgentModelResolution = {
    selectedModel: string | undefined;
};

const normalizeConfiguredModel = (value?: string): string | undefined => {
    if (value === undefined) {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const resolveVoltAgentModelId = ({
    requestedModel,
    defaultModel,
}: {
    requestedModel?: string;
    defaultModel?: string;
}): VoltAgentModelResolution => {
    const normalizedDefaultModel = normalizeConfiguredModel(defaultModel);

    if (requestedModel) {
        const trimmedModel = requestedModel.trim();
        if (trimmedModel.length === 0) {
            return {
                selectedModel: normalizedDefaultModel,
            };
        }

        return {
            selectedModel: trimmedModel,
        };
    }

    return {
        selectedModel: normalizedDefaultModel,
    };
};

/**
 * Footnote still expects the plain model id in normalized runtime results.
 */
const toFootnoteModel = (model: string): string => {
    const slashIndex = model.indexOf('/');
    return slashIndex === -1 ? model : model.slice(slashIndex + 1);
};

/**
 * Builds the provider option bag for one VoltAgent text call.
 */
/** Converts the shared routing contract into OpenRouter's request payload. */
const toOpenRouterProviderPayload = (
    routing: OpenRouterRouting | undefined
): OpenRouterProviderPayload | undefined => {
    if (routing === undefined) return undefined;

    const payload: OpenRouterProviderPayload = {
        ...(routing.order !== undefined && { order: routing.order }),
        ...(routing.only !== undefined && { only: routing.only }),
        ...(routing.allowFallbacks !== undefined && {
            allow_fallbacks: routing.allowFallbacks,
        }),
        ...(routing.dataCollection !== undefined && {
            data_collection: routing.dataCollection,
        }),
        ...(routing.zdr !== undefined && { zdr: routing.zdr }),
    };

    return Object.keys(payload).length > 0 ? payload : undefined;
};

const buildVoltAgentProviderOptions = (
    request: GenerationRequest,
    provider: string
): VoltAgentProviderOptions | undefined => {
    if (provider === 'openrouter') {
        const routing = toOpenRouterProviderPayload(
            request.providerRouting?.openrouter
        );
        if (routing === undefined) {
            return undefined;
        }
        return {
            providerHints: {
                openrouter: {
                    provider: routing,
                },
            },
        };
    }
    if (provider === 'ollama') {
        return undefined;
    }
    if (provider !== 'openai') {
        return undefined;
    }

    const reasoningEffort = request.reasoningEffort;
    const verbosity = request.verbosity;
    const searchContextSize = request.search?.contextSize;
    const safetyIdentifier = request.safetyIdentifier;

    if (
        !reasoningEffort &&
        !verbosity &&
        !searchContextSize &&
        !safetyIdentifier
    ) {
        return undefined;
    }

    return {
        ...(reasoningEffort !== undefined && { reasoningEffort }),
        ...(verbosity !== undefined && { verbosity }),
        ...(searchContextSize !== undefined && { searchContextSize }),
        ...(safetyIdentifier !== undefined && { safetyIdentifier }),
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;

const finiteNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Keeps only stable, text-free OpenRouter routing and charging signals. The
 * router reports these facts; Footnote does not treat them as verification.
 */
const extractOpenRouterAttribution = (value: unknown) => {
    if (!isRecord(value)) {
        return undefined;
    }
    const openrouter = isRecord(value.openrouter) ? value.openrouter : value;
    const routing = isRecord(openrouter.routing) ? openrouter.routing : {};
    const selected = isRecord(routing.selected) ? routing.selected : {};
    const usage = isRecord(openrouter.usage) ? openrouter.usage : {};
    const attempts = Array.isArray(routing.attempts) ? routing.attempts : [];
    const resolvedModel =
        nonEmptyString(selected.model) ?? nonEmptyString(routing.model);
    const inferenceProvider =
        nonEmptyString(selected.provider) ?? nonEmptyString(routing.provider);
    const routingAttempt = finiteNumber(routing.attempt);
    const routingAttemptCount =
        attempts.length > 0 ? attempts.length : finiteNumber(routing.attempts);
    const upstreamReportedCostUsd = finiteNumber(usage.cost);
    const attribution = {
        ...(resolvedModel !== undefined && { resolvedModel }),
        ...(inferenceProvider !== undefined && { inferenceProvider }),
        ...(routingAttempt !== undefined && { routingAttempt }),
        ...(routingAttemptCount !== undefined && { routingAttemptCount }),
        ...(upstreamReportedCostUsd !== undefined && {
            upstreamReportedCostUsd,
        }),
    };
    return Object.values(attribution).some((item) => item !== undefined)
        ? attribution
        : undefined;
};

const openRouterMetadataExtractor = {
    async extractMetadata({ parsedBody }: { parsedBody: unknown }) {
        if (!isRecord(parsedBody)) {
            return undefined;
        }
        const routing = isRecord(parsedBody.openrouter_metadata)
            ? parsedBody.openrouter_metadata
            : undefined;
        const usage = isRecord(parsedBody.usage) ? parsedBody.usage : undefined;
        if (routing === undefined && usage === undefined) {
            return undefined;
        }
        const endpoints = isRecord(routing?.endpoints)
            ? routing.endpoints
            : undefined;
        const selectedEndpoint = Array.isArray(endpoints?.available)
            ? endpoints.available.find(
                  (endpoint): endpoint is Record<string, unknown> =>
                      isRecord(endpoint) && endpoint.selected === true
              )
            : undefined;
        const attempts = Array.isArray(routing?.attempts)
            ? routing.attempts.filter(
                  (attempt): attempt is Record<string, unknown> =>
                      isRecord(attempt)
              )
            : [];
        return {
            openrouter: {
                routing: {
                    ...(nonEmptyString(selectedEndpoint?.provider) !==
                        undefined && {
                        provider: nonEmptyString(selectedEndpoint?.provider),
                    }),
                    ...(nonEmptyString(selectedEndpoint?.model) !==
                        undefined && {
                        model: nonEmptyString(selectedEndpoint?.model),
                    }),
                    ...(finiteNumber(routing?.attempt) !== undefined && {
                        attempt: finiteNumber(routing?.attempt),
                    }),
                    ...(attempts.length > 0 && { attempts: attempts.length }),
                },
                ...(finiteNumber(usage?.cost) !== undefined && {
                    usage: { cost: finiteNumber(usage?.cost) },
                }),
            },
        };
    },
    createStreamExtractor() {
        return {
            processChunk(_chunk: unknown): void {
                // Non-streaming generation is used by Footnote today. Keep the
                // hook permissive until a streaming boundary consumes it.
            },
            buildMetadata() {
                return undefined;
            },
        };
    },
};

const toVoltAgentCallProviderOptions = (
    providerOptions: VoltAgentProviderOptions | undefined
): Record<string, unknown> | undefined => {
    if (!providerOptions) {
        return undefined;
    }

    const providerHints = isRecord(providerOptions.providerHints)
        ? { ...providerOptions.providerHints }
        : {};
    const openAiHints = isRecord(providerHints.openai)
        ? { ...providerHints.openai }
        : {};
    const openAiOptions: Record<string, unknown> = {
        ...openAiHints,
    };

    if (providerOptions.reasoningEffort !== undefined) {
        openAiOptions.reasoningEffort = providerOptions.reasoningEffort;
    }
    if (providerOptions.verbosity !== undefined) {
        openAiOptions.textVerbosity = providerOptions.verbosity;
    }
    if (providerOptions.safetyIdentifier !== undefined) {
        openAiOptions.safetyIdentifier = providerOptions.safetyIdentifier;
    }

    const normalizedProviderOptions: Record<string, unknown> = {
        ...providerHints,
    };
    if (Object.keys(openAiOptions).length > 0) {
        normalizedProviderOptions.openai = openAiOptions;
    }

    return Object.keys(normalizedProviderOptions).length > 0
        ? normalizedProviderOptions
        : undefined;
};

const buildRepoExplainerQuery = (search: GenerationSearchRequest): string => {
    const rawTerms = [
        'footnote-ai/footnote',
        'footnote-ai',
        'footnote',
        'DeepWiki',
        ...(search.repoHints ?? []),
        ...(search.topicHints ?? []),
        search.query.trim(),
    ];
    const seenTerms = new Set<string>();
    const dedupedTerms: string[] = [];

    for (const term of rawTerms) {
        const normalized = term.trim().toLowerCase();
        if (!normalized || seenTerms.has(normalized)) {
            continue;
        }

        seenTerms.add(normalized);
        dedupedTerms.push(term.trim());
    }

    return dedupedTerms.join(' ');
};

const buildVoltAgentSearchInstruction = (
    search: GenerationSearchRequest
): string => {
    if (search.intent === 'repo_explainer') {
        const repoQuery = buildRepoExplainerQuery(search);
        const hintText =
            (search.repoHints?.length ?? 0) > 0
                ? ` Focus areas: ${search.repoHints?.join(', ')}.`
                : '';
        const topicHintText =
            (search.topicHints?.length ?? 0) > 0
                ? ` Topic hints: ${search.topicHints?.join(', ')}.`
                : '';

        return [
            'The planner marked this as a Footnote repository explanation lookup.',
            'Treat footnote-ai/footnote as the canonical repository identity for this search.',
            'Prefer DeepWiki results from https://deepwiki.com/footnote-ai/footnote when they are relevant.',
            'If DeepWiki coverage is thin, use broader web context instead of getting stuck.',
            `Search query: ${repoQuery}.${hintText}${topicHintText}`.trim(),
            `Original planner query: ${search.query.trim()}.`,
        ].join(' ');
    }

    const topicHintText =
        (search.topicHints?.length ?? 0) > 0
            ? ` Focus areas: ${search.topicHints?.join(', ')}.`
            : '';
    return `The planner instructed you to perform a web search for: ${search.query.trim()}.${topicHintText}`.trim();
};

const createVoltAgentSearchTool = (
    provider: string,
    search: GenerationSearchRequest
): ReturnType<ProviderToolFactory> => {
    const mapping = resolveToolForProvider('web_search', provider);
    if (!mapping.supported) {
        throw new Error(
            `Provider "${provider}" does not have a registered web_search tool mapping (${mapping.reason}).`
        );
    }

    return mapping.factory(search);
};

const toVoltAgentProviderTool = (
    tool: ReturnType<typeof createVoltAgentSearchTool>
): VoltAgentProviderTool => {
    if (
        tool.type !== 'provider' ||
        typeof tool.id !== 'string' ||
        tool.id.trim().length === 0 ||
        typeof tool.name !== 'string' ||
        tool.name.trim().length === 0
    ) {
        throw new Error('Invalid VoltAgent search tool payload.');
    }

    return tool as VoltAgentProviderTool;
};

const toVoltAgentAgentTools = (
    tool: VoltAgentProviderTool
): NonNullable<AgentOptions['tools']> => [tool];

type VoltAgentResponseBody = {
    output?: Array<{
        type?: string;
    }>;
};

const hasWebSearchCallInResponseBody = (body: unknown): boolean => {
    if (!body || typeof body !== 'object') {
        return false;
    }

    const outputItems = (body as VoltAgentResponseBody).output;
    return (
        Array.isArray(outputItems) &&
        outputItems.some((item) => item?.type === 'web_search_call')
    );
};

const extractCitationsFromSources = (
    sources: VoltAgentSource[] | undefined
): GenerationCitation[] => {
    if (!Array.isArray(sources) || sources.length === 0) {
        return [];
    }

    const citations: GenerationCitation[] = [];
    const seenUrls = new Set<string>();

    for (const source of sources) {
        if (!source || typeof source.url !== 'string') {
            continue;
        }

        let normalizedUrl: string;
        try {
            const parsedUrl = new URL(source.url);
            if (
                parsedUrl.protocol !== 'http:' &&
                parsedUrl.protocol !== 'https:'
            ) {
                continue;
            }
            normalizedUrl = parsedUrl.toString();
        } catch {
            continue;
        }

        if (seenUrls.has(normalizedUrl)) {
            continue;
        }

        seenUrls.add(normalizedUrl);
        citations.push({
            title:
                typeof source.title === 'string' && source.title.trim()
                    ? source.title.trim()
                    : 'Source',
            url: normalizedUrl,
        });
    }

    return citations;
};

/**
 * Converts the executor result into the shared generation result shape.
 */
const normalizeVoltAgentResult = (
    executedModel: string,
    request: GenerationRequest,
    result: VoltAgentTextResult,
    fallbackToolExecution?: ToolExecutionContext
): GenerationResult => {
    const responseModel = result.response?.modelId ?? executedModel;
    const upstreamAttribution = extractOpenRouterAttribution(
        result.providerMetadata
    );
    const usage: GenerationUsage | undefined = result.usage
        ? {
              promptTokens: result.usage.promptTokens,
              ...(result.usage.cachedInputTokens !== undefined && {
                  cachedInputTokens: result.usage.cachedInputTokens,
              }),
              ...(result.usage.cacheWriteTokens !== undefined && {
                  cacheWriteTokens: result.usage.cacheWriteTokens,
              }),
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
          }
        : undefined;
    const hasSearchRequest = request.search !== undefined;
    const hasWebSearchCall = hasWebSearchCallInResponseBody(
        result.response?.body
    );
    const citationsFromSources = extractCitationsFromSources(result.sources);
    const citations =
        citationsFromSources.length === 0 &&
        hasWebSearchCall &&
        result.text.trim().length > 0
            ? extractMarkdownLinkCitations(result.text)
            : citationsFromSources;
    const retrievalUsed =
        hasSearchRequest && (hasWebSearchCall || citations.length > 0);
    const inferredToolExecution: ToolExecutionContext | undefined =
        hasSearchRequest
            ? {
                  toolName: 'web_search',
                  status: retrievalUsed ? 'executed' : 'skipped',
                  ...(retrievalUsed
                      ? {}
                      : {
                            reasonCode: 'tool_not_used',
                        }),
              }
            : undefined;

    return {
        text: result.text,
        model: toFootnoteModel(responseModel),
        ...(upstreamAttribution !== undefined && { upstreamAttribution }),
        finishReason: result.finishReason,
        usage,
        citations,
        retrieval: {
            requested: hasSearchRequest,
            used: retrievalUsed,
        },
        provenance: retrievalUsed ? 'Retrieved' : 'Inferred',
        ...(fallbackToolExecution !== undefined
            ? { toolExecution: fallbackToolExecution }
            : inferredToolExecution !== undefined
              ? { toolExecution: inferredToolExecution }
              : {}),
    };
};

/**
 * @description: Creates the VoltAgent executor for plain-text generation.
 * Keeps OpenRouter routing and attribution provider-specific while backend retains workflow authority.
 * @footnote-scope: core
 * @footnote-module: VoltAgentRuntime
 * @footnote-risk: high - Incorrect request mapping can change routing or hide provider attribution.
 * @footnote-ethics: high - This adapter must not take ownership of Footnote provenance or review decisions.
 */
const createDefaultVoltAgentExecutor = ({
    model,
    logger,
    voltOpsClient,
    ollama: _ollama,
    openrouter,
    openrouterRouting,
    agentFactory = ({
        model: agentModel,
        tools,
        instructions,
        logger: agentLogger,
        voltOpsClient: agentVoltOpsClient,
    }: CreateVoltAgentAgentFactoryInput): VoltAgentLike =>
        new Agent({
            name: 'footnote-generation-runtime',
            instructions:
                instructions ??
                'Continue the provided conversation transcript and follow any system messages included in it.',
            model: agentModel,
            memory: false,
            ...(agentLogger !== undefined && { logger: agentLogger }),
            ...(agentVoltOpsClient !== undefined && {
                voltOpsClient: agentVoltOpsClient,
            }),
            ...(tools !== undefined && { tools }),
        }),
}: Parameters<VoltAgentExecutorFactory>[0] & {
    agentFactory?: (input: CreateVoltAgentAgentFactoryInput) => VoltAgentLike;
}): VoltAgentTextExecutor => {
    const openRouterProviderPayload =
        toOpenRouterProviderPayload(openrouterRouting);
    const openRouterModel =
        model.startsWith('openrouter/') && openrouter !== undefined
            ? createOpenAICompatible({
                  name: 'openrouter',
                  apiKey: openrouter.apiKey,
                  baseURL: openrouter.baseUrl,
                  headers: {
                      'X-OpenRouter-Metadata': 'enabled',
                  },
                  metadataExtractor: openRouterMetadataExtractor,
                  transformRequestBody: (body) => ({
                      ...body,
                      ...(openRouterProviderPayload !== undefined && {
                          provider: openRouterProviderPayload,
                      }),
                  }),
              })(model.slice('openrouter/'.length))
            : undefined;
    const createAgent = (
        instructions: string | undefined,
        tools?: NonNullable<AgentOptions['tools']>
    ) =>
        agentFactory({
            model: openRouterModel ?? model,
            ...(instructions !== undefined && { instructions }),
            ...(logger !== undefined && { logger }),
            ...(voltOpsClient !== undefined && { voltOpsClient }),
            ...(tools !== undefined && { tools }),
        });

    return {
        async generateText(
            messages: RuntimeMessage[],
            options: VoltAgentGenerateTextOptions
        ): Promise<VoltAgentTextResult> {
            const { instructions, transcript } =
                splitLeadingSystemMessages(messages);
            const searchInstruction = options.search
                ? buildVoltAgentSearchInstruction(options.search)
                : undefined;
            const mergedInstructions = [instructions, searchInstruction]
                .filter(
                    (part): part is string =>
                        part !== undefined && part.trim().length > 0
                )
                .join('\n\n');
            const resolvedInstructions =
                mergedInstructions.length > 0 ? mergedInstructions : undefined;
            const callOptions: VoltAgentCallOptions = {
                ...(options.maxOutputTokens !== undefined && {
                    maxOutputTokens: options.maxOutputTokens,
                }),
                ...(options.providerOptions !== undefined && {
                    providerOptions: toVoltAgentCallProviderOptions(
                        options.providerOptions
                    ) as VoltAgentCallOptions['providerOptions'],
                }),
                ...(options.search !== undefined && {
                    toolChoice:
                        'required' as VoltAgentCallOptions['toolChoice'],
                }),
                ...(options.structuredOutput !== undefined && {
                    output: Output.object({
                        schema: jsonSchema(options.structuredOutput.schema),
                        ...(options.structuredOutput.name !== undefined && {
                            name: options.structuredOutput.name,
                        }),
                        ...(options.structuredOutput.description !==
                            undefined && {
                            description: options.structuredOutput.description,
                        }),
                    }),
                }),
                ...(options.signal !== undefined && {
                    signal: options.signal,
                }),
            };
            const activeAgent =
                options.search !== undefined
                    ? createAgent(
                          resolvedInstructions,
                          toVoltAgentAgentTools(
                              toVoltAgentProviderTool(
                                  createVoltAgentSearchTool(
                                      getVoltAgentProvider(model),
                                      options.search
                                  )
                              )
                          )
                      )
                    : createAgent(resolvedInstructions);
            const result = await activeAgent.generateText(
                toVoltAgentMessages(transcript),
                callOptions
            );

            if (
                options.structuredOutput !== undefined &&
                result.output === undefined
            ) {
                throw new Error(
                    'VoltAgent structured generation completed without a validated output.'
                );
            }

            return {
                text:
                    options.structuredOutput === undefined
                        ? result.text
                        : JSON.stringify(result.output),
                finishReason: result.finishReason,
                usage: {
                    promptTokens: result.usage.inputTokens,
                    cachedInputTokens:
                        result.usage.inputTokenDetails.cacheReadTokens,
                    cacheWriteTokens:
                        result.usage.inputTokenDetails.cacheWriteTokens,
                    completionTokens: result.usage.outputTokens,
                    totalTokens: result.usage.totalTokens,
                },
                response: {
                    modelId: result.response.modelId,
                    body: result.response.body,
                },
                providerMetadata: result.providerMetadata,
                sources:
                    result.sources
                        ?.filter(
                            (
                                source
                            ): source is typeof source & {
                                sourceType: 'url';
                                url: string;
                            } =>
                                source.type === 'source' &&
                                source.sourceType === 'url'
                        )
                        .map((source) => ({
                            url: source.url,
                            title: source.title,
                        })) ?? [],
            };
        },
    };
};

/**
 * Creates the VoltAgent-backed runtime implementation.
 */
const createVoltAgentRuntime = ({
    defaultModel,
    createExecutor = createDefaultVoltAgentExecutor,
    kind = 'voltagent',
    logger,
    ollama,
    openrouter,
    voltOps,
}: CreateVoltAgentRuntimeOptions): GenerationRuntime => {
    const voltOpsClient =
        voltOps !== undefined
            ? new VoltOpsClient({
                  publicKey: voltOps.publicKey,
                  secretKey: voltOps.secretKey,
              })
            : undefined;

    return {
        kind,
        async generate(request: GenerationRequest): Promise<GenerationResult> {
            const modelResolution = resolveVoltAgentModelId({
                requestedModel: request.model,
                defaultModel,
            });
            const selectedModel = modelResolution.selectedModel;
            if (!selectedModel) {
                throw new Error(
                    'VoltAgent runtime requires request.model or a configured defaultModel.'
                );
            }

            const requestedProvider = resolveVoltAgentProviderOverride({
                provider: request.provider,
                ollama,
            });
            const hasExplicitRequestModel =
                typeof request.model === 'string' &&
                request.model.trim().length > 0;
            const inferredProvider =
                inferProviderFromModelId(selectedModel) ??
                (!hasExplicitRequestModel
                    ? inferProviderFromModelId(defaultModel)
                    : undefined);
            const executedModel = toVoltAgentModel(
                selectedModel,
                requestedProvider ?? inferredProvider
            );
            const provider = getVoltAgentProvider(executedModel);
            const executorOllamaConfig = resolveExecutorOllamaConfig(
                provider,
                ollama
            );
            const executorOpenRouterConfig =
                provider === 'openrouter' && openrouter?.apiKey?.trim()
                    ? {
                          apiKey: openrouter.apiKey.trim(),
                          baseUrl:
                              openrouter.baseUrl?.trim() ||
                              'https://openrouter.ai/api/v1',
                      }
                    : undefined;
            if (
                provider === 'openrouter' &&
                executorOpenRouterConfig === undefined &&
                logger !== undefined
            ) {
                logger.warn(
                    'VoltAgent OpenRouter configuration was skipped because the API key is unavailable.',
                    { provider, model: executedModel }
                );
            }
            const canUseSearch = request.capabilities?.canUseSearch === true;
            const searchToolMapping = resolveToolForProvider(
                'web_search',
                provider
            );
            const canProviderUseSearchTools = searchToolMapping.supported;
            const shouldForwardSearch =
                canUseSearch &&
                request.search !== undefined &&
                canProviderUseSearchTools;
            const fallbackToolExecution: ToolExecutionContext | undefined =
                request.search === undefined
                    ? undefined
                    : shouldForwardSearch
                      ? undefined
                      : {
                            toolName: 'web_search',
                            status: 'skipped',
                            reasonCode: canProviderUseSearchTools
                                ? 'search_not_supported_by_selected_profile'
                                : 'tool_unavailable',
                        };
            const requestForResult: GenerationRequest =
                shouldForwardSearch || request.search === undefined
                    ? request
                    : {
                          ...request,
                          search: undefined,
                      };
            if (
                canUseSearch &&
                request.search !== undefined &&
                !canProviderUseSearchTools &&
                logger
            ) {
                logger.warn(
                    'VoltAgent search was requested but provider tooling is unsupported; continuing without search.',
                    {
                        provider,
                        model: executedModel,
                        toolName: 'web_search',
                        mappingReason:
                            searchToolMapping.supported === false
                                ? searchToolMapping.reason
                                : undefined,
                    }
                );
            }
            const executor = createExecutor({
                model: executedModel,
                ...(logger !== undefined && { logger }),
                ...(voltOpsClient !== undefined && { voltOpsClient }),
                ...(executorOllamaConfig !== undefined && {
                    ollama: executorOllamaConfig,
                }),
                ...(executorOpenRouterConfig !== undefined && {
                    openrouter: executorOpenRouterConfig,
                }),
                ...(provider === 'openrouter' && {
                    openrouterRouting: request.providerRouting?.openrouter,
                }),
            });
            const providerOptions = buildVoltAgentProviderOptions(
                request,
                provider
            );
            const result = await executor.generateText(request.messages, {
                ...(request.maxOutputTokens !== undefined && {
                    maxOutputTokens: request.maxOutputTokens,
                }),
                ...(shouldForwardSearch && {
                    search: request.search,
                }),
                ...(request.structuredOutput !== undefined && {
                    structuredOutput: request.structuredOutput,
                }),
                ...(request.signal !== undefined && { signal: request.signal }),
                ...(providerOptions !== undefined && { providerOptions }),
            });

            return normalizeVoltAgentResult(
                executedModel,
                requestForResult,
                result,
                fallbackToolExecution
            );
        },
    };
};

export {
    buildVoltAgentProviderOptions,
    createDefaultVoltAgentExecutor,
    createVoltAgentRuntime,
    normalizeVoltAgentResult,
    openRouterMetadataExtractor,
    toFootnoteModel,
    toVoltAgentMessages,
    toVoltAgentModel,
};
