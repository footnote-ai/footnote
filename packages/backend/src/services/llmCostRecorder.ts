/**
 * @description: Records backend token usage and estimated spend for server-side model calls.
 * @footnote-scope: core
 * @footnote-module: BackendLLMCostRecorder
 * @footnote-risk: medium - Incorrect pricing or totals can hide backend spend and weaken cost visibility.
 * @footnote-ethics: medium - Cost tracking supports transparency and responsible AI resource use.
 */
import {
    estimateOpenAITextCost,
    estimateOpenAIRealtimeCost,
    type ImageGenerationCostIncompleteReason,
    resolveOpenAITextPricingModel,
    resolveOpenAIRealtimePricingModel,
    type OpenAITextCostAppliedRule,
    type OpenAITextCostCompleteness,
    type OpenAITextCostIncompleteReason,
    type OpenAITextUsageDetails,
} from '@footnote/contracts/pricing';
import { formatUsd, logger, type LLMCostTotals } from '../utils/logger.js';

export type BackendLLMCostRecord = {
    feature:
        | 'chat'
        | 'chat_planner'
        | 'news'
        | 'image'
        | 'image_prompt'
        | 'image_render'
        | 'image_description'
        | 'tts'
        | 'voice_realtime';
    model: string;
    promptTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    completionTokens: number;
    totalTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    totalCostUsd: number;
    costCompleteness?: OpenAITextCostCompleteness;
    costAppliedRules?: OpenAITextCostAppliedRule[];
    costIncompleteReasons?: Array<
        OpenAITextCostIncompleteReason | ImageGenerationCostIncompleteReason
    >;
    imageCount?: number;
    imageQuality?: 'low' | 'medium' | 'high' | 'auto';
    imageSize?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
    timestamp: number;
};

export type BackendTextCostEstimate = Pick<
    BackendLLMCostRecord,
    | 'inputCostUsd'
    | 'outputCostUsd'
    | 'totalCostUsd'
    | 'costCompleteness'
    | 'costAppliedRules'
    | 'costIncompleteReasons'
>;

const backendCostTotals: LLMCostTotals = {
    totalCostUsd: 0,
    totalCalls: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
};

export const estimateBackendTextCost = (
    model: string,
    promptTokens: number,
    completionTokens: number,
    usageDetails: OpenAITextUsageDetails = {}
): BackendTextCostEstimate => {
    const pricingResolution = resolveOpenAITextPricingModel(model);
    if (!pricingResolution.matchedModel) {
        logger.warn(
            JSON.stringify({
                event: 'backend_unpriced_model',
                pricingKind: 'text',
                model,
                canonicalModel: pricingResolution.canonicalModel,
                matchedModel: pricingResolution.matchedModel,
                wasCanonicalized: pricingResolution.wasCanonicalized,
                appliedRules: pricingResolution.appliedRules,
                message:
                    'No backend text pricing configured for model. Recording zero estimated cost.',
            })
        );
    }

    const estimatedCost = estimateOpenAITextCost(
        model,
        promptTokens,
        completionTokens,
        usageDetails
    );
    return {
        inputCostUsd: estimatedCost.inputCost,
        outputCostUsd: estimatedCost.outputCost,
        totalCostUsd: estimatedCost.totalCost,
        costCompleteness: estimatedCost.completeness,
        costAppliedRules: estimatedCost.appliedRules,
        costIncompleteReasons: estimatedCost.incompleteReasons,
    };
};

export const estimateBackendVoiceRealtimeCost = (
    model: string,
    promptTokens: number,
    completionTokens: number
): Pick<
    BackendLLMCostRecord,
    'inputCostUsd' | 'outputCostUsd' | 'totalCostUsd'
> => {
    const pricingResolution = resolveOpenAIRealtimePricingModel(model);
    if (!pricingResolution.matchedModel) {
        logger.warn(
            JSON.stringify({
                event: 'backend_unpriced_model',
                pricingKind: 'realtime',
                model,
                canonicalModel: pricingResolution.canonicalModel,
                matchedModel: pricingResolution.matchedModel,
                wasCanonicalized: pricingResolution.wasCanonicalized,
                appliedRules: pricingResolution.appliedRules,
                message:
                    'No backend realtime pricing configured for model. Recording zero estimated cost.',
            })
        );
    }

    const estimatedCost = estimateOpenAIRealtimeCost(
        model,
        promptTokens,
        completionTokens
    );
    return {
        inputCostUsd: estimatedCost.inputCost,
        outputCostUsd: estimatedCost.outputCost,
        totalCostUsd: estimatedCost.totalCost,
    };
};

export const recordBackendLLMUsage = (record: BackendLLMCostRecord): void => {
    backendCostTotals.totalCalls += 1;
    backendCostTotals.totalCostUsd += record.totalCostUsd;
    backendCostTotals.totalTokensIn += record.promptTokens;
    backendCostTotals.totalTokensOut += record.completionTokens;

    logger.info(
        JSON.stringify({
            event: 'backend_llm_cost',
            feature: record.feature,
            model: record.model,
            promptTokens: record.promptTokens,
            ...(record.cachedInputTokens !== undefined && {
                cachedInputTokens: record.cachedInputTokens,
            }),
            ...(record.cacheWriteTokens !== undefined && {
                cacheWriteTokens: record.cacheWriteTokens,
            }),
            completionTokens: record.completionTokens,
            totalTokens: record.totalTokens,
            totalCostUsd: Number(record.totalCostUsd.toFixed(6)),
            totalCostFormatted: formatUsd(record.totalCostUsd),
            ...(record.costCompleteness !== undefined && {
                costCompleteness: record.costCompleteness,
            }),
            ...(record.costAppliedRules !== undefined && {
                costAppliedRules: record.costAppliedRules,
            }),
            ...(record.costIncompleteReasons !== undefined && {
                costIncompleteReasons: record.costIncompleteReasons,
            }),
            ...(record.imageCount !== undefined && {
                imageCount: record.imageCount,
            }),
            ...(record.imageQuality !== undefined && {
                imageQuality: record.imageQuality,
            }),
            ...(record.imageSize !== undefined && {
                imageSize: record.imageSize,
            }),
            cumulativeTotalCostUsd: Number(
                backendCostTotals.totalCostUsd.toFixed(6)
            ),
            timestamp: record.timestamp,
        })
    );
};
