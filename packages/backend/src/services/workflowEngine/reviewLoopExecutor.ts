/**
 * @description: Executes the bounded assess/revise loop for reviewed workflow runs.
 * @footnote-scope: core
 * @footnote-module: WorkflowEngineReviewLoopExecutor
 * @footnote-risk: medium - Loop regressions can change termination/fail-open behavior.
 * @footnote-ethics: high - Review loop controls bounded deliberation and safety posture.
 */
import type {
    ExecutionReasonCode,
    StepSignals,
    StepRecord,
    WorkflowAssessRoutingHintSignals,
    WorkflowLimitKey,
    WorkflowStepKind,
    WorkflowTerminationReason,
} from '@footnote/contracts/policy';
import { buildWorkflowReviewParseFailureSignals } from '@footnote/contracts/policy';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
    RuntimeMessage,
} from '@footnote/agent-runtime';
import type { ModelProfile } from '@footnote/contracts';
import {
    composeAssessPrompt,
    composeRefinementPrompt,
} from '../prompts/reviewPromptComposer.js';
import { buildPlannerStepRecord } from './plannerStepRecord.js';
import type {
    PlanContinuation,
    PlanContinuationBuilder,
    PlannerStepExecutor,
    PlannerStepRequest,
} from '../plannerWorkflowSeams.js';
import { buildPlannerExecutionSummaryExtras } from '../plannerWorkflowSeams.js';
import type { ConversationContextEnvelope } from '../conversationContextService.js';
import type {
    ReviewDecision,
    ReviewDecisionParseResult,
} from './reviewDecision.js';
import { isWorkflowTransitionAllowed } from './transitions.js';
import { applyStepExecutionToState, type WorkflowState } from './state.js';
import type { WorkflowRunPolicy } from '../workflowEngine.js';
import { buildAssessSignals } from './reviewLoopSignals.js';
import { executeStepRoutingChain } from '../stepRoutingExecutor.js';
import type { ResolvedStepRoutingCandidate } from '../stepRoutingChains.js';
import { toRoutingChainResult } from '../routingChainResult.js';
import {
    decideRevisionRoutingHintLane,
    extractRoutingHintsFromAssess,
    reorderRevisionCandidatesByHintLane,
} from './revisionRoutingHints.js';
import {
    buildAssessRoutingHintSignals,
    buildRoutingChainSignals,
} from './routingSignals.js';
import { logger } from '../../utils/logger.js';
import { resolveProfileReasoningEffort } from '../runtimeRequestControls.js';
import type { ResponseCandidateCollector } from '../responseCandidates.js';

type CaptureStep = (input: {
    stepKind: 'plan' | 'tool' | 'generate' | 'assess' | 'revise' | 'finalize';
    status: 'executed' | 'failed' | 'skipped';
    summary: string;
    artifacts?: string[];
    startedAtMs: number;
    finishedAtMs: number;
    model?: string;
    usage?: GenerationResult['usage'];
    estimatedCost?: {
        inputCostUsd: number;
        outputCostUsd: number;
        totalCostUsd: number;
    };
    reasonCode?: ExecutionReasonCode;
    parentStepId?: string;
    attempt: number;
    signals?: StepSignals;
    recommendations?: string[];
}) => string;

type LimitStopEvaluation = {
    stopped: boolean;
    shouldStop: boolean;
    terminationReason: WorkflowTerminationReason;
    workflowStatus: 'completed' | 'degraded';
    exhaustedLimitKey?: WorkflowLimitKey;
    stoppedBeforeStepKind?: WorkflowStepKind;
};

/**
 * Executes the assess/revise loop and returns the updated workflow state bag.
 * The loop remains fail-open: generation/review/planner runtime failures are
 * converted into degraded termination instead of throwing. Policy and
 * transition authority comes from `workflowPolicy`, `stopIfOverLimits`,
 * `effectiveParseReviewDecision`, and optional planner re-entry seams.
 */
