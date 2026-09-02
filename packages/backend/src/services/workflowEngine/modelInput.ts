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
        return [...instructions, ...evidence];
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
