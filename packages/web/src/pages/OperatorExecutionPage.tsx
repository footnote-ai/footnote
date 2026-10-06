/**
 * @description: Shows bounded facts from one backend-owned workflow execution to operators.
 * @footnote-scope: web
 * @footnote-module: OperatorExecutionPage
 * @footnote-risk: high - Rendering mistakes could expose private execution details.
 * @footnote-ethics: high - The page presents governance-sensitive operational records.
 */

import { useEffect, useState } from 'react';
import type {
    StepRecord,
    WorkflowAttemptRecord,
    WorkflowRecord,
} from '@footnote/contracts/policy';
import PublicPageLayout from '@components/PublicPageLayout';
import { Link, useParams } from 'react-router-dom';
import { getOperatorExecution, isApiClientError } from '../utils/api';

type ReadState =
    | { status: 'loading' }
    | { status: 'ready'; responseId: string; workflow: WorkflowRecord }
    | { status: 'not-found' }
    | { status: 'denied' }
    | { status: 'unavailable' };

type Cost = NonNullable<StepRecord['cost']>;
type Usage = StepRecord['usage'] | WorkflowAttemptRecord['usage'] | undefined;

const duration = (value: number | undefined): string =>
    value === undefined ? 'Unavailable' : `${value} ms`;

const usageSummary = (usage: Usage): string => {
    const counts = Object.entries(usage ?? {}).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number'
    );
    return counts.length
        ? counts.map(([name, value]) => `${name}: ${value}`).join(' · ')
        : 'Unavailable';
};

const costSummary = (cost: Cost | undefined): string =>
    cost
        ? `$${cost.totalCostUsd.toFixed(6)} · ${cost.costCompleteness ?? 'Completeness unavailable'}`
        : 'Unavailable';

const Facts = ({ items }: { items: Array<[string, string | number]> }) => (
    <dl className="operator-execution__facts">
        {items.map(([label, value]) => (
            <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
            </div>
        ))}
    </dl>
);

const Attempt = ({ attempt }: { attempt: WorkflowAttemptRecord }) => (
    <li>
        <h4>
            Attempt {attempt.attempt} · {attempt.status}
        </h4>
        <Facts
            items={[
                [
                    'Provider / model',
                    `${attempt.actualProvider ?? 'Unavailable'} / ${attempt.actualModel ?? 'Unavailable'}`,
                ],
                [
                    'Requested',
                    `${attempt.requestedProvider ?? 'Unavailable'} / ${attempt.requestedModel ?? 'Unavailable'}`,
                ],
                ['Duration (derived)', duration(attempt.durationMs)],
                [
                    'Reason',
                    attempt.reasonCode ??
                        attempt.terminationReason ??
                        'Unavailable',
                ],
                [
                    'Usage (provider/runtime reported)',
                    usageSummary(attempt.usage),
                ],
                ['Backend cost estimate', costSummary(attempt.cost)],
            ]}
        />
        {attempt.routingAttempts?.length ? (
            <details>
                <summary>
                    Routing attempts ({attempt.routingAttempts.length})
                </summary>
                <ol>
                    {attempt.routingAttempts.map((routing) => (
                        <li key={routing.index}>
                            {routing.profileId} · {routing.status} ·{' '}
                            {routing.actualProvider ??
                                routing.requestedProvider ??
                                'Provider unavailable'}{' '}
                            /{' '}
                            {routing.actualModel ??
                                routing.requestedModel ??
                                'Model unavailable'}{' '}
                            · {duration(routing.durationMs)}
                            {routing.reasonCode
                                ? ` · ${routing.reasonCode}`
                                : ''}
                        </li>
                    ))}
                </ol>
            </details>
        ) : null}
        {attempt.trustGraphTargets?.length ? (
            <details>
                <summary>
                    TrustGraph targets ({attempt.trustGraphTargets.length})
                </summary>
                <ul>
                    {attempt.trustGraphTargets.map((target) => (
                        <li
                            key={`${target.targetId}-${target.flow}-${target.collection}`}
                        >
                            {target.targetId} · {target.flow}/
                            {target.collection} · {target.outcome} ·{' '}
                            {target.reasonCode ?? 'No failure reason'} ·
                            Footnote request boundary{' '}
                            {duration(target.measurements?.requestDurationMs)} ·
                            sources{' '}
                            {target.measurements?.returnedSourceCount ??
                                'Unavailable'}{' '}
                            returned /{' '}
                            {target.measurements?.retainedSourceCount ??
                                'Unavailable'}{' '}
                            retained · response{' '}
                            {target.measurements
                                ?.responseCodeUnitsBeforeBounds ??
                                'Unavailable'}{' '}
                            /{' '}
                            {target.measurements
                                ?.responseCodeUnitsAfterBounds ??
                                'Unavailable'}{' '}
                            code units · source text{' '}
                            {target.measurements
                                ?.retainedSourceTextCodeUnitsBeforeTextBounds ??
                                'Unavailable'}{' '}
                            /{' '}
                            {target.measurements
                                ?.retainedSourceTextCodeUnitsAfterTextBounds ??
                                'Unavailable'}{' '}
                            code units before/after text bounds
                            {target.bounds?.sourcesTruncated
                                ? ' · sources truncated'
                                : ''}
                            {target.bounds?.responseTruncated
                                ? ' · response truncated'
                                : ''}
                        </li>
                    ))}
                </ul>
            </details>
        ) : null}
    </li>
);

