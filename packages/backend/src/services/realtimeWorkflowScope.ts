/**
 * @description: Applies Voice execution limits and keeps conversation text out of stored receipts.
 * @footnote-scope: core
 * @footnote-module: RealtimeWorkflowScope
 * @footnote-risk: high - Scope loss can enable tools or persist private voice content.
 * @footnote-ethics: high - Consent to Voice processing does not permit automatic conversation history.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import {
    BOUNDED_REVIEW_ASSESS_DECISIONS,
    TRACE_ASSESS_FINAL_TEMPERAMENT_SIGNAL_KEYS,
    WORKFLOW_TERMINATION_REASONS,
    type ResponseMetadata,
    type StepOutcome,
    type WorkflowRecord,
    type WorkflowAttemptRecord,
} from '@footnote/contracts/policy';
import { ExecutionReasonCodeSchema } from '@footnote/contracts/web/schemas';
import type { RealtimeWorkflowResult } from './realtimeConversationState.js';
import type { ResponseCandidate } from '@footnote/contracts/web';
import { runtimeConfig } from '../config.js';
import { toFootnoteModel } from '@footnote/agent-runtime/voltagentRuntime';
import {
    fitsVoiceAnswerDelivery,
    type VoiceAnswerDeliveryPolicy,
} from './voiceAnswerBudget.js';

export type RealtimeReviewDisposition =
    | 'approved'
    | 'unassessed'
    | 'assessment_failed'
    | 'revision_requested'
    | 'search_requested'
    | 'selection_unverified'
    | 'workflow_not_completed'
    | 'unsupported_response'
    | 'answer_too_long'
    | 'workflow_limit_reached';

export type RealtimeWorkflowLimitReason =
    | 'budget_exhausted_steps'
    | 'budget_exhausted_tokens'
    | 'budget_exhausted_time'
    | 'max_deliberation_calls_reached';

/** Keep selected-answer evidence private to the backend; only approved answers carry text. */
export type RealtimeFinalResponse =
    | {
          disposition: Exclude<
              RealtimeReviewDisposition,
              'approved' | 'workflow_limit_reached'
          >;
      }
    | {
          disposition: 'workflow_limit_reached';
          limitReason: RealtimeWorkflowLimitReason;
      }
    | {
          disposition: 'approved';
          responseId: string;
          runId: string;
          candidateId: string;
          generationStepId: string;
          assessmentStepId: string;
          text: string;
      };

const hasUnassessedCondensationResult = (
    workflow: WorkflowRecord | undefined
): boolean =>
    workflow?.steps.some((step, index) => {
        if (
            step.stepKind !== 'condense' ||
            step.outcome.status !== 'executed' ||
            !step.attempts?.some((attempt) => attempt.status === 'succeeded')
        )
            return false;
        const draft = workflow.results?.find(
            (result) =>
                result.name === 'draft' &&
                result.status === 'produced' &&
                result.producedByStepId === step.stepId
        );
        if (
            draft === undefined ||
            !step.resultRefs?.some(
                (ref) => ref.name === 'draft' && ref.resultId === draft.resultId
            )
        )
            return false;
        return !workflow.steps.slice(index + 1).some((assessment) => {
            if (
                assessment.stepKind !== 'assess' ||
                assessment.outcome.status !== 'executed' ||
                !assessment.attempts?.some(
                    (attempt) => attempt.status === 'succeeded'
                ) ||
                !assessment.inputRefs?.some(
                    (ref) =>
                        ref.name === 'draft' && ref.resultId === draft.resultId
                )
            )
                return false;
            const review = workflow.results?.find(
                (result) =>
                    result.name === 'review' &&
                    result.status === 'produced' &&
                    result.producedByStepId === assessment.stepId
            );
            return (
                review !== undefined &&
                assessment.resultRefs?.some(
                    (ref) =>
                        ref.name === 'review' &&
                        ref.resultId === review.resultId
                ) === true
            );
        });
    }) ?? false;

type WorkflowStepRecord = WorkflowRecord['steps'][number];
type WorkflowResultRecord = NonNullable<WorkflowRecord['results']>[number];
type ResponseReviewFailure = Exclude<
    RealtimeFinalResponse,
    { disposition: 'approved' }
>;

const hasSuccessfulAttempt = (step: WorkflowStepRecord | undefined): boolean =>
    step?.attempts?.some((attempt) => attempt.status === 'succeeded') === true;

