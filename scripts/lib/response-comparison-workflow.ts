/**
 * @description: Runs comparison attempts through Footnote's bounded review workflow.
 * @footnote-scope: test
 * @footnote-module: ResponseComparisonWorkflow
 * @footnote-risk: high - Incorrect stage labels can misstate model results and cost.
 * @footnote-ethics: high - Attribution must identify which model wrote and reviewed each answer.
 */
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '../../packages/agent-runtime/src/index.js';
import type { ModelProfile } from '../../packages/contracts/src/index.js';
import { estimateOpenAITextCost } from '../../packages/contracts/src/pricing.js';
import type { ConversationContextEnvelope } from '../../packages/backend/src/services/conversationContextService.js';
import type {
    ReviewWorkflowUsageSummary,
    WorkflowRunPolicy,
} from '../../packages/backend/src/services/workflowEngine.js';
import type { ResponseComparisonProgressStage } from './response-comparison-progress.js';
import {
    classifyCandidateAvailability,
    detectCandidateChangeHints,
    selectResponseComparisonWorkflowCalls,
    stageFromResult,
    type ComparisonDependencies,
    type ResponseComparisonStage,
    type ResponseComparisonWorkflowResult,
} from './response-comparison.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const comparisonContextEnvelope: ConversationContextEnvelope = {
    participants: [],
    turns: [],
    diagnostics: {
        surface: 'web',
        totalInputMessages: 0,
        projectedMessageCount: 0,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    },
};

const comparisonWorkflowPolicy: WorkflowRunPolicy = {
    enablePlanning: false,
    enableToolUse: false,
    enableReplanning: false,
    enableGeneration: true,
    enableAssessment: true,
    enableRevision: true,
};

const captureComparisonUsage = (
    result: GenerationResult,
    requestedModel: string | undefined
): ReviewWorkflowUsageSummary => {
    const promptTokens = result.usage?.promptTokens ?? 0;
    const completionTokens = result.usage?.completionTokens ?? 0;
    const totalTokens =
        result.usage?.totalTokens ?? promptTokens + completionTokens;
    const reportedCost = result.upstreamAttribution?.upstreamReportedCostUsd;
    const costEstimate =
        reportedCost === undefined && requestedModel !== undefined
            ? estimateOpenAITextCost(
                  requestedModel,
                  promptTokens,
                  completionTokens
              )
            : {
                  inputCostUsd: 0,
                  outputCostUsd: 0,
                  totalCostUsd: reportedCost ?? 0,
              };
    const estimatedCost = {
        inputCostUsd:
            'inputCostUsd' in costEstimate
                ? costEstimate.inputCostUsd
                : costEstimate.inputCost,
        outputCostUsd:
            'outputCostUsd' in costEstimate
                ? costEstimate.outputCostUsd
                : costEstimate.outputCost,
        totalCostUsd:
            'totalCostUsd' in costEstimate
                ? costEstimate.totalCostUsd
                : costEstimate.totalCost,
    };
    return {
        model: result.model ?? requestedModel ?? 'unknown',
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCost,
    };
};

type WorkflowCall = {
    request: GenerationRequest;
    stage: ResponseComparisonProgressStage | 'final';
    startedAt: number;
    finishedAt: number;
    result?: GenerationResult;
    error?: string;
};

const readReviewDecision = (
    text: string
): 'finalize' | 'revise' | undefined => {
    const decision = text
        .match(/"reviewDecision"\s*:\s*"(finalize|revise)"/iu)?.[1]
        ?.toLowerCase();
    return decision === 'finalize' || decision === 'revise'
        ? decision
        : undefined;
};

const classifyWorkflowCall = (
    calls: WorkflowCall[],
    hasCandidate: boolean
): WorkflowCall['stage'] => {
    const previous = calls.at(-1);
    if (previous === undefined)
        return hasCandidate ? 'candidate' : 'authoritative';
    if (previous.stage === 'candidate') return 'authoritative';
    if (previous.stage === 'authoritative' || previous.stage === 'revision')
        return 'assessment';
    if (
        previous.stage === 'assessment' &&
        readReviewDecision(previous.result?.text ?? '') === 'revise'
    )
        return 'revision';
    return 'final';
};

