/**
 * @description: Builds the provider-neutral input for one model-backed Attempt
 * from canonical Context and explicitly declared semantic Results.
 * @footnote-scope: core
 * @footnote-module: ModelInputBuilder
 * @footnote-risk: high - Ordering or projection mistakes can expose the wrong data to a model.
 * @footnote-ethics: high - This seam keeps retrieved evidence advisory and trusted instructions explicit.
 */
import type {
    GenerationRequest,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import type {
    ContextStepRequest,
    ContextStepResult,
} from '@footnote/contracts/policy';
import type { ConversationContextEnvelope } from '../conversationContextService.js';
import type { ChatPlan } from '../chatPlanner.js';
import {
    buildGenerationContextManifest,
    renderGenerationContextManifest,
} from './contextManifest.js';
import { selectFollowUpSearchHint } from './contextStepHelpers.js';
import { buildPlannerPayload } from '../chatOrchestrator/plannerPayload.js';
import { estimateRuntimeMessageTokens } from './tokenBudget.js';

type ModelInput = GenerationRequest;

type ModelInputPlan = {
    plan: ChatPlan;
    surfacePolicy?: { coercedFrom: ChatPlan['action'] };
};

type ModelInputEvidenceFailure = {
    integrationName: string;
    requested: boolean;
    status: 'unavailable' | 'failed' | 'skipped';
};

const buildContextFailureMessage = (
    integrationName: string,
    status: ModelInputEvidenceFailure['status']
): RuntimeMessage => ({
    role: 'system',
    content: [
        `The requested context source "${integrationName}" was ${status}.`,
        'Do not claim to have consulted that source or attribute facts to it.',
        'If the user asked what that source says, explain that it was unavailable for this response and distinguish any answer based on other available context.',
    ].join(' '),
});

/** Internal result envelope consumed by the model-input seam. */
export type ModelInputEvidence = {
    results: readonly ContextStepResult[];
    failures: readonly ModelInputEvidenceFailure[];
};

type ModelInputContext = {
    messages: readonly RuntimeMessage[];
    envelope: ConversationContextEnvelope;
};

type BuildModelInputParams = {
    baseRequest: GenerationRequest;
    context: ModelInputContext;
    results: {
        plan?: ModelInputPlan;
        evidence?: ModelInputEvidence;
    };
    contextStepRequests: readonly ContextStepRequest[];
    openAiNativeSearchFromHintsEnabled?: boolean;
};

export type GenerationEvidenceProjection = {
    trimmed: boolean;
    inputTokensBefore: number;
    inputTokensAfter: number;
    retainedEvidenceCount: number;
    droppedEvidenceCount: number;
    truncatedEvidenceCount: number;
};

export type BoundedGenerationRequest = {
    request: GenerationRequest;
    evidenceProjection: GenerationEvidenceProjection;
};

const EVIDENCE_MARKERS = [
    'TRUSTGRAPH SOURCE EVIDENCE',
    'TRUSTGRAPH ADVISORY EVIDENCE',
    'UNTRUSTED PROJECT CONTEXT:',
    'UNTRUSTED SEARCH RESULT:',
] as const;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const MIN_EVIDENCE_MESSAGE_CHARS = 256;

const isEvidenceMessage = (message: RuntimeMessage): boolean =>
    EVIDENCE_MARKERS.some((marker) => message.content.startsWith(marker));

const truncateEvidenceMessage = (
    message: RuntimeMessage,
    maxTokens: number
): RuntimeMessage | undefined => {
    const maxChars = Math.floor(maxTokens * ESTIMATED_CHARS_PER_TOKEN);
    if (maxChars < MIN_EVIDENCE_MESSAGE_CHARS) {
        return undefined;
    }
    if (message.content.length <= maxChars) {
        return message;
    }
    return {
        ...message,
        content: `${message.content.slice(0, maxChars).trimEnd()}\n[Evidence text truncated to fit the selected model context.]`,
    };
};

/**
 * Keeps retrieval unchanged while fitting advisory evidence into a profile's
 * declared input window. Evidence is retained in adapter rank order, and its
 * source/provenance header stays ahead of any bounded text truncation.
 */
export const boundGenerationRequestToProfileInput = (input: {
    request: GenerationRequest;
    maxInputTokens?: number;
}): BoundedGenerationRequest => {
    const inputTokensBefore = estimateRuntimeMessageTokens(
        input.request.messages
    );
    const maxInputTokens =
        input.maxInputTokens === undefined ||
        !Number.isFinite(input.maxInputTokens)
            ? undefined
            : Math.max(1, Math.floor(input.maxInputTokens));
    const evidenceMessages = input.request.messages.filter(isEvidenceMessage);
    if (
        maxInputTokens === undefined ||
        inputTokensBefore <= maxInputTokens ||
        evidenceMessages.length === 0
    ) {
        return {
            request: input.request,
            evidenceProjection: {
                trimmed: false,
                inputTokensBefore,
                inputTokensAfter: inputTokensBefore,
                retainedEvidenceCount: evidenceMessages.length,
                droppedEvidenceCount: 0,
                truncatedEvidenceCount: 0,
            },
        };
    }

    const nonEvidenceTokens = estimateRuntimeMessageTokens(
        input.request.messages.filter((message) => !isEvidenceMessage(message))
    );
    let remainingTokens = Math.max(0, maxInputTokens - nonEvidenceTokens);
    let retainedEvidenceCount = 0;
    let droppedEvidenceCount = 0;
    let truncatedEvidenceCount = 0;
    const retainedEvidence = new Map<RuntimeMessage, RuntimeMessage>();

    for (const message of evidenceMessages) {
        const messageTokens = estimateRuntimeMessageTokens([message]);
        if (messageTokens <= remainingTokens) {
            retainedEvidence.set(message, message);
            remainingTokens -= messageTokens;
            retainedEvidenceCount += 1;
            continue;
        }

        const boundedMessage = truncateEvidenceMessage(
            message,
            remainingTokens
        );
        if (boundedMessage === undefined) {
            droppedEvidenceCount += 1;
            continue;
        }
        retainedEvidence.set(message, boundedMessage);
        retainedEvidenceCount += 1;
        truncatedEvidenceCount += 1;
        remainingTokens = 0;
    }
    const messages = input.request.messages.flatMap((message) => {
        if (!isEvidenceMessage(message)) {
            return [message];
        }
        const retained = retainedEvidence.get(message);
        return retained === undefined ? [] : [retained];
    });
    const inputTokensAfter = estimateRuntimeMessageTokens(messages);

    return {
        request: { ...input.request, messages },
        evidenceProjection: {
            trimmed: true,
            inputTokensBefore,
            inputTokensAfter,
            retainedEvidenceCount,
            droppedEvidenceCount,
            truncatedEvidenceCount,
        },
    };
};

const insertManifest = (
    messages: readonly RuntimeMessage[],
    manifestContent: string
): RuntimeMessage[] => {
    const lastUserMessageIndex = messages.findLastIndex(
        (message) => message.role === 'user'
    );
    const insertionIndex =
        lastUserMessageIndex >= 0 ? lastUserMessageIndex + 1 : messages.length;
    return [
        ...messages.slice(0, insertionIndex),
        { role: 'system', content: manifestContent },
        ...messages.slice(insertionIndex),
    ];
};

const stringValues = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];

