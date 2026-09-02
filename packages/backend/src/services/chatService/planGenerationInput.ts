/**
 * @description: Builds the base conversation and execution snapshot after
 * planning.
 * @footnote-scope: core
 * @footnote-module: ChatServicePlanGenerationInput
 * @footnote-risk: medium - Incorrect assembly can desync the execution snapshot from generation.
 * @footnote-ethics: high - Stable assembly keeps planner advice separate from backend policy authority.
 */
import type {
    ChatConversationMessage,
    PostChatRequest,
} from '@footnote/contracts/web';
import type {
    SafetyTier,
    ToolInvocationRequest,
} from '@footnote/contracts/policy';
import type { PlannerPayloadChatPlan } from '../chatOrchestrator/plannerPayload.js';
import type { ChatGenerationToolIntent } from '../chatGenerationTypes.js';
import {
    toSnapshotContextEnvelope,
    type ConversationContextEnvelope,
} from '../conversationContextService.js';

export type PlanGenerationInputParams = {
    systemPrompt: string;
    personaPrompt: string;
    normalizedConversation: Array<
        Pick<ChatConversationMessage, 'role' | 'content'>
    >;
    contextEnvelope: ConversationContextEnvelope;
    executionPlan: PlannerPayloadChatPlan;
    surfacePolicy?: { coercedFrom: 'message' | 'react' | 'ignore' | 'image' };
    normalizedRequest: PostChatRequest;
    orchestrationSafetyTier: SafetyTier;
    toolIntent?: ChatGenerationToolIntent;
    toolRequestContext: ToolInvocationRequest;
    executionContract: {
        policyId: string;
        policyVersion: string;
    };
};

export type PlanGenerationInputResult = {
    conversationMessages: Array<
        Pick<ChatConversationMessage, 'role' | 'content'>
    >;
    conversationSnapshot: string;
};

export const assemblePlanGenerationInput = (
    input: PlanGenerationInputParams
): PlanGenerationInputResult => {
    const conversationMessages: Array<
        Pick<ChatConversationMessage, 'role' | 'content'>
    > = [
        {
            role: 'system',
            content: input.systemPrompt,
        },
        {
            role: 'system',
            content: input.personaPrompt,
        },
        ...input.normalizedConversation,
    ];

    const conversationSnapshot = JSON.stringify({
        request: input.normalizedRequest,
        planner: {
            action: input.executionPlan.action,
            modality: input.executionPlan.modality,
            profileId: input.executionPlan.profileId,
            safetyTier: input.orchestrationSafetyTier,
            generation: input.executionPlan.generation,
            toolIntent: input.toolIntent,
            toolRequest: input.toolRequestContext,
            ...(input.surfacePolicy && { surfacePolicy: input.surfacePolicy }),
        },
        executionContract: {
            policyId: input.executionContract.policyId,
            policyVersion: input.executionContract.policyVersion,
        },
        contextEnvelope: toSnapshotContextEnvelope(input.contextEnvelope),
    });

    return {
        conversationMessages,
        conversationSnapshot,
    };
};
