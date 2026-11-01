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
    const selected = selection.candidates?.filter(
        (candidate) => candidate.state === 'selected'
    );
    const candidate = selected?.length === 1 ? selected[0] : undefined;
    const assessment = workflow?.steps.findLast(
        (step) => step.stepKind === 'assess'
    );
    if (!assessment) return { disposition: 'unassessed' };
    if (
        assessment.outcome.status !== 'executed' ||
        !assessment.attempts?.some((attempt) => attempt.status === 'succeeded')
    )
        return { disposition: 'assessment_failed' };
    const decision = assessment.outcome.signals?.reviewDecision;
    if (decision === 'revise') return { disposition: 'revision_requested' };
    if (decision === 'search') return { disposition: 'search_requested' };
    if (decision !== 'finalize') return { disposition: 'assessment_failed' };
    const review = workflow?.results?.find(
        (result) =>
            result.name === 'review' &&
            result.producedByStepId === assessment.stepId &&
            result.status === 'produced'
    );
    if (
        !review ||
        !assessment.resultRefs?.some(
            (ref) => ref.resultId === review.resultId && ref.name === 'review'
        )
    )
        return { disposition: 'assessment_failed' };
    const limitReason = workflow?.terminationReason;
    if (
        (workflow?.steps.some(
            (step) =>
                step.outcome.signals?.condensationOutcome === 'budget_blocked'
        ) ||
            hasUnassessedCondensationResult(workflow)) &&
        (limitReason === 'budget_exhausted_steps' ||
            limitReason === 'budget_exhausted_tokens' ||
            limitReason === 'budget_exhausted_time' ||
            limitReason === 'max_deliberation_calls_reached')
    )
        return {
            disposition: 'workflow_limit_reached',
            limitReason,
        };
    if (
        candidate?.text !== selection.message ||
        !candidate.text.trim() ||
        Buffer.byteLength(candidate.text, 'utf8') > 16 * 1024
    )
        return { disposition: 'selection_unverified' };
    const expectedProducerKind =
        candidate.stage === 'condensation'
            ? 'condense'
            : candidate.stage === 'initial_generation' ||
                candidate.stage === 'revision'
              ? 'generate'
              : undefined;
    if (expectedProducerKind === undefined)
        return { disposition: 'unsupported_response' };
    const producer = workflow?.steps.find(
        (step) => step.stepId === candidate.workflowStepId
    );
    const draft = workflow?.results?.find(
        (result) =>
            result.producedByStepId === producer?.stepId &&
            result.name === 'draft' &&
            result.status === 'produced'
    );
    if (
        producer?.stepKind !== expectedProducerKind ||
        producer.outcome.status !== 'executed' ||
        !producer.outcome.artifacts?.includes(candidate.id) ||
        !draft ||
        !producer.resultRefs?.some(
            (ref) => ref.name === 'draft' && ref.resultId === draft.resultId
        )
    )
        return { disposition: 'selection_unverified' };
    if (
        !assessment.inputRefs?.some(
            (ref) => ref.name === 'draft' && ref.resultId === draft.resultId
        ) ||
        assessment.parentStepId !== producer.stepId
    )
        return { disposition: 'selection_unverified' };
    if (candidate.stage === 'condensation') {
        const sourceCandidate = selection.candidates?.find(
            (entry) => entry.id === candidate.parentCandidateId
        );
        const producerIndex = workflow?.steps.findIndex(
            (step) => step.stepId === producer.stepId
        );
        const priorAssessment =
            producerIndex === undefined || producerIndex < 0
                ? undefined
                : workflow?.steps
                      .slice(0, producerIndex)
                      .findLast((step) => step.stepKind === 'assess');
        const sourceProducer = sourceCandidate
            ? workflow?.steps.find(
                  (step) => step.stepId === sourceCandidate.workflowStepId
              )
            : undefined;
        const sourceDraft = sourceCandidate
            ? workflow?.results?.find(
                  (result) =>
                      result.name === 'draft' &&
                      result.producedByStepId === sourceProducer?.stepId &&
                      result.status === 'produced'
              )
            : undefined;
        const sourceReview = priorAssessment
            ? workflow?.results?.find(
                  (result) =>
                      result.name === 'review' &&
                      result.producedByStepId === priorAssessment.stepId &&
                      result.status === 'produced'
              )
            : undefined;
        if (
            priorAssessment === undefined ||
            sourceCandidate === undefined ||
            sourceCandidate.sequence >= candidate.sequence ||
            sourceCandidate.state !== 'superseded' ||
            !['initial_generation', 'revision'].includes(
                sourceCandidate.stage
            ) ||
            sourceProducer?.stepKind !== 'generate' ||
            !sourceProducer.outcome.artifacts?.includes(sourceCandidate.id) ||
            sourceDraft === undefined ||
            !sourceProducer.resultRefs?.some(
                (ref) =>
                    ref.name === 'draft' &&
                    ref.resultId === sourceDraft.resultId
            ) ||
            priorAssessment.stepId !== producer.parentStepId ||
            priorAssessment.outcome.status !== 'executed' ||
            !priorAssessment.attempts?.some(
                (attempt) => attempt.status === 'succeeded'
            ) ||
            priorAssessment.outcome.signals?.reviewDecision !== 'finalize' ||
            sourceReview === undefined ||
            !priorAssessment.resultRefs?.some(
                (ref) =>
                    ref.name === 'review' &&
                    ref.resultId === sourceReview.resultId
            ) ||
            !priorAssessment.inputRefs?.some(
                (ref) =>
                    ref.name === 'draft' &&
                    ref.resultId === sourceDraft.resultId
            ) ||
            priorAssessment.parentStepId !== sourceProducer.stepId ||
            !producer.inputRefs?.some(
                (ref) =>
                    ref.name === 'draft' &&
                    ref.resultId === sourceDraft.resultId
            ) ||
            !producer.inputRefs?.some(
                (ref) =>
                    ref.name === 'review' &&
                    ref.resultId === sourceReview.resultId
            )
        )
            return { disposition: 'selection_unverified' };
    }
    if (
        !workflow?.runId ||
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

const projectOutcome = (outcome: StepOutcome): StepOutcome => {
    const signals: NonNullable<StepOutcome['signals']> = {};
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
    for (const [key, allowed] of Object.entries(machineSignals)) {
        const value = outcome.signals?.[key];
        if (typeof value === 'string' && allowed.includes(value))
            signals[key] = value;
    }
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