const hasResultReference = (
    step: WorkflowStepRecord | undefined,
    name: 'draft' | 'review',
    resultId: string
): boolean =>
    step?.resultRefs?.some(
        (ref) => ref.name === name && ref.resultId === resultId
    ) === true;

const hasInputReference = (
    step: WorkflowStepRecord | undefined,
    name: 'draft' | 'review',
    resultId: string
): boolean =>
    step?.inputRefs?.some(
        (ref) => ref.name === name && ref.resultId === resultId
    ) === true;

const expectedCandidateProducerKind = (
    stage: ResponseCandidate['stage']
): 'generate' | 'condense' | undefined => {
    switch (stage) {
        case 'initial_generation':
        case 'revision':
            return 'generate';
        case 'condensation':
            return 'condense';
        default:
            return undefined;
    }
};

const resolveFinalAssessment = (
    workflow: WorkflowRecord | undefined
): { assessment: WorkflowStepRecord } | { failure: ResponseReviewFailure } => {
    if (workflow === undefined)
        return { failure: { disposition: 'unassessed' } };
    const assessment = workflow.steps.findLast(
        (step) => step.stepKind === 'assess'
    );
    if (assessment === undefined)
        return { failure: { disposition: 'unassessed' } };
    if (
        assessment.outcome.status !== 'executed' ||
        !hasSuccessfulAttempt(assessment)
    )
        return { failure: { disposition: 'assessment_failed' } };
    const decision = assessment.outcome.signals?.reviewDecision;
    if (decision === 'revise')
        return { failure: { disposition: 'revision_requested' } };
    if (decision === 'search')
        return { failure: { disposition: 'search_requested' } };
    if (decision !== 'finalize')
        return { failure: { disposition: 'assessment_failed' } };
    const review = workflow.results?.find(
        (result) =>
            result.name === 'review' &&
            result.producedByStepId === assessment.stepId &&
            result.status === 'produced'
    );
    if (
        review === undefined ||
        !hasResultReference(assessment, 'review', review.resultId)
    )
        return { failure: { disposition: 'assessment_failed' } };
    return { assessment };
};

const isRealtimeCondensationLimitReason = (
    reason: WorkflowRecord['terminationReason']
): reason is RealtimeWorkflowLimitReason =>
    reason === 'budget_exhausted_steps' ||
    reason === 'budget_exhausted_tokens' ||
    reason === 'budget_exhausted_time' ||
    reason === 'max_deliberation_calls_reached';

const findRealtimeCondensationLimit = (
    workflow: WorkflowRecord | undefined
): RealtimeWorkflowLimitReason | undefined => {
    if (
        workflow === undefined ||
        !isRealtimeCondensationLimitReason(workflow.terminationReason)
    )
        return undefined;
    const condensationBlocked =
        workflow.steps.some(
            (step) =>
                step.outcome.signals?.condensationOutcome === 'budget_blocked'
        ) || hasUnassessedCondensationResult(workflow);
    return condensationBlocked ? workflow.terminationReason : undefined;
};

const findCandidateDraft = (
    workflow: WorkflowRecord | undefined,
    candidate: ResponseCandidate,
    expectedProducerKind: 'generate' | 'condense'
):
    | { producer: WorkflowStepRecord; draft: WorkflowResultRecord }
    | undefined => {
    if (workflow === undefined) return undefined;
    const producer = workflow.steps.find(
        (step) => step.stepId === candidate.workflowStepId
    );
    if (
        producer?.stepKind !== expectedProducerKind ||
        producer.outcome.status !== 'executed' ||
        !producer.outcome.artifacts?.includes(candidate.id)
    )
        return undefined;
    const draft = workflow.results?.find(
        (result) =>
            result.producedByStepId === producer.stepId &&
            result.name === 'draft' &&
            result.status === 'produced'
    );
    if (
        draft === undefined ||
        !hasResultReference(producer, 'draft', draft.resultId)
    )
        return undefined;
    return { producer, draft };
};