/** Runs one experiment attempt through the production review workflow. */
export const buildResponseComparisonWorkflowRunner =
    (
        runtime: GenerationRuntime
    ): NonNullable<ComparisonDependencies['runWorkflow']> =>
    async ({
        condition,
        item,
        persona,
        candidateProfile,
        authoritativeProfile,
        authoritativeReasoningEffort,
        onStage,
    }): Promise<ResponseComparisonWorkflowResult> => {
        const calls: WorkflowCall[] = [];
        const recordingRuntime: GenerationRuntime = {
            kind: runtime.kind,
            generate: async (request) => {
                const stage = classifyWorkflowCall(
                    calls,
                    candidateProfile !== undefined
                );
                const startedAt = Date.now();
                const call: WorkflowCall = {
                    request,
                    stage,
                    startedAt,
                    finishedAt: startedAt,
                };
                calls.push(call);
                if (stage !== 'final') onStage?.({ stage, status: 'running' });
                try {
                    const result = await runtime.generate(request);
                    call.result = result;
                    call.finishedAt = Date.now();
                    if (stage !== 'final')
                        onStage?.({
                            stage,
                            status: 'completed',
                            durationMs: call.finishedAt - call.startedAt,
                            ...(stage === 'assessment' && {
                                decision: readReviewDecision(result.text),
                            }),
                        });
                    return result;
                } catch (error) {
                    call.error =
                        error instanceof Error ? error.message : String(error);
                    call.finishedAt = Date.now();
                    if (stage !== 'final')
                        onStage?.({
                            stage,
                            status: 'failed',
                            durationMs: call.finishedAt - call.startedAt,
                            reason: call.error,
                        });
                    throw error;
                }
            },
        };
        const { runBoundedReviewWorkflow } =
            await import('../../packages/backend/src/services/workflowEngine.js');
        const result = await runBoundedReviewWorkflow({
            generationRuntime: recordingRuntime,
            generationRequest: {
                messages: item.messages,
                model: authoritativeProfile.providerModel,
                provider: authoritativeProfile.provider,
                capabilities: authoritativeProfile.capabilities,
                providerRouting: authoritativeProfile.providerRouting,
                ...(authoritativeReasoningEffort !== undefined && {
                    reasoningEffort: authoritativeReasoningEffort,
                }),
            },
            messagesWithHints: item.messages,
            contextEnvelope: comparisonContextEnvelope,
            generationStartedAtMs: Date.now(),
            workflowConfig: {
                workflowName: `response-comparison:${condition.id}`,
                maxIterations: 2,
                maxDurationMs: 120_000,
                executionLimits: {
                    maxWorkflowSteps: 8,
                    maxToolCalls: 0,
                    maxPlanCycles: 0,
                    maxReviewCycles: 2,
                    maxDeliberationCalls: 5,
                    maxTokensTotal: 20_000,
                    maxDurationMs: 120_000,
                },
            },
            workflowPolicy: comparisonWorkflowPolicy,
            captureUsage: captureComparisonUsage,
            ...(candidateProfile !== undefined && {
                presentation: {
                    config: {
                        enabled: true,
                        profileId: candidateProfile.id,
                        timeoutMs: 30_000,
                        handoffVariant:
                            condition.handoffVariant ?? 'preserve-candidate',
                        profile: {
                            ...candidateProfile,
                            presentationGeneration: {
                                promptVariant: condition.candidatePromptVariant,
                            },
                        },
                    },
                    persona,
                    captureUsage: (value, profile) =>
                        captureComparisonUsage(value, profile.providerModel),
                },
            }),
            personaExpressionGuidance: persona.expressionGuidance,
        });
        const { candidateCall, authoritativeCall, revisionCalls, finalCall } =
            selectResponseComparisonWorkflowCalls(calls);
        const presentation =
            'presentation' in result ? result.presentation : undefined;
        const stage = (
            call: WorkflowCall | undefined,
            profile: ModelProfile | undefined,
            absentFailure?: string,
            failure?: string
        ): ResponseComparisonStage =>
            call === undefined
                ? {
                      status:
                          absentFailure === undefined ? 'not_run' : 'failed',
                      ...(absentFailure !== undefined && {
                          failure: absentFailure,
                      }),
                  }
                : stageFromResult(
                      call.result,
                      profile,
                      call.startedAt,
                      call.finishedAt,
                      failure ?? call.error
                  );
        const candidateStage = stage(
            candidateCall,
            candidateProfile,
            candidateProfile === undefined
                ? undefined
                : presentation?.outcome === 'candidate_unavailable'
                  ? presentation.reasonCode
                  : 'candidate_not_attempted',
            presentation?.outcome === 'candidate_unavailable'
                ? presentation.reasonCode
                : undefined
        );
        const decisions = result.workflowLineage.steps.flatMap(
            (step): ResponseComparisonWorkflowResult['correctionDecisions'] => {
                if (!isRecord(step.outcome.signals)) return [];
                const decision = step.outcome.signals.reviewDecision;
                if (decision !== 'finalize' && decision !== 'revise') return [];
                const reason = step.outcome.signals.reviewReason;
                const instruction = step.outcome.signals.revisionInstruction;
                return [
                    {
                        stage:
                            step.stepKind === 'assess'
                                ? 'assessment'
                                : 'revision',
                        decision,
                        ...(typeof reason === 'string' && { reason }),
                        ...(typeof instruction === 'string' && { instruction }),
                    },
                ];
            }
        );
        const candidateText = candidateCall?.result?.text;
        const candidateChangeHint = detectCandidateChangeHints({
            candidateText,
            authoritativeContext: item.messages,
        });
        return {
            candidate: candidateStage,
            authoritative: stage(
                authoritativeCall,
                authoritativeProfile,
                'authoritative_not_attempted'
            ),
            revisions: revisionCalls.map((call) =>
                stage(call, authoritativeProfile)
            ),
            final:
                result.outcome === 'generated'
                    ? stage(
                          finalCall,
                          authoritativeProfile,
                          'final_not_returned'
                      )
                    : {
                          status: 'failed',
                          failure: result.workflowLineage.terminationReason,
                      },
            candidateAvailability:
                candidateProfile === undefined
                    ? 'not_attempted'
                    : presentation?.outcome === 'candidate_unavailable'
                      ? 'unavailable'
                      : classifyCandidateAvailability(candidateStage),
            correctionDecisions: decisions,
            candidateChangeHint,
        };
    };