const Step = ({
    step,
    results,
}: {
    step: StepRecord;
    results: NonNullable<WorkflowRecord['results']>;
}) => (
    <li>
        <article className="operator-execution__step">
            <h3>
                {step.stepKind} · {step.outcome.status}
            </h3>
            <Facts
                items={[
                    ['Duration (derived)', duration(step.durationMs)],
                    ['Reason', step.reasonCode ?? 'Unavailable'],
                    [
                        'Result',
                        step.resultRefs?.length
                            ? step.resultRefs
                                  .map((result) => {
                                      const record = results.find(
                                          (item) =>
                                              item.resultId === result.resultId
                                      );
                                      return `${result.name}: ${record?.status ?? 'Unavailable'}`;
                                  })
                                  .join(', ')
                            : 'Unavailable',
                    ],
                    [
                        'Usage (provider/runtime reported)',
                        usageSummary(step.usage),
                    ],
                    ['Backend cost estimate', costSummary(step.cost)],
                ]}
            />
            {step.attempts?.length ? (
                <ol className="operator-execution__attempts">
                    {step.attempts.map((attempt) => (
                        <Attempt key={attempt.attempt} attempt={attempt} />
                    ))}
                </ol>
            ) : (
                <p>Attempts: Unavailable</p>
            )}
        </article>
    </li>
);

const OperatorExecutionPage = (): JSX.Element => {
    const { responseId = '' } = useParams();
    const [readState, setReadState] = useState<ReadState>({
        status: 'loading',
    });

    useEffect(() => {
        const controller = new AbortController();
        setReadState({ status: 'loading' });
        void getOperatorExecution(responseId, controller.signal)
            .then((record) => {
                if (!controller.signal.aborted) {
                    setReadState({
                        status: 'ready',
                        responseId: record.responseId,
                        workflow: record.workflow,
                    });
                }
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                if (isApiClientError(error) && error.status === 404) {
                    setReadState({ status: 'not-found' });
                } else if (
                    isApiClientError(error) &&
                    (error.status === 401 || error.status === 403)
                ) {
                    setReadState({ status: 'denied' });
                } else {
                    setReadState({ status: 'unavailable' });
                }
            });
        return (): void => controller.abort();
    }, [responseId]);

    return (
        <PublicPageLayout>
            <main id="main-content" className="public-page__main">
                <section
                    className="operator-execution"
                    aria-labelledby="operator-execution-title"
                >
                    {readState.status === 'loading' ? (
                        <p role="status">Loading execution record…</p>
                    ) : readState.status !== 'ready' ? (
                        <>
                            <h1 id="operator-execution-title">
                                Execution report
                            </h1>
                            <p role="status">
                                {readState.status === 'denied'
                                    ? 'Operator access is required to view this execution record.'
                                    : readState.status === 'not-found'
                                      ? 'Execution record not found.'
                                      : 'Execution record is unavailable.'}
                            </p>
                            <Link to="/admin" className="button-link">
                                Admin settings
                            </Link>
                        </>
                    ) : (
                        <>
                            <header className="operator-execution__header">
                                <div>
                                    <h1 id="operator-execution-title">
                                        Execution report
                                    </h1>
                                    <p>
                                        <code>{readState.responseId}</code>
                                    </p>
                                </div>
                                <Link to="/admin" className="button-link">
                                    Admin settings
                                </Link>
                            </header>
                            <section aria-labelledby="operator-run-title">
                                <h2 id="operator-run-title">Run</h2>
                                <Facts
                                    items={[
                                        [
                                            'Run ID',
                                            readState.workflow.runId ??
                                                'Unavailable',
                                        ],
                                        [
                                            'Workflow',
                                            readState.workflow.workflowName,
                                        ],
                                        [
                                            'Status',
                                            readState.workflow.runStatus ??
                                                readState.workflow.status,
                                        ],
                                        [
                                            'Record freshness',
                                            'Unavailable from this projection',
                                        ],
                                        [
                                            'Duration (derived)',
                                            duration(
                                                readState.workflow.durationMs
                                            ),
                                        ],
                                        [
                                            'Termination',
                                            readState.workflow
                                                .terminationReason,
                                        ],
                                        [
                                            'Steps',
                                            `${readState.workflow.stepCount} of ${readState.workflow.maxSteps} maximum`,
                                        ],
                                        [
                                            'Time limit',
                                            `${readState.workflow.maxDurationMs} ms`,
                                        ],
                                    ]}
                                />
                                {readState.workflow.limitStop && (
                                    <p>
                                        Limit stop:{' '}
                                        {readState.workflow.limitStop
                                            .stoppedByLimit
                                            ? 'yes'
                                            : 'no'}
                                        {readState.workflow.limitStop
                                            .exhaustedLimitKey
                                            ? ` · ${readState.workflow.limitStop.exhaustedLimitKey}`
                                            : ''}
                                    </p>
                                )}
                                {readState.workflow.effectiveLimits && (
                                    <ul className="operator-execution__limits">
                                        {readState.workflow.effectiveLimits.map(
                                            (limit) => (
                                                <li key={limit.key}>
                                                    {limit.key}: {limit.state}
                                                    {limit.value !== undefined
                                                        ? ` · ${limit.value}`
                                                        : ''}
                                                </li>
                                            )
                                        )}
                                    </ul>
                                )}
                            </section>
                            <section aria-labelledby="operator-steps-title">
                                <h2 id="operator-steps-title">Steps</h2>
                                <ol className="operator-execution__steps">
                                    {readState.workflow.steps.map((step) => (
                                        <Step
                                            key={step.stepId}
                                            step={step}
                                            results={
                                                readState.workflow.results ?? []
                                            }
                                        />
                                    ))}
                                </ol>
                            </section>
                        </>
                    )}
                </section>
            </main>
        </PublicPageLayout>
    );
};

export default OperatorExecutionPage;