const hasFinalAssessmentForDraft = (
    workflow: WorkflowRecord,
    assessment: WorkflowStepRecord,
    producer: WorkflowStepRecord,
    draft: WorkflowResultRecord
): boolean => {
    const review = workflow.results?.find(
        (result) =>
            result.name === 'review' &&
            result.producedByStepId === assessment.stepId &&
            result.status === 'produced'
    );
    return (
        assessment.outcome.status === 'executed' &&
        hasSuccessfulAttempt(assessment) &&
        assessment.outcome.signals?.reviewDecision === 'finalize' &&
        assessment.parentStepId === producer.stepId &&
        hasInputReference(assessment, 'draft', draft.resultId) &&
        review !== undefined &&
        hasResultReference(assessment, 'review', review.resultId)
    );
};

const hasApprovedCondensationSource = (
    workflow: WorkflowRecord | undefined,
    candidate: ResponseCandidate,
    producer: WorkflowStepRecord,
    candidates: ResponseCandidate[] | undefined
): boolean => {
    if (workflow === undefined) return false;
    const sourceCandidate = candidates?.find(
        (entry) => entry.id === candidate.parentCandidateId
    );
    if (
        sourceCandidate === undefined ||
        sourceCandidate.sequence >= candidate.sequence ||
        sourceCandidate.state !== 'superseded' ||
        (sourceCandidate.stage !== 'initial_generation' &&
            sourceCandidate.stage !== 'revision')
    )
        return false;
    const sourceProducer = workflow.steps.find(
        (step) => step.stepId === sourceCandidate.workflowStepId
    );
    if (
        sourceProducer?.stepKind !== 'generate' ||
        !sourceProducer.outcome.artifacts?.includes(sourceCandidate.id)
    )
        return false;
    const sourceDraft = workflow.results?.find(
        (result) =>
            result.name === 'draft' &&
            result.producedByStepId === sourceProducer.stepId &&
            result.status === 'produced'
    );
    const producerIndex = workflow.steps.findIndex(
        (step) => step.stepId === producer.stepId
    );
    const priorAssessment =
        producerIndex < 0
            ? undefined
            : workflow.steps
                  .slice(0, producerIndex)
                  .findLast((step) => step.stepKind === 'assess');
    if (
        sourceDraft === undefined ||
        priorAssessment === undefined ||
        !hasResultReference(sourceProducer, 'draft', sourceDraft.resultId) ||
        priorAssessment.stepId !== producer.parentStepId ||
        !hasFinalAssessmentForDraft(
            workflow,
            priorAssessment,
            sourceProducer,
            sourceDraft
        )
    )
        return false;
    const sourceReview = workflow.results?.find(
        (result) =>
            result.name === 'review' &&
            result.producedByStepId === priorAssessment.stepId &&
            result.status === 'produced'
    );
    return (
        sourceReview !== undefined &&
        hasInputReference(producer, 'draft', sourceDraft.resultId) &&
        hasInputReference(producer, 'review', sourceReview.resultId)
    );
};

/** Reuses candidate selection and Result references, without treating fail-open completion as approval. */
export const assessRealtimeFinalResponse = (
    metadata: ResponseMetadata,
    deliveryPolicy: VoiceAnswerDeliveryPolicy,
    selection?: {
        message: string;
        candidates?: ResponseCandidate[];
        answerProvenanceEligible: boolean;
    }
): RealtimeFinalResponse => {
    if (!selection?.answerProvenanceEligible)
        return { disposition: 'unsupported_response' };
    const workflow = metadata.workflow;
    const assessmentResult = resolveFinalAssessment(workflow);
    if ('failure' in assessmentResult) return assessmentResult.failure;
    const { assessment } = assessmentResult;
    const limitReason = findRealtimeCondensationLimit(workflow);
    if (limitReason !== undefined)
        return { disposition: 'workflow_limit_reached', limitReason };
    const selected = selection.candidates?.filter(
        (candidate) => candidate.state === 'selected'
    );
    if (selected?.length !== 1) return { disposition: 'selection_unverified' };
    const candidate = selected[0];
    if (
        candidate.text !== selection.message ||
        !candidate.text.trim() ||
        Buffer.byteLength(candidate.text, 'utf8') > 16 * 1024
    )
        return { disposition: 'selection_unverified' };
    const expectedProducerKind = expectedCandidateProducerKind(candidate.stage);
    if (expectedProducerKind === undefined)
        return { disposition: 'unsupported_response' };
    const candidateDraft = findCandidateDraft(
        workflow,
        candidate,
        expectedProducerKind
    );
    if (candidateDraft === undefined)
        return { disposition: 'selection_unverified' };
    const { producer, draft } = candidateDraft;
    if (
        !hasInputReference(assessment, 'draft', draft.resultId) ||
        assessment.parentStepId !== producer.stepId
    )
        return { disposition: 'selection_unverified' };
    if (
        candidate.stage === 'condensation' &&
        !hasApprovedCondensationSource(
            workflow,
            candidate,
            producer,
            selection.candidates
        )
    )
        return { disposition: 'selection_unverified' };
    if (
        workflow === undefined ||
        !workflow.runId ||
        workflow.runStatus !== 'completed' ||
        workflow.status !== 'completed' ||
        workflow.terminationReason !== 'goal_satisfied'
    )
        return { disposition: 'workflow_not_completed' };
    if (
        !fitsVoiceAnswerDelivery(
            selection.message,
            deliveryPolicy.mode,
            deliveryPolicy.maxAnswerTokens
        )
    )
        return { disposition: 'answer_too_long' };
    return {
        disposition: 'approved',
        responseId: metadata.responseId,
        runId: workflow.runId,
        candidateId: candidate.id,
        generationStepId: producer.stepId,
        assessmentStepId: assessment.stepId,
        text: selection.message,
    };
};