export const executeReviewLoop = async (ctx: {
    effectiveMaxIterations: number;
    workflowPolicy: WorkflowRunPolicy;
    stopIfOverLimits: (
        nextStepKind?:
            | 'plan'
            | 'tool'
            | 'generate'
            | 'assess'
            | 'revise'
            | 'finalize'
    ) => LimitStopEvaluation;
    selectedReviewModuleIds: string[];
    effectiveReviewDecisionPrompt?: string;
    generationRuntime: GenerationRuntime;
    messagesWithContext: RuntimeMessage[];
    draftResult: GenerationResult | null;
    effectiveGenerationRequest: GenerationRequest;
    captureUsage: (
        result: GenerationResult,
        requestedModel: string | undefined
    ) => {
        model: string;
        totalTokens: number;
        estimatedCost: {
            inputCostUsd: number;
            outputCostUsd: number;
            totalCostUsd: number;
        };
    };
    effectiveParseReviewDecision: (text: string) => ReviewDecisionParseResult;
    captureStep: CaptureStep;
    draftParentStepId?: string;
    draftCandidateId?: string;
    responseCandidates: ResponseCandidateCollector;
    terminationReason: WorkflowTerminationReason;
    workflowStatus: 'completed' | 'degraded';
    shouldStop: boolean;
    workflowState: WorkflowState;
    exhaustedLimitKey?: WorkflowLimitKey;
    stoppedBeforeStepKind?: WorkflowStepKind;
    plannerStepRequest?: PlannerStepRequest;
    plannerStepExecutor?: PlannerStepExecutor;
    planContinuationBuilder?: PlanContinuationBuilder;
    workflowId: string;
    workflowName: string;
    effectiveMessagesWithHints: RuntimeMessage[];
    effectiveContextEnvelope: ConversationContextEnvelope;
    effectiveRevisionPromptPrefix: string;
    stepCounterRef: { value: number };
    workflowStepsRef: { value: StepRecord[] };
    planContinuation?: PlanContinuation;
    stepRoutingChainSet?: {
        enabledProfilesById: Map<string, ModelProfile>;
        generateCandidates: ResolvedStepRoutingCandidate[];
        assessCandidates: ResolvedStepRoutingCandidate[];
    };
}): Promise<{
    stepCounter: number;
    messagesWithContext: RuntimeMessage[];
    draftResult: GenerationResult | null;
    draftParentStepId?: string;
    draftCandidateId?: string;
    terminationReason: WorkflowTerminationReason;
    workflowStatus: 'completed' | 'degraded';
    shouldStop: boolean;
    workflowState: WorkflowState;
    exhaustedLimitKey?: WorkflowLimitKey;
    stoppedBeforeStepKind?: WorkflowStepKind;
    effectiveGenerationRequest: GenerationRequest;
    effectiveMessagesWithHints: RuntimeMessage[];
    effectiveContextEnvelope: ConversationContextEnvelope;
    planContinuation?: PlanContinuation;
}> => {
    let {
        messagesWithContext,
        draftResult,
        draftParentStepId,
        draftCandidateId,
        terminationReason,
        workflowStatus,
        shouldStop,
        workflowState,
        exhaustedLimitKey,
        stoppedBeforeStepKind,
        effectiveGenerationRequest,
        effectiveMessagesWithHints,
        effectiveContextEnvelope,
        planContinuation,
    } = ctx;
    let latestRevisionInstruction: string | undefined;
    let latestAssessRoutingHintsCsv: string | undefined;
    let latestRoutingHintApplied:
        | 'openai_first_logic'
        | 'ollama_first_style'
        | 'cheaper_first'
        | 'none'
        | undefined;
    let latestRoutingHintConflictResolved: 'logic_over_style' | undefined;
    const syncLimitStop = (evaluation: LimitStopEvaluation): boolean => {
        if (!evaluation.stopped) {
            return false;
        }
        shouldStop = evaluation.shouldStop;
        terminationReason = evaluation.terminationReason;
        workflowStatus = evaluation.workflowStatus;
        exhaustedLimitKey = evaluation.exhaustedLimitKey;
        stoppedBeforeStepKind = evaluation.stoppedBeforeStepKind;
        return true;
    };
    const toLatestRoutingHintSignals = (): WorkflowAssessRoutingHintSignals =>
        buildAssessRoutingHintSignals({
            assessRoutingHintsCsv: latestAssessRoutingHintsCsv,
            routingHintApplied: latestRoutingHintApplied,
            routingHintConflictResolved: latestRoutingHintConflictResolved,
        });
    const executeAssessStep = async (
        iteration: number
    ): Promise<
        | {
              status: 'executed';
              decision: ReviewDecision;
              reviewStepId: string;
          }
        | {
              status: 'stopped';
          }
    > => {
        const reviewStartedAt = Date.now();
        try {
            const assessPrompt = composeAssessPrompt({
                moduleIds: ctx.selectedReviewModuleIds,
                basePromptOverride: ctx.effectiveReviewDecisionPrompt,
            });
            const assessRequest: GenerationRequest = {
                messages: [
                    ...messagesWithContext,
                    { role: 'assistant', content: draftResult?.text ?? '' },
                    { role: 'system', content: assessPrompt.prompt },
                ],
                model: effectiveGenerationRequest.model,
                ...(effectiveGenerationRequest.provider !== undefined && {
                    provider: effectiveGenerationRequest.provider,
                }),
                ...(effectiveGenerationRequest.capabilities !== undefined && {
                    capabilities: effectiveGenerationRequest.capabilities,
                }),
                ...(effectiveGenerationRequest.safetyIdentifier !==
                    undefined && {
                    safetyIdentifier:
                        effectiveGenerationRequest.safetyIdentifier,
                }),
                maxOutputTokens: 200,
                reasoningEffort: 'low',
                verbosity: 'low',
            };
            const assessChainResult =
                ctx.stepRoutingChainSet?.assessCandidates &&
                ctx.stepRoutingChainSet.assessCandidates.length > 0
                    ? await executeStepRoutingChain({
                          step: 'assess',
                          candidates: ctx.stepRoutingChainSet.assessCandidates,
                          enabledProfilesById:
                              ctx.stepRoutingChainSet.enabledProfilesById,
                          requiresSearch: false,
                          runWithProfile: async (profile) =>
                              ctx.generationRuntime.generate({
                                  ...assessRequest,
                                  model: profile.providerModel,
                                  provider: profile.provider,
                                  capabilities: profile.capabilities,
                                  reasoningEffort:
                                      resolveProfileReasoningEffort(
                                          profile,
                                          assessRequest.reasoningEffort,
                                          logger
                                      ),
                              }),
                      })
                    : undefined;
            const assessRoutingResult =
                assessChainResult !== undefined
                    ? toRoutingChainResult(assessChainResult)
                    : undefined;
            if (assessRoutingResult?.isErr()) {
                const routingFailure = assessRoutingResult.error;
                const reviewFinishedAt = Date.now();
                ctx.captureStep({
                    stepKind: 'assess',
                    status: 'failed',
                    summary:
                        'Assessment routing chain failed; fail-open returned latest successful draft.',
                    reasonCode: routingFailure.reasonCode,
                    startedAtMs: reviewStartedAt,
                    finishedAtMs: reviewFinishedAt,
                    parentStepId: draftParentStepId,
                    attempt: iteration,
                    signals: {
                        ...toLatestRoutingHintSignals(),
                        ...buildRoutingChainSignals({
                            attempts: routingFailure.attempts,
                            selectedProfileId: null,
                        }),
                    },
                });
                workflowState = applyStepExecutionToState(
                    workflowState,
                    'assess',
                    0,
                    0,
                    1
                );
                terminationReason = 'executor_error_fail_open';
                workflowStatus = 'degraded';
                shouldStop = true;
                return { status: 'stopped' };
            }
            const reviewResult = assessRoutingResult?.isOk()
                ? assessRoutingResult.value.value
                : await ctx.generationRuntime.generate(assessRequest);
            const assessUsageModel = assessRoutingResult?.isOk()
                ? assessRoutingResult.value.selected.profile.providerModel
                : effectiveGenerationRequest.model;
            const reviewFinishedAt = Date.now();
            const reviewUsage = ctx.captureUsage(
                reviewResult,
                assessUsageModel
            );
            workflowState = applyStepExecutionToState(
                workflowState,
                'assess',
                reviewUsage.totalTokens,
                0,
                1
            );
            const parseResult = ctx.effectiveParseReviewDecision(
                reviewResult.text
            );
            if (parseResult.isErr()) {
                const failure = parseResult.error;
                ctx.captureStep({
                    stepKind: 'assess',
                    status: 'failed',
                    summary:
                        'Assessment step returned invalid decision output; fail-open returned latest successful draft.',
                    reasonCode: 'generation_runtime_error',
                    startedAtMs: reviewStartedAt,
                    finishedAtMs: reviewFinishedAt,
                    model: reviewUsage.model,
                    usage: reviewResult.usage,
                    estimatedCost: reviewUsage.estimatedCost,
                    parentStepId: draftParentStepId,
                    attempt: iteration,
                    signals: {
                        ...buildWorkflowReviewParseFailureSignals(failure),
                        ...toLatestRoutingHintSignals(),
                    },
                });
                terminationReason = 'executor_error_fail_open';
                workflowStatus = 'degraded';
                shouldStop = true;
                return { status: 'stopped' };
            }
            const decision = parseResult.value;
            const assessSignals = buildAssessSignals(decision);
            const assessRoutingHints = extractRoutingHintsFromAssess({
                assessRawText: reviewResult.text,
                reviewDecision: decision,
            });
            const hintDecision =
                decideRevisionRoutingHintLane(assessRoutingHints);
            latestAssessRoutingHintsCsv =
                assessRoutingHints.length > 0
                    ? assessRoutingHints.join(',')
                    : undefined;
            latestRoutingHintApplied = hintDecision.lane;
            latestRoutingHintConflictResolved = hintDecision.conflictResolved;
            const reviewStepId = ctx.captureStep({
                stepKind: 'assess',
                status: 'executed',
                summary:
                    'Assessment step evaluated draft quality and emitted Reviewed decision.',
                startedAtMs: reviewStartedAt,
                finishedAtMs: reviewFinishedAt,
                model: reviewUsage.model,
                usage: reviewResult.usage,
                estimatedCost: reviewUsage.estimatedCost,
                parentStepId: draftParentStepId,
                attempt: iteration,
                signals: {
                    ...assessSignals,
                    ...toLatestRoutingHintSignals(),
                    ...buildRoutingChainSignals({
                        attempts: assessRoutingResult?.isOk()
                            ? assessRoutingResult.value.attempts
                            : undefined,
                        selectedProfileId: assessRoutingResult?.isOk()
                            ? assessRoutingResult.value.selected.profile.id
                            : null,
                    }),
                },
            });
            latestRevisionInstruction = decision.revisionInstruction;
            return {
                status: 'executed',
                decision,
                reviewStepId,
            };
        } catch {
            const reviewFinishedAt = Date.now();
            ctx.captureStep({
                stepKind: 'assess',
                status: 'failed',
                summary:
                    'Assessment step failed; fail-open returned latest successful draft.',
                reasonCode: 'generation_runtime_error',
                startedAtMs: reviewStartedAt,
                finishedAtMs: reviewFinishedAt,
                parentStepId: draftParentStepId,
                attempt: iteration,
                signals: toLatestRoutingHintSignals(),
            });
            workflowState = applyStepExecutionToState(
                workflowState,
                'assess',
                0,
                0,
                1
            );
            terminationReason = 'executor_error_fail_open';
            workflowStatus = 'degraded';
            shouldStop = true;
            return { status: 'stopped' };
        }
    };
    const executePlannerReentryStep = async (
        iteration: number,
        reviewStepId: string
    ): Promise<
        | {
              status: 'executed';
              reentryAttempt: number;
          }
        | {
              status: 'skipped';
              reentryAttempt: number;
          }
        | {
              status: 'stopped';
          }
    > => {
        if (
            ctx.plannerStepRequest === undefined ||
            ctx.plannerStepExecutor === undefined ||
            ctx.planContinuationBuilder === undefined
        ) {
            return {
                status: 'skipped',
                reentryAttempt: 0,
            };
        }
        if (
            !isWorkflowTransitionAllowed(
                workflowState.currentStepKind,
                'plan',
                ctx.workflowPolicy
            )
        ) {
            terminationReason = 'transition_blocked_by_policy';
            workflowStatus = 'degraded';
            shouldStop = true;
            return { status: 'stopped' };
        }
        if (syncLimitStop(ctx.stopIfOverLimits('plan'))) {
            return { status: 'stopped' };
        }
        const plannerReentryStartedAt = Date.now();
        try {
            const plannerReentryResult = await ctx.plannerStepExecutor({
                ...ctx.plannerStepRequest,
                workflowId: ctx.workflowId,
                workflowName: ctx.workflowName,
                attempt: iteration + 1,
            });
            const plannerReentryFinishedAt = Date.now();
            const plannerReentryStep = buildPlannerStepRecord({
                stepId: `step_${ctx.stepCounterRef.value + 1}`,
                attempt: iteration + 1,
                parentStepId: reviewStepId,
                startedAtMs: plannerReentryStartedAt,
                finishedAtMs: plannerReentryFinishedAt,
                summary: {
                    status: plannerReentryResult.execution.status,
                    ...(plannerReentryResult.execution.reasonCode !==
                        undefined && {
                        reasonCode: plannerReentryResult.execution.reasonCode,
                    }),
                    purpose: plannerReentryResult.execution.purpose,
                    contractType: plannerReentryResult.execution.contractType,
                    applyOutcome:
                        plannerReentryResult.execution.status === 'executed'
                            ? 'applied'
                            : 'not_applied',
                    durationMs: plannerReentryResult.execution.durationMs,
                    action: plannerReentryResult.plan.action,
                    modality: plannerReentryResult.plan.modality,
                    requestedCapabilityProfile:
                        plannerReentryResult.plan.requestedCapabilityProfile,
                    ...buildPlannerExecutionSummaryExtras(
                        plannerReentryResult.execution
                    ),
                },
            });
            ctx.workflowStepsRef.value.push(plannerReentryStep);
            ctx.stepCounterRef.value += 1;
            workflowState = applyStepExecutionToState(
                workflowState,
                'plan',
                plannerReentryResult.execution.usage?.totalTokens ?? 0,
                0,
                1
            );
            planContinuation = ctx.planContinuationBuilder({
                plannerStepResult: plannerReentryResult,
                workflowId: ctx.workflowId,
                workflowName: ctx.workflowName,
                attempt: iteration + 1,
                baseMessagesWithHints: effectiveMessagesWithHints,
                baseGenerationRequest: effectiveGenerationRequest,
                contextEnvelope: effectiveContextEnvelope,
            });
            if (planContinuation.continuation !== 'continue_message') {
                terminationReason = 'executor_error_fail_open';
                workflowStatus = 'degraded';
                shouldStop = true;
                return { status: 'stopped' };
            }
            effectiveGenerationRequest = planContinuation.generationRequest;
            effectiveMessagesWithHints = planContinuation.messagesWithHints;
            effectiveContextEnvelope = planContinuation.contextEnvelope;
            messagesWithContext = effectiveMessagesWithHints;
            return {
                status: 'executed',
                reentryAttempt: iteration,
            };
        } catch {
            terminationReason = 'executor_error_fail_open';
            workflowStatus = 'degraded';
            shouldStop = true;
            return { status: 'stopped' };
        }
    };
    const executeRevisionStep = async (input: {
        iteration: number;
        decision: ReviewDecision;
        reviewStepId: string;
        reentryAttempt: number;
    }): Promise<void> => {
        const revisionStartedAt = Date.now();
        try {
            const refinementModuleIds =
                input.decision.moduleHints !== undefined &&
                input.decision.moduleHints.length > 0
                    ? input.decision.moduleHints
                    : ctx.selectedReviewModuleIds;
            const refinementPrompt = composeRefinementPrompt({
                revisionPromptPrefix: ctx.effectiveRevisionPromptPrefix,
                revisionInstruction: latestRevisionInstruction,
                moduleIds: refinementModuleIds,
            });
            const revisionRequest: GenerationRequest = {
                ...effectiveGenerationRequest,
                messages: [
                    ...effectiveMessagesWithHints,
                    { role: 'assistant', content: draftResult?.text ?? '' },
                    { role: 'system', content: refinementPrompt.prompt },
                ],
            };
            const revisionChainResult =
                ctx.stepRoutingChainSet?.generateCandidates &&
                ctx.stepRoutingChainSet.generateCandidates.length > 0
                    ? await executeStepRoutingChain({
                          step: 'generate',
                          candidates: reorderRevisionCandidatesByHintLane({
                              candidates:
                                  ctx.stepRoutingChainSet.generateCandidates,
                              enabledProfilesById:
                                  ctx.stepRoutingChainSet.enabledProfilesById,
                              lane: latestRoutingHintApplied ?? 'none',
                          }),
                          enabledProfilesById:
                              ctx.stepRoutingChainSet.enabledProfilesById,
                          requiresSearch: revisionRequest.search !== undefined,
                          runWithProfile: async (profile) =>
                              ctx.generationRuntime.generate({
                                  ...revisionRequest,
                                  model: profile.providerModel,
                                  provider: profile.provider,
                                  capabilities: profile.capabilities,
                                  reasoningEffort:
                                      resolveProfileReasoningEffort(
                                          profile,
                                          revisionRequest.reasoningEffort,
                                          logger
                                      ),
                              }),
                      })
                    : undefined;
            const revisionRoutingResult =
                revisionChainResult !== undefined
                    ? toRoutingChainResult(revisionChainResult)
                    : undefined;
            if (revisionRoutingResult?.isErr()) {
                const routingFailure = revisionRoutingResult.error;
                const revisionFinishedAt = Date.now();
                ctx.captureStep({
                    stepKind: 'generate',
                    status: 'failed',
                    summary:
                        'Refinement routing chain failed; fail-open returned latest successful draft.',
                    reasonCode: routingFailure.reasonCode,
                    startedAtMs: revisionStartedAt,
                    finishedAtMs: revisionFinishedAt,
                    parentStepId: input.reviewStepId,
                    attempt: input.iteration,
                    signals: {
                        ...toLatestRoutingHintSignals(),
                        ...buildRoutingChainSignals({
                            attempts: routingFailure.attempts,
                            selectedProfileId: null,
                        }),
                    },
                });
                workflowState = applyStepExecutionToState(
                    workflowState,
                    'generate',
                    0,
                    0,
                    0
                );
                terminationReason = 'executor_error_fail_open';
                workflowStatus = 'degraded';
                shouldStop = true;
                return;
            }
            const revisionResult = revisionRoutingResult?.isOk()
                ? revisionRoutingResult.value.value
                : await ctx.generationRuntime.generate(revisionRequest);
            const revisionUsageModel = revisionRoutingResult?.isOk()
                ? revisionRoutingResult.value.selected.profile.providerModel
                : effectiveGenerationRequest.model;
            const revisionFinishedAt = Date.now();
            const revisionUsage = ctx.captureUsage(
                revisionResult,
                revisionUsageModel
            );
            const revisionCandidateId = ctx.responseCandidates.record({
                stage: 'revision',
                text: revisionResult.text,
                parentCandidateId: draftCandidateId,
            });
            const revisionStepId = ctx.captureStep({
                stepKind: 'generate',
                status: 'executed',
                summary: 'Generated refinement draft from assessment guidance.',
                startedAtMs: revisionStartedAt,
                finishedAtMs: revisionFinishedAt,
                model: revisionUsage.model,
                usage: revisionResult.usage,
                estimatedCost: revisionUsage.estimatedCost,
                parentStepId: input.reviewStepId,
                attempt: input.iteration,
                ...(revisionCandidateId !== undefined && {
                    artifacts: [revisionCandidateId],
                }),
                signals: {
                    refinementApplied: true,
                    refinementSourceStepId: input.reviewStepId,
                    appliedModuleCount:
                        refinementPrompt.appliedModuleIds.length,
                    ...(refinementPrompt.appliedModuleIds.length > 0 && {
                        appliedModuleIdsCsv:
                            refinementPrompt.appliedModuleIds.join(','),
                    }),
                    ...(input.reentryAttempt > 0 && {
                        reentryAttempt: input.reentryAttempt,
                    }),
                    ...toLatestRoutingHintSignals(),
                    ...buildRoutingChainSignals({
                        attempts: revisionRoutingResult?.isOk()
                            ? revisionRoutingResult.value.attempts
                            : undefined,
                        selectedProfileId: revisionRoutingResult?.isOk()
                            ? revisionRoutingResult.value.selected.profile.id
                            : null,
                    }),
                },
            });
            if (revisionCandidateId !== undefined) {
                ctx.responseCandidates.linkToWorkflowStep(
                    revisionCandidateId,
                    revisionStepId
                );
            }
            workflowState = applyStepExecutionToState(
                workflowState,
                'generate',
                revisionUsage.totalTokens,
                0,
                0
            );
            draftResult = revisionResult;
            draftParentStepId = revisionStepId;
            draftCandidateId = revisionCandidateId;
        } catch {
            const revisionFinishedAt = Date.now();
            ctx.captureStep({
                stepKind: 'generate',
                status: 'failed',
                summary:
                    'Refinement generation failed; fail-open returned latest successful draft.',
                reasonCode: 'generation_runtime_error',
                startedAtMs: revisionStartedAt,
                finishedAtMs: revisionFinishedAt,
                parentStepId: input.reviewStepId,
                attempt: input.iteration,
                signals: toLatestRoutingHintSignals(),
            });
            workflowState = applyStepExecutionToState(
                workflowState,
                'generate',
                0,
                0,
                0
            );
            terminationReason = 'executor_error_fail_open';
            workflowStatus = 'degraded';
            shouldStop = true;
        }
    };

    for (
        let iteration = 1;
        iteration <= ctx.effectiveMaxIterations && !shouldStop;
        iteration += 1
    ) {
        if (
            !isWorkflowTransitionAllowed(
                workflowState.currentStepKind,
                'assess',
                ctx.workflowPolicy
            )
        ) {
            terminationReason = 'transition_blocked_by_policy';
            workflowStatus = 'degraded';
            break;
        }
        if (syncLimitStop(ctx.stopIfOverLimits('assess'))) {
            break;
        }
        const assessStepResult = await executeAssessStep(iteration);
        if (assessStepResult.status === 'stopped' || shouldStop) {
            break;
        }
        const { decision, reviewStepId } = assessStepResult;
        if (decision.reviewDecision === 'finalize') {
            terminationReason = 'goal_satisfied';
            workflowStatus = 'completed';
            shouldStop = true;
            break;
        }
        if (iteration >= ctx.effectiveMaxIterations) {
            terminationReason = 'budget_exhausted_steps';
            exhaustedLimitKey = 'maxWorkflowSteps';
            stoppedBeforeStepKind = 'generate';
            workflowStatus = 'degraded';
            shouldStop = true;
            break;
        }
        if (!ctx.workflowPolicy.enableRevision) {
            terminationReason = 'transition_blocked_by_policy';
            workflowStatus = 'degraded';
            shouldStop = true;
            break;
        }
        if (
            !isWorkflowTransitionAllowed(
                workflowState.currentStepKind,
                'generate',
                ctx.workflowPolicy
            )
        ) {
            terminationReason = 'transition_blocked_by_policy';
            workflowStatus = 'degraded';
            shouldStop = true;
            break;
        }
        if (syncLimitStop(ctx.stopIfOverLimits('generate'))) {
            break;
        }
        const plannerReentryResult = await executePlannerReentryStep(
            iteration,
            reviewStepId
        );
        if (plannerReentryResult.status === 'stopped' || shouldStop) {
            break;
        }
        if (syncLimitStop(ctx.stopIfOverLimits('generate'))) {
            break;
        }
        await executeRevisionStep({
            iteration,
            decision,
            reviewStepId,
            reentryAttempt: plannerReentryResult.reentryAttempt,
        });
        if (shouldStop) {
            break;
        }
    }

    return {
        stepCounter: ctx.stepCounterRef.value,
        messagesWithContext,
        draftResult,
        draftParentStepId,
        draftCandidateId,
        terminationReason,
        workflowStatus,
        shouldStop,
        workflowState,
        exhaustedLimitKey,
        stoppedBeforeStepKind,
        effectiveGenerationRequest,
        effectiveMessagesWithHints,
        effectiveContextEnvelope,
        planContinuation,
    };
};
