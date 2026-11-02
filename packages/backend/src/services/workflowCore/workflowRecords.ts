/**
 * @description: Projects bounded workflow execution facts into canonical Step, Attempt, and Result records.
 * @footnote-scope: core
 * @footnote-module: WorkflowRecords
 * @footnote-risk: medium - Projection changes affect trace lineage and cost evidence.
 * @footnote-ethics: high - Records must preserve provenance while keeping private content out.
 */
import type { GenerationResult } from '@footnote/agent-runtime';
import type {
    EvaluatorOutcome,
    ExecutionReasonCode,
    GenerationCompletion,
    PresentationMetadata,
    StepRecord,
    StepSignals,
    WorkflowAttemptCapabilities,
    WorkflowAttemptRecord,
    WorkflowAttemptRoutingRecord,
    WorkflowAttemptSettings,
    WorkflowRecord,
    WorkflowResultRecord,
    WorkflowResultReference,
    WorkflowStepKind,
    WorkflowTerminationReason,
    WorkflowTrustGraphTargetExecution,
} from '@footnote/contracts/policy';
import {
    combineBackendTextCostEstimates,
    type BackendTextCostEstimate,
} from '../llmCostRecorder.js';
import type { RoutingChainAttemptLog } from '../stepRoutingExecutor.js';
import type { WorkflowProfilePolicyContract } from '../workflowProfileContract.js';
import {
    buildExecutionLimitStop,
    resolveExecutionLimits,
    type ExecutionLimits,
    type ExhaustedExecutionLimit,
} from '../workflowEngine/limits.js';
import type { Result, RunResult, Workflow } from './types.js';
export type ChatStepMetadata = {
    status: 'executed' | 'failed' | 'skipped';
    summary: string;
    reasonCode?: ExecutionReasonCode;
    model?: string;
    provider?: string;
    profileId?: string;
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    completion?: GenerationCompletion;
    settings?: WorkflowAttemptSettings;
    providerObservations?: GenerationResult['providerObservations'];
    capabilities?: WorkflowAttemptCapabilities;
    routingAttempts?: WorkflowAttemptRoutingRecord[];
    promptCache?: GenerationResult['promptCache'];
    usage?: GenerationResult['usage'];
    estimatedCost?: BackendTextCostEstimate;
    signals?: StepSignals;
    recommendations?: string[];
    artifacts?: string[];
    terminationReason?: WorkflowTerminationReason;
    presentation?: PresentationMetadata;
    candidateId?: string;
    trustGraphTargets?: WorkflowTrustGraphTargetExecution[];
};

const readWorkflowMetadata = (
    value: Result | undefined
): ChatStepMetadata | undefined =>
    value === undefined ? undefined : (value as unknown as ChatStepMetadata);
const toWorkflowRoutingAttemptProviderEvidence = (
    attempt: RoutingChainAttemptLog
): Pick<WorkflowAttemptRoutingRecord, 'settings' | 'providerObservations'> => ({
    ...(attempt.providerSettingResolution === undefined
        ? {}
        : { settings: attempt.providerSettingResolution }),
    ...(attempt.providerObservations === undefined
        ? {}
        : { providerObservations: attempt.providerObservations }),
});