const buildResultMessages = (
    results: ModelInputEvidence['results']
): RuntimeMessage[] =>
    results.flatMap((result) => {
        if (result.outcome !== 'executed' && result.outcome !== 'failed') {
            return [];
        }
        const instructions = stringValues(result.trustedInstructions)
            .map((content) => content.trim())
            .filter((content) => content.length > 0)
            .map((content): RuntimeMessage => ({
                role: 'system',
                content,
            }));
        const failureGuidance =
            result.outcome === 'failed'
                ? [
                      buildContextFailureMessage(
                          result.executionContext.toolName,
                          'failed'
                      ),
                  ]
                : [];
        const evidence =
            result.outcome === 'executed'
                ? stringValues(result.evidence?.content)
                      .map((content) => content.trim())
                      .filter((content) => content.length > 0)
                      .map((content): RuntimeMessage => ({
                          // Evidence never inherits a role from an integration.
                          role: 'user',
                          content,
                      }))
                : [];
        return [...instructions, ...failureGuidance, ...evidence];
    });

const buildPlanMessage = (
    plan: ModelInputPlan | undefined
): RuntimeMessage | undefined =>
    plan === undefined
        ? undefined
        : {
              role: 'system',
              content: [
                  "FOOTNOTE PLAN: The backend selected this plan for the response. It does not override Footnote's rules or limits.",
                  buildPlannerPayload(plan.plan, plan.surfacePolicy),
              ].join('\n'),
          };

/**
 * Projects the Context and Results declared by a model-backed Step into one
 * deterministic provider-neutral request. Evidence is always projected as
 * user-level advisory data; only this module chooses message roles/order.
 */
export const buildModelInput = (input: BuildModelInputParams): ModelInput => {
    const evidenceResults = input.results.evidence?.results ?? [];
    const evidenceFailures = input.results.evidence?.failures ?? [];
    const selectedFollowUpSearchHint = selectFollowUpSearchHint({
        results: [...evidenceResults],
        openAiNativeSearchFromHintsEnabled:
            input.openAiNativeSearchFromHintsEnabled ?? false,
        effectiveGenerationRequest: input.baseRequest,
    });
    const manifest = buildGenerationContextManifest({
        contextEnvelope: input.context.envelope,
        contextStepRequests: [...input.contextStepRequests],
        contextStepResults: [...evidenceResults],
        contextStepFailures: [...evidenceFailures],
        webSearchRequested:
            input.baseRequest.search !== undefined ||
            selectedFollowUpSearchHint !== undefined,
        webSearchAvailable: input.baseRequest.capabilities?.canUseSearch,
    });
    const planMessage = buildPlanMessage(input.results.plan);
    const messages = [
        ...insertManifest(
            input.context.messages,
            renderGenerationContextManifest(manifest)
        ),
        ...buildResultMessages(evidenceResults),
        ...evidenceFailures
            .filter((failure) => failure.requested)
            .map((failure) =>
                buildContextFailureMessage(
                    failure.integrationName,
                    failure.status
                )
            ),
        ...(planMessage === undefined ? [] : [planMessage]),
    ];
    return {
        ...input.baseRequest,
        messages,
        ...(selectedFollowUpSearchHint !== undefined &&
        input.baseRequest.search === undefined
            ? {
                  search: {
                      query: selectedFollowUpSearchHint.query,
                      intent: selectedFollowUpSearchHint.intent,
                      contextSize: selectedFollowUpSearchHint.contextSize,
                  },
              }
            : {}),
    };
};
