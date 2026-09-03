/**
 * @description: Executes workflow step routing chains with strict transient fallback progression and serializable attempt telemetry.
 * @footnote-scope: core
 * @footnote-module: StepRoutingExecutor
 * @footnote-risk: high - Incorrect fallback progression can route steps to wrong providers or stop fail-open behavior.
 * @footnote-ethics: high - Chain execution policy impacts response reliability and transparency.
 */

import type { ModelProfile } from '@footnote/contracts';
import {
    isGenerationRuntimeError,
    type ProviderTemporaryUnavailableReason,
} from '@footnote/agent-runtime';
import type {
    ExecutionReasonCode,
    GenerationCompletion,
    GenerationExecutionUsage,
} from '@footnote/contracts/policy';
import type {
    ResolvedStepRoutingCandidate,
    WorkflowModelStep,
} from './stepRoutingChains.js';
import {
    defaultProviderAvailabilityStore,
    type ProviderAvailabilityStore,
} from './providerAvailability.js';

export type RoutingChainAttemptStatus =
    | 'executed'
    | 'failed_transient_advanced'
    | 'failed_non_transient_stopped'
    | 'skipped_ineligible'
    | 'skipped_temporary_unavailable';

export type RoutingChainAttemptLog = {
    index: number;
    step: WorkflowModelStep;
    profileId: string;
    provider?: string;
    model?: string;
    status: RoutingChainAttemptStatus;
    reasonCode?: ExecutionReasonCode;
    errorMessage?: string;
    temporaryUnavailableReason?: ProviderTemporaryUnavailableReason;
    finishReason?: string;
    completion?: GenerationCompletion;
    usage?: GenerationExecutionUsage;
    chooseOneUsed: boolean;
    chooseOneCandidates?: string[];
    chooseOneSelectedIndex?: number;
    seedKeyType?: 'session_id' | 'correlation_id';
};

export type RoutingChainExecutionResult<TSuccess> =
    | {
          status: 'executed';
          selected: {
              candidate: ResolvedStepRoutingCandidate;
              profile: ModelProfile;
              index: number;
          };
          value: TSuccess;
          attempts: RoutingChainAttemptLog[];
      }
    | {
          status: 'exhausted';
          reasonCode: ExecutionReasonCode;
          attempts: RoutingChainAttemptLog[];
      };

const isTransientError = (error: unknown): boolean => {
    if (
        isGenerationRuntimeError(error) &&
        error.details.classification === 'transient'
    ) {
        return true;
    }
    if (
        error !== null &&
        typeof error === 'object' &&
        'retryable' in error &&
        (error as { retryable?: unknown }).retryable === true
    ) {
        return true;
    }
    const message =
        error instanceof Error
            ? error.message.toLowerCase()
            : String(error).toLowerCase();

    // Preserve the pre-existing fallback heuristic for generic transient
    // failures. Only the normalized runtime classification can write bounded
    // provider availability state, so these hints never poison later routes.
    return (
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('504') ||
        message.includes('service unavailable') ||
        message.includes('temporarily unavailable') ||
        message.includes('overloaded') ||
        message.includes('upstream') ||
        message.includes('network') ||
        message.includes('connection reset')
    );
};

const getTemporaryUnavailableReason = (
    error: unknown
): ProviderTemporaryUnavailableReason | undefined =>
    isGenerationRuntimeError(error) &&
    error.details.classification === 'provider_temporary_unavailable'
        ? error.details.availabilityReason
        : undefined;

const isCandidateEligible = (
    candidate: ResolvedStepRoutingCandidate,
    profile: ModelProfile,
    input: { requiresSearch: boolean }
): { eligible: boolean; reasonCode?: ExecutionReasonCode } => {
    if (!profile.enabled) {
        return {
            eligible: false,
            reasonCode: 'routing_chain_entry_ineligible',
        };
    }

    if (input.requiresSearch && !profile.capabilities.canUseSearch) {
        return {
            eligible: false,
            reasonCode: 'routing_chain_entry_ineligible',
        };
    }

    if (candidate.profileId.trim().length === 0) {
        return {
            eligible: false,
            reasonCode: 'routing_chain_entry_ineligible',
        };
    }

    return { eligible: true };
};