export type RealtimeWorkflowScope = {
    sessionCorrelationId: string;
    turnId: string;
    onRunStarted: (runId: string) => void;
    deliveryPolicy: VoiceAnswerDeliveryPolicy;
    actionRejected?: boolean;
    recorded?: Required<
        Pick<RealtimeWorkflowResult, 'responseId' | 'runId' | 'status'>
    > & { finalResponse: RealtimeFinalResponse };
};

const scope = new AsyncLocalStorage<RealtimeWorkflowScope>();
export const realtimeWorkflowScope = (): RealtimeWorkflowScope | undefined =>
    scope.getStore();
/** Backend-owned scope is never deserialized from an HTTP request or planner output. */
export const withRealtimeWorkflowScope = <T>(
    value: RealtimeWorkflowScope,
    run: () => Promise<T>
): Promise<T> => scope.run(value, run);

const pick = <T extends object, K extends keyof T>(
    value: T,
    keys: readonly K[]
): Pick<T, K> =>
    Object.fromEntries(
        keys
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, value[key]])
    ) as Pick<T, K>;

const projectTraceAlignmentSignals = (
    source: StepOutcome['signals']
): NonNullable<StepOutcome['signals']> => {
    const alignment = source?.traceAlignment;
    if (alignment !== 'aligned' && alignment !== 'misaligned') return {};
    const signals: NonNullable<StepOutcome['signals']> = {
        traceAlignment: alignment,
    };
    if (alignment === 'misaligned')
        signals.traceAlignmentReason = '[withheld for voice privacy]';
    for (const key of Object.values(
        TRACE_ASSESS_FINAL_TEMPERAMENT_SIGNAL_KEYS
    )) {
        const value = source?.[key];
        if (
            typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= 1 &&
            value <= 5
        )
            signals[key] = value;
    }
    return signals;
};

const projectMachineSignals = (
    source: StepOutcome['signals']
): NonNullable<StepOutcome['signals']> => {
    const machineSignals: Record<string, readonly string[]> = {
        purpose: ['chat_orchestrator_action_selection'],
        contractType: ['structured', 'text_json', 'fallback'],
        applyOutcome: ['applied', 'adjusted_by_policy', 'not_applied'],
        action: ['message', 'react', 'image', 'ignore'],
        modality: ['text', 'tts'],
        clarificationReasonCode: ['ambiguous_location'],
        searchRecoveryOutcome: [
            'requested',
            'executed',
            'failed',
            'unavailable',
            'no_results',
            'cancelled',
            'regenerated',
            'generation_budget_blocked',
            'search_query_invalid',
            'search_query_repeated',
            'repeated_query',
            'cycle_limit',
            'policy_blocked',
            'execution_limit',
        ],
        condensationOutcome: [
            'requested',
            'completed',
            'still_overlong',
            'budget_blocked',
            'provider_failed',
            'empty_output',
            'incomplete_output',
            'output_rejected',
            'tool_rejected',
            'cancelled',
            'assessment_recovery_blocked',
        ],
    };
    const signals: NonNullable<StepOutcome['signals']> = {};
    for (const [key, allowed] of Object.entries(machineSignals)) {
        const value = source?.[key];
        if (typeof value === 'string' && allowed.includes(value))
            signals[key] = value;
    }
    return signals;
};