const toWorkflowRoutingAttempts = (
    attempts: readonly RoutingChainAttemptLog[] | undefined
): WorkflowAttemptRoutingRecord[] | undefined => {
    if (attempts === undefined || attempts.length === 0) return undefined;
    return attempts.map((attempt) => ({
        index: attempt.index,
        profileId: attempt.profileId,
        ...(attempt.provider === undefined
            ? {}
            : { requestedProvider: attempt.provider }),
        ...(attempt.model === undefined
            ? {}
            : { requestedModel: attempt.model }),
        ...(attempt.actualProvider === undefined
            ? {}
            : { actualProvider: attempt.actualProvider }),
        ...(attempt.actualModel === undefined
            ? {}
            : { actualModel: attempt.actualModel }),
        status: attempt.status,
        ...(attempt.providerCallStatus === undefined
            ? {}
            : { providerCallStatus: attempt.providerCallStatus }),
        ...(attempt.reasonCode === undefined
            ? {}
            : { reasonCode: attempt.reasonCode }),
        ...(attempt.finishReason === undefined
            ? {}
            : { finishReason: attempt.finishReason }),
        ...(attempt.completion === undefined
            ? {}
            : { completion: attempt.completion }),
        ...(attempt.usage === undefined ? {} : { usage: attempt.usage }),
        ...(attempt.promptCache === undefined
            ? {}
            : { promptCache: attempt.promptCache }),
        ...toWorkflowRoutingAttemptProviderEvidence(attempt),
        ...(attempt.cost === undefined
            ? {}
            : { cost: toWorkflowCost(attempt.cost) }),
        ...(attempt.startedAtMs === undefined
            ? {}
            : { startedAt: new Date(attempt.startedAtMs).toISOString() }),
        ...(attempt.finishedAtMs === undefined
            ? {}
            : { finishedAt: new Date(attempt.finishedAtMs).toISOString() }),
        ...(attempt.startedAtMs === undefined ||
        attempt.finishedAtMs === undefined
            ? {}
            : {
                  durationMs: Math.max(
                      0,
                      attempt.finishedAtMs - attempt.startedAtMs
                  ),
              }),
        chooseOneUsed: attempt.chooseOneUsed,
        ...(attempt.chooseOneSelectedIndex === undefined
            ? {}
            : { chooseOneSelectedIndex: attempt.chooseOneSelectedIndex }),
        ...(attempt.temporaryUnavailableReason === undefined
            ? {}
            : {
                  temporaryUnavailableReason:
                      attempt.temporaryUnavailableReason,
              }),
        ...(attempt.selectionSource === undefined
            ? {}
            : { selectionSource: attempt.selectionSource }),
    }));
};

export const withWorkflowRoutingAttempts = (
    attempts: readonly RoutingChainAttemptLog[] | undefined
): Pick<ChatStepMetadata, 'routingAttempts'> | Record<string, never> => {
    const routingAttempts = toWorkflowRoutingAttempts(attempts);
    return routingAttempts === undefined ? {} : { routingAttempts };
};

export const workflowStepKind = (stepId: string): WorkflowStepKind => {
    if (stepId === 'plan' || stepId === 'defaultPlan' || stepId === 'replan') {
        return 'plan';
    }
    if (stepId === 'retrieve' || stepId === 'tool') return 'tool';
    if (stepId === 'presentation') return 'presentation';
    if (stepId === 'generate') return 'generate';
    if (stepId === 'condense') return 'condense';
    if (stepId === 'assess') return 'assess';
    return 'finalize';
};

export const suppressAdmissionBlockedStep = (step: {
    stepId: string;
    attempts: readonly { exhaustedLimit?: ExhaustedExecutionLimit }[];
}): boolean =>
    workflowStepKind(step.stepId) !== 'tool' &&
    step.attempts.some((attempt) => attempt.exhaustedLimit !== undefined);

const metadataFromAttempt = (
    step: { attempts: readonly { metadata?: Result }[] },
    fallback: ChatStepMetadata
): ChatStepMetadata => {
    for (let index = step.attempts.length - 1; index >= 0; index -= 1) {
        const metadata = readWorkflowMetadata(step.attempts[index]?.metadata);
        if (metadata !== undefined) return metadata;
    }
    return fallback;
};

const toWorkflowCost = (
    estimatedCost: BackendTextCostEstimate
): BackendTextCostEstimate => ({ ...estimatedCost });

/** Projects workflow execution into canonical step, attempt, result, and
 * termination records. */
