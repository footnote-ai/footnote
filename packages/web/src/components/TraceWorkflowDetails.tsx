/**
 * @description: Presents recorded workflow Steps, subordinate Attempts, and declared result lineage.
 * @footnote-scope: web
 * @footnote-module: TraceWorkflowDetails
 * @footnote-risk: medium - Incorrect status labels can misstate recorded execution outcomes.
 * @footnote-ethics: high - Clear boundaries keep public explanations distinct from operator diagnostics.
 */
import type {
    WorkflowRecord,
    WorkflowStepKind,
} from '@footnote/contracts/policy';

type TraceWorkflowDetailsProps = {
    workflow: WorkflowRecord | null;
};

const STEP_LABELS: Record<WorkflowStepKind, string> = {
    plan: 'Planning',
    tool: 'Tool use',
    generate: 'Answer generation',
    assess: 'Assessment',
    evaluator: 'Evaluation',
    revise: 'Revision',
    presentation: 'Presentation',
    finalize: 'Finalization',
};

const STEP_STATUS_LABELS = {
    executed: 'Ran',
    skipped: 'Skipped',
    failed: 'Failed',
} as const;

const ATTEMPT_STATUS_LABELS = {
    succeeded: 'Succeeded',
    failed: 'Failed',
    rejected: 'Rejected',
} as const;

const RUN_STATUS_LABELS = {
    completed: 'Completed',
    degraded: 'Degraded',
    limited: 'Limited',
    failed: 'Failed',
    rejected: 'Rejected',
} as const;

const PUBLIC_FALLBACK_ROUTE_REASON_CODE = 'search_rerouted_to_fallback_profile';

const displayTokens = (usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}): string => {
    const tokens = [
        ['input', usage.promptTokens],
        ['output', usage.completionTokens],
        ['total', usage.totalTokens],
    ]
        .filter((entry): entry is [string, number] => entry[1] !== undefined)
        .map(([label, value]) => `${label} ${value}`);

    return tokens.length > 0 ? tokens.join(', ') : 'Unavailable';
};

const displayRefs = (
    refs: WorkflowRecord['steps'][number]['inputRefs']
): string =>
    refs === undefined
        ? 'Unavailable (not recorded)'
        : refs.length === 0
          ? 'None recorded'
          : refs.map((reference) => reference.name).join(', ');