const projectOutcome = (outcome: StepOutcome): StepOutcome => {
    const signals = projectMachineSignals(outcome.signals);
    if (outcome.signals?.clarification === true) {
        signals.clarification = true;
    }
    if (typeof outcome.signals?.condensationAttempted === 'boolean') {
        signals.condensationAttempted = outcome.signals.condensationAttempted;
    }
    for (const key of [
        'clarificationOptionCount',
        'contextStepCount',
        'retrievedSourceCount',
        'originalEstimatedTokens',
        'condensedEstimatedTokens',
        'effectiveDeliveryTokenCeiling',
        'deliveryOverageTokens',
        'originalCodePoints',
        'condensedCodePoints',
        'deliveryCodePointLimit',
        'deliveryCodePointOverage',
        'condensedCodePointOverage',
    ]) {
        const value = outcome.signals?.[key];
        if (
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value >= 0
        )
            signals[key] = value;
    }
    const reviewDecision = outcome.signals?.reviewDecision;
    if (
        typeof reviewDecision === 'string' &&
        (BOUNDED_REVIEW_ASSESS_DECISIONS as readonly string[]).includes(
            reviewDecision
        )
    ) {
        signals.reviewDecision = reviewDecision;
        signals.reviewReason = '[withheld for voice privacy]';
        switch (reviewDecision) {
            case 'revise':
                signals.revisionInstruction = '[withheld for voice privacy]';
                break;
            case 'search':
                signals.searchQuery = '[withheld for voice privacy]';
                break;
        }
    }
    Object.assign(signals, projectTraceAlignmentSignals(outcome.signals));
    const artifacts = outcome.artifacts?.filter((artifact) =>
        /^candidate_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
            artifact
        )
    );
    return {
        status: outcome.status,
        summary: 'Voice execution metadata only.',
        ...(artifacts === undefined || artifacts.length === 0
            ? {}
            : { artifacts: artifacts.slice(-1) }),
        ...(Object.keys(signals).length === 0 ? {} : { signals }),
    };
};

// Provider response/error labels are free text; retain only operator-configured identities.
const projectModelLabel = (value: string | undefined): string | undefined =>
    runtimeConfig.modelProfiles.catalog.some(
        (profile) =>
            value === profile.id ||
            value === profile.providerModel ||
            value === toFootnoteModel(profile.providerModel) ||
            value === `${profile.provider}/${profile.providerModel}`
    )
        ? value
        : undefined;

const projectProviderLabel = (value: string | undefined): string | undefined =>
    runtimeConfig.modelProfiles.catalog.some(
        (profile) => value === profile.provider
    )
        ? value
        : undefined;

const projectAttemptLabels = (attempt: {
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
}) => ({
    requestedProvider: projectProviderLabel(attempt.requestedProvider),
    requestedModel: projectModelLabel(attempt.requestedModel),
    actualProvider: projectProviderLabel(attempt.actualProvider),
    actualModel: projectModelLabel(attempt.actualModel),
});

const projectAttempt = (
    attempt: WorkflowAttemptRecord
): WorkflowAttemptRecord => ({
    ...pick(attempt, [
        'attempt',
        'status',
        'startedAt',
        'finishedAt',
        'durationMs',
        'profileId',
        'usage',
        'cost',
    ]),
    ...projectAttemptLabels(attempt),
    ...(ExecutionReasonCodeSchema.safeParse(attempt.reasonCode).success
        ? { reasonCode: attempt.reasonCode }
        : {}),
    ...(attempt.terminationReason !== undefined &&
    (WORKFLOW_TERMINATION_REASONS as readonly string[]).includes(
        attempt.terminationReason
    )
        ? { terminationReason: attempt.terminationReason }
        : {}),
    ...(attempt.completion === undefined
        ? {}
        : {
              completion: pick(attempt.completion, [
                  'status',
                  'visibleTextLength',
              ]),
          }),
    ...(attempt.routingAttempts === undefined
        ? {}
        : {
              routingAttempts: attempt.routingAttempts.map((route) => ({
                  ...pick(route, [
                      'index',
                      'profileId',
                      'status',
                      'providerCallStatus',
                      'usage',
                      'cost',
                      'startedAt',
                      'finishedAt',
                      'durationMs',
                      'chooseOneUsed',
                      'chooseOneSelectedIndex',
                      'selectionSource',
                  ]),
                  ...projectAttemptLabels(route),
                  ...(route.completion === undefined
                      ? {}
                      : {
                            completion: pick(route.completion, [
                                'status',
                                'visibleTextLength',
                            ]),
                        }),
              })),
          }),
});

