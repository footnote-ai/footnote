/**
 * @description: Displays workflow details for a response.
 * @footnote-scope: web
 * @footnote-module: ExecutionReportPage
 * @footnote-risk: high - Rendering mistakes could expose private execution details.
 * @footnote-ethics: high - The page shows private workflow details to admins.
 */

import { useEffect, useState } from 'react';
import type {
    StepRecord,
    WorkflowAttemptRecord,
    WorkflowRecord,
} from '@footnote/contracts/policy';
import PublicPageLayout from '@components/PublicPageLayout';
import { Link, useParams } from 'react-router-dom';
import { getExecutionReport, isApiClientError } from '../utils/api';

type ReadState =
    | { status: 'loading' }
    | { status: 'ready'; responseId: string; workflow: WorkflowRecord }
    | { status: 'not-found' }
    | { status: 'denied' }
    | { status: 'unavailable' };

type Cost = NonNullable<StepRecord['cost']>;
type Usage = StepRecord['usage'] | WorkflowAttemptRecord['usage'] | undefined;
type ReadFailure = Extract<
    ReadState,
    { status: 'not-found' | 'denied' | 'unavailable' }
>['status'];

const readFailureMessages: Record<ReadFailure, string> = {
    denied: 'Admin access is required to view this execution report.',
    'not-found': 'Execution record not found.',
    unavailable: 'Execution record is unavailable.',
};

const readFailureStatus = (error: unknown): ReadFailure => {
    if (!isApiClientError(error)) return 'unavailable';
    if (error.status === 404) return 'not-found';
    if (error.status === 401 || error.status === 403) return 'denied';
    return 'unavailable';
};

const duration = (value: number | undefined): string =>
    value === undefined ? 'Unavailable' : `${value} ms`;

const usageSummary = (usage: Usage): string => {
    const values: Array<[string, number | undefined]> = [
        ['Input', usage?.promptTokens],
        ['Cached input', usage?.cachedInputTokens],
        ['Cache write', usage?.cacheWriteTokens],
        ['Output', usage?.completionTokens],
        ['Reasoning', usage?.reasoningTokens],
        ['Total', usage?.totalTokens],
    ];
    const counts = values.flatMap(([label, value]) =>
        value === undefined ? [] : [`${label} ${value}`]
    );
    return counts.length ? counts.join(' · ') : 'Unavailable';
};

const costSummary = (cost: Cost | undefined): string =>
    cost
        ? `$${cost.totalCostUsd.toFixed(6)} · ${cost.costCompleteness ?? 'Completeness unavailable'}`
        : 'Unavailable';

const Facts = ({ items }: { items: Array<[string, string | number]> }) => (
    <dl className="execution-report__facts">
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
                ['Duration', duration(attempt.durationMs)],
                [
                    'Reason',
                    attempt.reasonCode ??
                        attempt.terminationReason ??
                        'Unavailable',
                ],
                ['Token usage', usageSummary(attempt.usage)],
                ['Estimated cost', costSummary(attempt.cost)],
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
                            {target.reasonCode ?? 'No failure reason'} · Request
                            time:{' '}
                            {duration(target.measurements?.requestDurationMs)} ·
                            sources:{' '}
                            {target.measurements?.returnedSourceCount ??
                                'Unavailable'}{' '}
                            returned,{' '}
                            {target.measurements?.retainedSourceCount ??
                                'Unavailable'}{' '}
                            retained · response size:{' '}
                            {target.measurements
                                ?.responseCodeUnitsBeforeBounds ??
                                'Unavailable'}{' '}
                            /{' '}
                            {target.measurements
                                ?.responseCodeUnitsAfterBounds ??
                                'Unavailable'}{' '}
                            code units · source text size:{' '}
                            {target.measurements
                                ?.retainedSourceTextCodeUnitsBeforeTextBounds ??
                                'Unavailable'}{' '}
                            /{' '}
                            {target.measurements
                                ?.retainedSourceTextCodeUnitsAfterTextBounds ??
                                'Unavailable'}{' '}
                            code units before/after text limit
                            {target.bounds?.sourcesTruncated
                                ? ' · sources truncated'
                                : ''}
                            {target.bounds?.responseTruncated
                                ? ' · response truncated'
                                : ''}
                        </li>
                    ))}
                </ul>
                <p>
                    Request time is measured by Footnote, not TrustGraph's
                    internal processing time.
                </p>
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
        <article className="execution-report__step">
            <h3>
                {step.stepKind} · {step.outcome.status}
            </h3>
            <Facts
                items={[
                    ['Duration', duration(step.durationMs)],
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
                    ['Token usage', usageSummary(step.usage)],
                    ['Estimated cost', costSummary(step.cost)],
                ]}
            />
            {step.attempts?.length ? (
                <ol className="execution-report__attempts">
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

const ExecutionReportPage = (): JSX.Element => {
    const { responseId = '' } = useParams();
    const [readState, setReadState] = useState<ReadState>({
        status: 'loading',
    });

    useEffect(() => {
        const controller = new AbortController();
        setReadState({ status: 'loading' });
        void getExecutionReport(responseId, controller.signal)
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
                setReadState({ status: readFailureStatus(error) });
            });
        return (): void => controller.abort();
    }, [responseId]);

    return (
        <PublicPageLayout>
            <main id="main-content" className="public-page__main">
                <section
                    className="execution-report"
                    aria-labelledby="execution-report-title"
                >
                    {readState.status === 'loading' && (
                        <output>Loading execution record…</output>
                    )}
                    {readState.status !== 'loading' &&
                        readState.status !== 'ready' && (
                            <>
                                <h1 id="execution-report-title">
                                    Execution report
                                </h1>
                                <output>
                                    {readFailureMessages[readState.status]}
                                </output>
                                <Link to="/admin" className="button-link">
                                    Admin settings
                                </Link>
                            </>
                        )}
                    {readState.status === 'ready' && (
                        <>
                            <header className="execution-report__header">
                                <div>
                                    <h1 id="execution-report-title">
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
                            <section aria-labelledby="execution-run-title">
                                <h2 id="execution-run-title">Run</h2>
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
                                            'Duration',
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
                                    <ul className="execution-report__limits">
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
                            <section aria-labelledby="execution-steps-title">
                                <h2 id="execution-steps-title">Steps</h2>
                                <ol className="execution-report__steps">
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

export default ExecutionReportPage;