export const buildWorkflowLineage = (input: {
    execution: RunResult;
    workflow: Workflow;
    workflowName: string;
    maxDurationMs: number;
    advisoryUserMemoryCount?: number;
    executionLimits: ExecutionLimits;
    workflowPolicy: WorkflowProfilePolicyContract;
    maxSearchRecoveryCycles: number;
    terminationReason: WorkflowTerminationReason;
    exhaustedLimitKey?: ExhaustedExecutionLimit;
    stoppedBeforeStepKind?: WorkflowStepKind;
    hiddenPresentationStep?: boolean;
    preExistingPlannerStep?: StepRecord;
}): WorkflowRecord => {
    const records: StepRecord[] = [];
    const results: WorkflowResultRecord[] = [];
    const latestResultByName = new Map<string, WorkflowResultRecord>();
    const semanticSteps = input.execution.run.steps.filter(
        (step) =>
            step.stepId !== 'finish' &&
            !(input.hiddenPresentationStep && step.stepId === 'presentation') &&
            !suppressAdmissionBlockedStep(step)
    );
    for (let index = 0; index < semanticSteps.length; index += 1) {
        const step = semanticSteps[index];
        const kind = workflowStepKind(step.stepId);
        const fallback: ChatStepMetadata = {
            status: step.status === 'failed' ? 'failed' : 'executed',
            summary: `Workflow ${step.stepId} step completed.`,
        };
        const metadata = metadataFromAttempt(step, fallback);
        const priorOfKind = (
            candidate: WorkflowStepKind
        ): StepRecord | undefined =>
            [...records]
                .reverse()
                .find((record) => record.stepKind === candidate);
        const latestOfKinds = (
            candidates: readonly WorkflowStepKind[]
        ): StepRecord | undefined =>
            [...records]
                .reverse()
                .find((record) => candidates.includes(record.stepKind));
        let parent: StepRecord | undefined;
        if (kind === 'assess') {
            parent = latestOfKinds(['generate', 'condense']);
        } else if (kind === 'condense') {
            parent = priorOfKind('assess');
        } else if (kind === 'plan' && step.stepId === 'replan') {
            parent = priorOfKind('assess');
        } else if (kind === 'generate') {
            parent = latestOfKinds(['assess', 'presentation', 'plan', 'tool']);
        } else if (kind === 'presentation' || kind === 'tool') {
            parent = latestOfKinds(['assess', 'plan', 'tool']);
        }
        const successfulAttempt = [...step.attempts]
            .reverse()
            .find((attempt) => attempt.status === 'succeeded');
        const executionAttempt = successfulAttempt ?? step.attempts.at(-1);
        const exhaustedLimit = executionAttempt?.exhaustedLimit;
        if (exhaustedLimit === 'maxToolCalls') {
            fallback.reasonCode = 'max_tool_calls_reached';
        }
        const stepId = `step_${index + 1}`;
        const declaredStep = input.workflow.steps[step.stepId];
        const inputRefs: WorkflowResultReference[] | undefined =
            declaredStep?.input?.map((reference) => ({
                name: reference.name,
                ...(latestResultByName.get(reference.name) === undefined
                    ? {}
                    : {
                          resultId: latestResultByName.get(reference.name)
                              ?.resultId,
                      }),
                ...(reference.optional === true ? { optional: true } : {}),
            }));
        const attemptRecords: WorkflowAttemptRecord[] = step.attempts.map(
            (attempt) => {
                const attemptMetadata = readWorkflowMetadata(attempt.metadata);
                const reasonCode =
                    attemptMetadata?.reasonCode ?? attempt.errorCode;
                return {
                    attempt: attempt.attempt,
                    status: attempt.status,
                    startedAt: new Date(attempt.startedAtMs).toISOString(),
                    finishedAt: new Date(attempt.finishedAtMs).toISOString(),
                    durationMs: Math.max(
                        0,
                        attempt.finishedAtMs - attempt.startedAtMs
                    ),
                    ...(attemptMetadata?.requestedProvider === undefined
                        ? {}
                        : {
                              requestedProvider:
                                  attemptMetadata.requestedProvider,
                          }),
                    ...(attemptMetadata?.requestedModel === undefined
                        ? {}
                        : { requestedModel: attemptMetadata.requestedModel }),
                    ...(attemptMetadata?.actualProvider === undefined
                        ? {}
                        : { actualProvider: attemptMetadata.actualProvider }),
                    ...(attemptMetadata?.actualModel === undefined
                        ? {}
                        : { actualModel: attemptMetadata.actualModel }),
                    ...(attemptMetadata?.profileId === undefined
                        ? {}
                        : { profileId: attemptMetadata.profileId }),
                    ...(attemptMetadata?.completion === undefined
                        ? {}
                        : { completion: attemptMetadata.completion }),
                    ...(attemptMetadata?.settings === undefined
                        ? {}
                        : { settings: attemptMetadata.settings }),
                    ...(attemptMetadata?.providerObservations === undefined
                        ? {}
                        : {
                              providerObservations:
                                  attemptMetadata.providerObservations,
                          }),
                    ...(attemptMetadata?.capabilities === undefined
                        ? {}
                        : { capabilities: attemptMetadata.capabilities }),
                    ...(attemptMetadata?.promptCache === undefined
                        ? {}
                        : { promptCache: attemptMetadata.promptCache }),
                    ...(attemptMetadata?.usage === undefined
                        ? {}
                        : { usage: attemptMetadata.usage }),
                    ...(attemptMetadata?.estimatedCost === undefined
                        ? {}
                        : {
                              cost: toWorkflowCost(
                                  attemptMetadata.estimatedCost
                              ),
                          }),
                    ...(reasonCode === undefined ? {} : { reasonCode }),
                    ...(attemptMetadata?.terminationReason === undefined
                        ? {}
                        : {
                              terminationReason:
                                  attemptMetadata.terminationReason,
                          }),
                    ...(attemptMetadata?.routingAttempts === undefined
                        ? {}
                        : { routingAttempts: attemptMetadata.routingAttempts }),
                    ...(attemptMetadata?.trustGraphTargets === undefined
                        ? {}
                        : {
                              trustGraphTargets:
                                  attemptMetadata.trustGraphTargets,
                          }),
                };
            }
        );
        const outputName = declaredStep?.output?.name;
        const resultId =
            outputName === undefined
                ? undefined
                : `${input.execution.run.runId}:${stepId}:${outputName}`;
        const resultRecord: WorkflowResultRecord | undefined =
            resultId === undefined || outputName === undefined
                ? undefined
                : {
                      resultId,
                      name: outputName,
                      status:
                          successfulAttempt !== undefined &&
                          step.result !== undefined
                              ? 'produced'
                              : 'unavailable',
                      producedByStepId: stepId,
                      producedByAttempt:
                          executionAttempt?.attempt ?? step.attempts.length,
                  };
        if (resultRecord !== undefined) {
            results.push(resultRecord);
            if (resultRecord.status === 'produced') {
                latestResultByName.set(resultRecord.name, resultRecord);
            }
        }
        const modelAttemptCosts = attemptRecords
            .filter(
                (attempt) =>
                    attempt.requestedModel !== undefined ||
                    attempt.actualModel !== undefined
            )
            .map((attempt) => attempt.cost);
        const stepCost =
            modelAttemptCosts.length > 0
                ? combineBackendTextCostEstimates(modelAttemptCosts)
                : metadata.estimatedCost;
        records.push({
            stepId,
            ...(parent === undefined ? {} : { parentStepId: parent.stepId }),
            attempt:
                kind === 'generate'
                    ? Math.max(1, step.iteration - 1)
                    : step.iteration,
            stepKind: kind,
            ...(metadata.reasonCode === undefined
                ? {}
                : { reasonCode: metadata.reasonCode }),
            startedAt: new Date(
                executionAttempt?.startedAtMs ?? input.execution.run.startedAtMs
            ).toISOString(),
            finishedAt: new Date(
                executionAttempt?.finishedAtMs ??
                    input.execution.run.finishedAtMs
            ).toISOString(),
            durationMs: Math.max(
                0,
                (executionAttempt?.finishedAtMs ??
                    input.execution.run.finishedAtMs) -
                    (executionAttempt?.startedAtMs ??
                        input.execution.run.startedAtMs)
            ),
            ...(metadata.model === undefined ? {} : { model: metadata.model }),
            ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
            ...(stepCost === undefined
                ? {}
                : { cost: toWorkflowCost(stepCost) }),
            ...(inputRefs === undefined ? {} : { inputRefs }),
            ...(resultRecord === undefined
                ? {}
                : {
                      resultRefs: [
                          {
                              resultId: resultRecord.resultId,
                              name: resultRecord.name,
                          },
                      ],
                  }),
            attempts: attemptRecords,
            outcome: {
                status: metadata.status,
                summary: metadata.summary,
                ...(metadata.signals === undefined
                    ? {}
                    : { signals: metadata.signals }),
                ...(metadata.recommendations === undefined
                    ? {}
                    : { recommendations: metadata.recommendations }),
                ...(metadata.artifacts === undefined
                    ? {}
                    : { artifacts: metadata.artifacts }),
                ...(metadata.candidateId === undefined
                    ? {}
                    : { artifacts: [metadata.candidateId] }),
            },
        });
    }
    if (input.preExistingPlannerStep !== undefined) {
        records.unshift(input.preExistingPlannerStep);
    }
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record?.outcome.signals?.refinementSourceStepId !== 'assess') {
            continue;
        }
        const source = records
            .slice(0, index)
            .reverse()
            .find((candidate) => candidate.stepKind === 'assess');
        if (source === undefined || record === undefined) continue;
        records[index] = {
            ...record,
            outcome: {
                ...record.outcome,
                signals: {
                    ...record.outcome.signals,
                    refinementSourceStepId: source.stepId,
                },
            },
        };
    }
    return {
        workflowId: input.execution.run.workflowId,
        runId: input.execution.run.runId,
        runStatus: input.execution.status,
        startedAt: new Date(input.execution.run.startedAtMs).toISOString(),
        finishedAt: new Date(input.execution.run.finishedAtMs).toISOString(),
        durationMs: Math.max(
            0,
            input.execution.run.finishedAtMs - input.execution.run.startedAtMs
        ),
        workflowName: input.workflowName,
        status:
            input.terminationReason === 'goal_satisfied' &&
            input.execution.status === 'completed' &&
            records.every((record) => record.outcome.status !== 'failed')
                ? 'completed'
                : 'degraded',
        terminationReason: input.terminationReason,
        stepCount: records.length,
        maxSteps: input.executionLimits.maxWorkflowSteps,
        maxDurationMs: input.maxDurationMs,
        maxSearchRecoveryCycles: input.maxSearchRecoveryCycles,
        // Record only a coarse count after generation succeeds; the public trace
        // never receives memory text or account identity.
        ...(input.advisoryUserMemoryCount === undefined ||
        input.advisoryUserMemoryCount <= 0 ||
        !records.some(
            (step) =>
                step.stepKind === 'generate' &&
                step.attempts?.some((attempt) => attempt.status === 'succeeded')
        )
            ? {}
            : {
                  userMemory: {
                      includedItemCount: input.advisoryUserMemoryCount,
                  },
              }),
        effectiveLimits: resolveExecutionLimits({
            limits: input.executionLimits,
            policy: input.workflowPolicy,
            exhaustedLimitKey: input.exhaustedLimitKey,
        }),
        limitStop: buildExecutionLimitStop({
            terminationReason: input.terminationReason,
            exhaustedLimitKey: input.exhaustedLimitKey,
            stoppedBeforeStepKind: input.stoppedBeforeStepKind,
        }),
        results,
        steps: records,
    };
};