const TraceWorkflowDetails = ({
    workflow,
}: TraceWorkflowDetailsProps): JSX.Element => (
    <article
        className="card trace-card"
        id="trace-workflow"
        aria-label="Recorded workflow"
    >
        <h2>Workflow steps</h2>
        {workflow === null ? (
            <p>
                Detailed workflow steps are not recorded for this trace. Older
                or direct runs may have no workflow record.
            </p>
        ) : (
            <>
                <p>
                    <strong>Recorded run outcome:</strong>{' '}
                    {RUN_STATUS_LABELS[workflow.runStatus ?? workflow.status]}
                </p>
                <p>
                    <strong>Run duration:</strong>{' '}
                    {workflow.durationMs === undefined
                        ? 'Unavailable (not recorded)'
                        : `${workflow.durationMs}ms`}
                </p>
                <details className="trace-details">
                    <summary>Recorded limits</summary>
                    {workflow.effectiveLimits === undefined ? (
                        <p>Unavailable (not recorded).</p>
                    ) : workflow.effectiveLimits.length === 0 ? (
                        <p>No limit details were recorded.</p>
                    ) : (
                        <ul>
                            {workflow.effectiveLimits.map((limit) => (
                                <li key={limit.key}>
                                    {limit.key}:{' '}
                                    {limit.value === undefined
                                        ? limit.state
                                        : `${limit.value} (${limit.state})`}
                                    {limit.stoppedRun
                                        ? ' — stopped this run'
                                        : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                </details>
                {workflow.steps.length === 0 ? (
                    <p>No workflow Steps were recorded.</p>
                ) : (
                    <ol className="trace-workflow-list">
                        {workflow.steps.map((step) => {
                            const isFallbackPlan =
                                step.outcome.signals?.contractType ===
                                'fallback';

                            return (
                                <li
                                    className="trace-workflow-step"
                                    key={step.stepId}
                                >
                                    <h3>
                                        {STEP_LABELS[step.stepKind]}{' '}
                                        <span>
                                            —{' '}
                                            {
                                                STEP_STATUS_LABELS[
                                                    step.outcome.status
                                                ]
                                            }
                                            {isFallbackPlan
                                                ? ' · fallback plan'
                                                : ''}
                                        </span>
                                    </h3>
                                    <p>{step.outcome.summary}</p>
                                    <details className="trace-details">
                                        <summary>Recorded Step facts</summary>
                                        <dl className="trace-details__list">
                                            <div>
                                                <dt>Model</dt>
                                                <dd>
                                                    {step.model ??
                                                        'Unavailable (not recorded)'}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>Duration</dt>
                                                <dd>
                                                    {step.durationMs ===
                                                    undefined
                                                        ? 'Unavailable (not recorded)'
                                                        : `${step.durationMs}ms`}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>Token usage</dt>
                                                <dd>
                                                    {step.usage
                                                        ? displayTokens(
                                                              step.usage
                                                          )
                                                        : 'Unavailable (not recorded)'}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>Recorded cost estimate</dt>
                                                <dd>
                                                    {step.cost === undefined
                                                        ? 'Unavailable (not recorded)'
                                                        : `$${step.cost.totalCostUsd.toFixed(6)}`}
                                                </dd>
                                            </div>
                                        </dl>
                                    </details>
                                    <p>
                                        <strong>Inputs:</strong>{' '}
                                        {displayRefs(step.inputRefs)}
                                        <br />
                                        <strong>Declared results:</strong>{' '}
                                        {displayRefs(step.resultRefs)}
                                    </p>
                                    {step.attempts === undefined ? (
                                        <p>
                                            Attempt details are unavailable (not
                                            recorded).
                                        </p>
                                    ) : step.attempts.length === 0 ? (
                                        <p>No Attempts were recorded.</p>
                                    ) : (
                                        <details className="trace-details trace-workflow-attempts">
                                            <summary>
                                                {step.attempts.length}{' '}
                                                {step.attempts.length === 1
                                                    ? 'Attempt'
                                                    : 'Attempts'}
                                                {' · '}
                                                {step.attempts.length > 1
                                                    ? 'retry history'
                                                    : 'inspect attempt facts'}
                                            </summary>
                                            <ol>
                                                {step.attempts.map(
                                                    (attempt) => (
                                                        <li
                                                            key={
                                                                attempt.attempt
                                                            }
                                                        >
                                                            <strong>
                                                                Attempt{' '}
                                                                {
                                                                    attempt.attempt
                                                                }
                                                                {attempt.attempt >
                                                                    1 &&
                                                                    ' (retry)'}
                                                                :{' '}
                                                                {
                                                                    ATTEMPT_STATUS_LABELS[
                                                                        attempt
                                                                            .status
                                                                    ]
                                                                }
                                                            </strong>
                                                            {attempt.reasonCode ===
                                                                PUBLIC_FALLBACK_ROUTE_REASON_CODE && (
                                                                <p>
                                                                    A fallback
                                                                    search
                                                                    profile was
                                                                    used.
                                                                </p>
                                                            )}
                                                            <dl className="trace-details__list">
                                                                <div>
                                                                    <dt>
                                                                        Requested
                                                                        provider
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.requestedProvider ??
                                                                            'Unavailable (not recorded)'}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt>
                                                                        Observed
                                                                        provider
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.actualProvider ??
                                                                            'Unavailable (not recorded)'}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt>
                                                                        Requested
                                                                        model
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.requestedModel ??
                                                                            'Unavailable (not recorded)'}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt>
                                                                        Observed
                                                                        model
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.actualModel ??
                                                                            'Unavailable (not recorded)'}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt>
                                                                        Duration
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.durationMs ===
                                                                        undefined
                                                                            ? 'Unavailable (not recorded)'
                                                                            : `${attempt.durationMs}ms`}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt>
                                                                        Token
                                                                        usage
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.usage
                                                                            ? displayTokens(
                                                                                  attempt.usage
                                                                              )
                                                                            : 'Unavailable (not recorded)'}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt>
                                                                        Recorded
                                                                        cost
                                                                        estimate
                                                                    </dt>
                                                                    <dd>
                                                                        {attempt.cost ===
                                                                        undefined
                                                                            ? 'Unavailable (not recorded)'
                                                                            : `$${attempt.cost.totalCostUsd.toFixed(6)}`}
                                                                    </dd>
                                                                </div>
                                                            </dl>
                                                        </li>
                                                    )
                                                )}
                                            </ol>
                                        </details>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                )}
                {workflow.results !== undefined && (
                    <details className="trace-details">
                        <summary>Result records</summary>
                        {workflow.results.length === 0 ? (
                            <p>No result records are available.</p>
                        ) : (
                            <ul>
                                {workflow.results.map((result) => (
                                    <li key={result.resultId}>
                                        {result.name}: {result.status} by Step{' '}
                                        {result.producedByStepId}, Attempt{' '}
                                        {result.producedByAttempt}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </details>
                )}
            </>
        )}
    </article>
);

export default TraceWorkflowDetails;