export const executeStepRoutingChain = async <TSuccess>(input: {
    step: WorkflowModelStep;
    candidates: ResolvedStepRoutingCandidate[];
    enabledProfilesById: Map<string, ModelProfile>;
    requiresSearch: boolean;
    runWithProfile: (
        profile: ModelProfile,
        attemptIndex: number
    ) => Promise<TSuccess>;
    providerAvailability?: ProviderAvailabilityStore;
    /**
     * Lets a step classify a provider result as retryable without converting
     * it into an exception. The returned reason is retained on the route
     * receipt so callers can distinguish output admission from transport error.
     */
    retryReasonCode?: (value: TSuccess) => ExecutionReasonCode | undefined;
}): Promise<RoutingChainExecutionResult<TSuccess>> => {
    const attempts: RoutingChainAttemptLog[] = [];
    const providerAvailability =
        input.providerAvailability ?? defaultProviderAvailabilityStore;
    const availabilityEnabled = input.step === 'generate';

    for (let index = 0; index < input.candidates.length; index += 1) {
        const candidate = input.candidates[index];
        if (!candidate) {
            continue;
        }

        const profile = input.enabledProfilesById.get(candidate.profileId);
        if (!profile) {
            attempts.push({
                index,
                step: input.step,
                profileId: candidate.profileId,
                status: 'skipped_ineligible',
                reasonCode: 'routing_chain_entry_ineligible',
                chooseOneUsed: candidate.chooseOneUsed,
                chooseOneCandidates: candidate.chooseOneCandidates,
                chooseOneSelectedIndex: candidate.chooseOneSelectedIndex,
                seedKeyType: candidate.seedKeyType,
            });
            continue;
        }

        const eligibility = isCandidateEligible(candidate, profile, {
            requiresSearch: input.requiresSearch,
        });
        if (!eligibility.eligible) {
            attempts.push({
                index,
                step: input.step,
                profileId: profile.id,
                provider: profile.provider,
                model: profile.providerModel,
                status: 'skipped_ineligible',
                reasonCode: eligibility.reasonCode,
                chooseOneUsed: candidate.chooseOneUsed,
                chooseOneCandidates: candidate.chooseOneCandidates,
                chooseOneSelectedIndex: candidate.chooseOneSelectedIndex,
                seedKeyType: candidate.seedKeyType,
            });
            continue;
        }

        const temporaryUnavailable =
            !availabilityEnabled || candidate.selectionSource === 'explicit'
                ? undefined
                : providerAvailability.get(profile.provider);
        if (temporaryUnavailable !== undefined) {
            attempts.push({
                index,
                step: input.step,
                profileId: profile.id,
                provider: profile.provider,
                model: profile.providerModel,
                status: 'skipped_temporary_unavailable',
                reasonCode: 'routing_chain_temporary_unavailable',
                temporaryUnavailableReason: temporaryUnavailable.reason,
                errorMessage:
                    'Provider route skipped while its confirmed temporary unavailability is active.',
                chooseOneUsed: candidate.chooseOneUsed,
                chooseOneCandidates: candidate.chooseOneCandidates,
                chooseOneSelectedIndex: candidate.chooseOneSelectedIndex,
                seedKeyType: candidate.seedKeyType,
            });
            continue;
        }

        try {
            const value = await input.runWithProfile(profile, index);
            const retryReasonCode = input.retryReasonCode?.(value);
            if (retryReasonCode !== undefined) {
                attempts.push({
                    index,
                    step: input.step,
                    profileId: profile.id,
                    provider: profile.provider,
                    model: profile.providerModel,
                    status: 'failed_transient_advanced',
                    reasonCode: retryReasonCode,
                    errorMessage:
                        'Provider returned an inadmissible result; routing advanced to the next profile.',
                    chooseOneUsed: candidate.chooseOneUsed,
                    chooseOneCandidates: candidate.chooseOneCandidates,
                    chooseOneSelectedIndex: candidate.chooseOneSelectedIndex,
                    seedKeyType: candidate.seedKeyType,
                });
                continue;
            }
            attempts.push({
                index,
                step: input.step,
                profileId: profile.id,
                provider: profile.provider,
                model: profile.providerModel,
                status: 'executed',
                chooseOneUsed: candidate.chooseOneUsed,
                chooseOneCandidates: candidate.chooseOneCandidates,
                chooseOneSelectedIndex: candidate.chooseOneSelectedIndex,
                seedKeyType: candidate.seedKeyType,
            });
            if (availabilityEnabled) {
                providerAvailability.clear(profile.provider);
            }
            return {
                status: 'executed',
                selected: {
                    candidate,
                    profile,
                    index,
                },
                value,
                attempts,
            };
        } catch (error) {
            const temporaryUnavailableReason =
                getTemporaryUnavailableReason(error);
            const transient =
                temporaryUnavailableReason !== undefined ||
                isTransientError(error);
            const reasonCode: ExecutionReasonCode = transient
                ? temporaryUnavailableReason !== undefined
                    ? 'routing_chain_temporary_unavailable'
                    : 'routing_chain_transient_error'
                : 'routing_chain_non_transient_error';
            if (
                availabilityEnabled &&
                temporaryUnavailableReason !== undefined
            ) {
                providerAvailability.mark(
                    profile.provider,
                    temporaryUnavailableReason
                );
            }
            attempts.push({
                index,
                step: input.step,
                profileId: profile.id,
                provider: profile.provider,
                model: profile.providerModel,
                status: transient
                    ? 'failed_transient_advanced'
                    : 'failed_non_transient_stopped',
                reasonCode,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                ...(temporaryUnavailableReason !== undefined && {
                    temporaryUnavailableReason,
                }),
                chooseOneUsed: candidate.chooseOneUsed,
                chooseOneCandidates: candidate.chooseOneCandidates,
                chooseOneSelectedIndex: candidate.chooseOneSelectedIndex,
                seedKeyType: candidate.seedKeyType,
            });

            if (!transient) {
                return {
                    status: 'exhausted',
                    reasonCode,
                    attempts,
                };
            }
        }
    }

    return {
        status: 'exhausted',
        reasonCode: 'routing_chain_exhausted',
        attempts,
    };
};
