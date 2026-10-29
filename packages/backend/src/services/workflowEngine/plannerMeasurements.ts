/**
 * @description: Preserves per-call planner facts before transport fallback or expansion aggregates them.
 * @footnote-scope: core
 * @footnote-module: PlannerMeasurements
 * @footnote-risk: high - Missing calls can overstate cache savings and completeness.
 * @footnote-ethics: high - Only text-free provider facts reach canonical Attempts.
 */
import {
    normalizeGenerationUsage,
    translatePromptCache,
    type GenerationRequest,
    type GenerationUsage,
    type GenerationResult,
} from '@footnote/agent-runtime';
import type { RoutingChainInternalAttempt } from '../stepRoutingExecutor.js';
import { estimateBackendTextCost } from '../llmCostRecorder.js';
import { isPreProviderCallFailure } from '../preProviderCallFailure.js';

/** Observes one logical provider call; SDK-internal wire retries remain unreported. */
export const observePlannerCall = async <
    R extends GenerationRequest,
    T extends {
        model?: string;
        usage?: GenerationUsage;
        promptCache?: GenerationResult['promptCache'];
    },
>(
    request: R,
    execute: (request: R) => Promise<T>,
    record: (attempt: RoutingChainInternalAttempt) => void
): Promise<T> => {
    const startedAtMs = Date.now();
    let evidence:
        | {
              model?: string;
              usage?: GenerationUsage;
              promptCache?: GenerationResult['promptCache'];
              plannerModel?: string;
              plannerUsage?: unknown;
              upstreamAttribution?: GenerationResult['upstreamAttribution'];
              preProviderCallFailure?: boolean;
          }
        | undefined;
    let status: RoutingChainInternalAttempt['status'] = 'executed';
    let providerCallStatus: RoutingChainInternalAttempt['providerCallStatus'] =
        'succeeded';
    let preProviderFailure = false;
    try {
        const result = await execute(request);
        evidence = result;
        return result;
    } catch (error) {
        status = 'failed_transport_fallback';
        providerCallStatus = 'failed';
        if (typeof error === 'object' && error !== null) evidence = error;
        preProviderFailure = isPreProviderCallFailure(error);
        throw error;
    } finally {
        if (!preProviderFailure) {
            const usage = normalizeGenerationUsage(
                evidence?.usage ?? evidence?.plannerUsage
            );
            record({
                status,
                providerCallStatus,
                startedAtMs,
                finishedAtMs: Date.now(),
                usage,
                actualModel:
                    evidence?.upstreamAttribution?.resolvedModel ??
                    evidence?.model ??
                    evidence?.plannerModel,
                actualProvider:
                    evidence?.upstreamAttribution?.inferenceProvider,
                promptCache:
                    evidence?.promptCache ??
                    translatePromptCache(request)?.receipt,
                cost: estimateBackendTextCost(
                    evidence?.model ??
                        evidence?.plannerModel ??
                        request.model ??
                        '',
                    usage?.promptTokens,
                    usage?.completionTokens,
                    usage,
                    request.provider ?? 'unknown'
                ),
            });
        }
    }
};