/** Projects the deterministic evaluator into the same bounded Run record.
 * The finding is evidence only; workflow topology and breaker authority stay
 * with their existing backend owners, and evaluator failure remains fail-open.
 */
export const addEvaluatorStepToWorkflowLineage = (input: {
    workflow: WorkflowRecord;
    evaluator?: {
        status: 'executed' | 'failed' | 'skipped';
        reasonCode?: string;
        outcome?: EvaluatorOutcome;
        startedAtMs?: number;
        finishedAtMs?: number;
        durationMs?: number;
    };
}): WorkflowRecord => {
    if (input.evaluator === undefined || input.workflow.runId === undefined) {
        return input.workflow;
    }
    const finishedAtMs = input.evaluator.finishedAtMs ?? Date.now();
    const startedAtMs =
        input.evaluator.startedAtMs ??
        Math.max(0, finishedAtMs - (input.evaluator.durationMs ?? 0));
    const durationMs =
        input.evaluator.durationMs ?? Math.max(0, finishedAtMs - startedAtMs);
    const resultId = `${input.workflow.runId}:evaluator_finding`;
    const result: WorkflowResultRecord = {
        resultId,
        name: 'evaluator_finding',
        status:
            input.evaluator.outcome === undefined ? 'unavailable' : 'produced',
        producedByStepId: 'step_evaluator',
        producedByAttempt: 1,
    };
    const safetyDecision = input.evaluator.outcome?.safetyDecision;
    const signals: StepSignals = {
        ...(input.evaluator.outcome?.mode === undefined
            ? {}
            : { evaluatorMode: input.evaluator.outcome.mode }),
        ...(input.evaluator.outcome?.authorityLevel === undefined
            ? {}
            : {
                  evaluatorAuthorityLevel:
                      input.evaluator.outcome.authorityLevel,
              }),
        ...(safetyDecision?.action === undefined
            ? {}
            : { evaluatorAction: safetyDecision.action }),
        ...(safetyDecision?.ruleId === undefined
            ? {}
            : { evaluatorRuleId: safetyDecision.ruleId }),
        ...(safetyDecision?.safetyTier === undefined
            ? {}
            : { evaluatorSafetyTier: safetyDecision.safetyTier }),
    };
    const attempt: WorkflowAttemptRecord = {
        attempt: 1,
        status:
            input.evaluator.status === 'executed'
                ? 'succeeded'
                : input.evaluator.status === 'skipped'
                  ? 'rejected'
                  : 'failed',
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: Math.max(0, durationMs),
        ...(input.evaluator.reasonCode === undefined
            ? {}
            : { reasonCode: input.evaluator.reasonCode }),
    };
    const step: StepRecord = {
        stepId: 'step_evaluator',
        attempt: 1,
        stepKind: 'evaluator',
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        durationMs: attempt.durationMs,
        resultRefs: [{ resultId, name: result.name }],
        attempts: [attempt],
        outcome: {
            status: input.evaluator.status,
            summary:
                input.evaluator.status === 'executed'
                    ? 'Deterministic evaluator produced a bounded finding.'
                    : input.evaluator.status === 'skipped'
                      ? 'Deterministic evaluator was skipped without a finding.'
                      : 'Deterministic evaluator failed open without a finding.',
            ...(input.evaluator.reasonCode === undefined
                ? {}
                : {
                      signals: {
                          ...signals,
                          evaluatorReasonCode: input.evaluator.reasonCode,
                      },
                  }),
            ...(input.evaluator.reasonCode === undefined &&
            Object.keys(signals).length > 0
                ? { signals }
                : {}),
        },
    };
    const steps = [...input.workflow.steps, step]
        .map((candidate, index) => ({ candidate, index }))
        .sort((left, right) => {
            const startedAtDelta =
                Date.parse(left.candidate.startedAt) -
                Date.parse(right.candidate.startedAt);
            return startedAtDelta === 0
                ? left.index - right.index
                : startedAtDelta;
        })
        .map(({ candidate }) => candidate);
    return {
        ...input.workflow,
        stepCount: input.workflow.stepCount + 1,
        results: [...(input.workflow.results ?? []), result],
        steps,
    };
};
