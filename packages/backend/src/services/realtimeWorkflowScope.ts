/**
 * @description: Carries backend-only voice execution restrictions and projects content-free evidence.
 * @footnote-scope: core
 * @footnote-module: RealtimeWorkflowScope
 * @footnote-risk: high - Scope loss can enable tools or persist private voice content.
 * @footnote-ethics: high - Voice processing consent never authorizes retained conversation content.
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

export type RealtimeWorkflowScope = {
    sessionCorrelationId: string;
    turnId: string;
    onRunStarted: (runId: string) => void;
    actionRejected?: boolean;
    recorded?: Required<RealtimeWorkflowResult>;
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
    };
    for (const [key, allowed] of Object.entries(machineSignals)) {
        const value = outcome.signals?.[key];
        if (typeof value === 'string' && allowed.includes(value))
            signals[key] = value;
    }
    if (outcome.signals?.clarification === true) {
        signals.clarification = true;
    }
    for (const key of [
        'clarificationOptionCount',
        'contextStepCount',
        'retrievedSourceCount',
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
    return {
        status: outcome.status,
        summary: 'Voice execution metadata only.',
        ...(Object.keys(signals).length === 0 ? {} : { signals }),
    };
};

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
        'requestedProvider',
        'requestedModel',
        'actualProvider',
        'actualModel',
        'usage',
        'cost',
    ]),
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
                      'requestedProvider',
                      'requestedModel',
                      'actualProvider',
                      'actualModel',
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

/** Allowlist execution structure; summaries, queries, review prose, source bodies and debug text never cross storage. */
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
                          'model',
                          'usage',
                          'cost',
                          'inputRefs',
                          'resultRefs',
                      ]),
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
            'modelVersion',
            'staleAfter',
            'totalDurationMs',
        ]),
        // A transcript-derived hash is unnecessary for metadata-only voice inspection.
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

/** Both ordinary completion and tool short-circuits use the same content-free storage boundary. */
export const storeRealtimeWorkflowMetadata = async (
    metadata: ResponseMetadata,
    store: (metadata: ResponseMetadata) => Promise<void>
): Promise<void> => {
    const voice = realtimeWorkflowScope();
    if (voice === undefined)
        throw new Error('Realtime execution scope is required.');
    const projected = projectRealtimeWorkflowMetadata(metadata, voice);
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
    };
};