/** Store execution metadata without planner prose, retrieval content or debug text. */
export const projectRealtimeWorkflowMetadata = (
    metadata: ResponseMetadata,
    voice: RealtimeWorkflowScope
): ResponseMetadata => {
    const original = metadata.workflow;
    const workflow: WorkflowRecord | undefined =
        original === undefined
            ? undefined
            : {
                  ...pick(original, [
                      'runId',
                      'runStatus',
                      'startedAt',
                      'finishedAt',
                      'durationMs',
                      'workflowId',
                      'workflowName',
                      'status',
                      'terminationReason',
                      'stepCount',
                      'maxSteps',
                      'maxDurationMs',
                      'maxSearchRecoveryCycles',
                      'effectiveLimits',
                      'limitStop',
                      'results',
                  ]),
                  sessionCorrelationId: voice.sessionCorrelationId,
                  initiatingTurnId: voice.turnId,
                  steps: original.steps.map((step) => ({
                      ...pick(step, [
                          'stepId',
                          'parentStepId',
                          'attempt',
                          'stepKind',
                          'reasonCode',
                          'startedAt',
                          'finishedAt',
                          'durationMs',
                          'usage',
                          'cost',
                          'inputRefs',
                          'resultRefs',
                      ]),
                      model: projectModelLabel(step.model),
                      attempts: step.attempts?.map(projectAttempt),
                      outcome: projectOutcome(step.outcome),
                  })),
              };
    return {
        ...pick(metadata, [
            'responseId',
            'provenance',
            'safetyTier',
            'tradeoffCount',
            'licenseContext',
            'staleAfter',
            'totalDurationMs',
        ]),
        modelVersion: projectModelLabel(metadata.modelVersion) ?? 'unknown',
        // Hash the response ID, not the call transcript.
        chainHash: createHash('sha256')
            .update(metadata.responseId)
            .digest('hex')
            .slice(0, 16),
        citations: [],
        trace_target: {},
        trace_final: {},
        ...(workflow === undefined ? {} : { workflow }),
    };
};

/** Apply the same storage rules to completed answers and tool short-circuits. */
export const storeRealtimeWorkflowMetadata = async (
    metadata: ResponseMetadata,
    store: (metadata: ResponseMetadata) => Promise<void>,
    selection?: Parameters<typeof assessRealtimeFinalResponse>[2]
): Promise<void> => {
    const voice = realtimeWorkflowScope();
    if (voice === undefined)
        throw new Error('Realtime execution scope is required.');
    const finalResponse = assessRealtimeFinalResponse(
        metadata,
        voice.deliveryPolicy,
        selection
    );
    const persistenceMetadata =
        finalResponse.disposition === 'approved' && metadata.workflow
            ? {
                  ...metadata,
                  workflow: {
                      ...metadata.workflow,
                      steps: metadata.workflow.steps.map((step) =>
                          step.stepId === finalResponse.assessmentStepId
                              ? {
                                    ...step,
                                    outcome: {
                                        ...step.outcome,
                                        artifacts: [
                                            ...(step.outcome.artifacts ?? []),
                                            finalResponse.candidateId,
                                        ],
                                    },
                                }
                              : step
                      ),
                  },
              }
            : metadata;
    const projected = projectRealtimeWorkflowMetadata(
        persistenceMetadata,
        voice
    );
    const runId = projected.workflow?.runId;
    if (!projected.responseId || !runId)
        throw new Error('Realtime canonical execution receipt is unavailable.');
    let status: RealtimeWorkflowResult['status'] = 'completed';
    if (projected.workflow?.runStatus === 'failed') status = 'failed';
    else if (projected.workflow?.status === 'degraded') status = 'degraded';
    await store(projected);
    voice.recorded = {
        responseId: projected.responseId,
        runId,
        status,
        finalResponse,
    };
};
