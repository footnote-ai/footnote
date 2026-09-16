/**
 * @description: Presents the shared response-footnote projection as an accessible web disclosure card.
 * @footnote-scope: web
 * @footnote-module: CanonicalResponseFootnote
 * @footnote-risk: medium - Presentation mistakes can overstate recorded provenance or artifact availability.
 * @footnote-ethics: high - The component makes evidence, controls, uncertainty, and response posture inspectable.
 */

import type { ReactNode } from 'react';
import { useId } from 'react';
import {
    formatExecutionTimelineSummary,
    projectResponseFootnote,
    RESPONSE_FOOTNOTE_SAFETY_LABELS,
    type ResponseFootnote,
    type ResponseFootnoteArtifactAvailability,
    type ResponseFootnoteArtifactState,
    type ResponseFootnoteTraceAxis,
} from '@footnote/contracts/policy';

export type CanonicalResponseFootnoteProps = {
    metadata: ResponseFootnote | null;
    artifacts: ResponseFootnoteArtifactAvailability;
};

const SVG_SIZE = 240;
const WHEEL_CENTER = 120;
const WHEEL_OUTER_RADIUS = 100;
const WHEEL_INNER_RADIUS = (6 / 19) * WHEEL_OUTER_RADIUS;
const WHEEL_BAND_COUNT = 5;
const WHEEL_BAND_GAP = (0.8 / 19) * WHEEL_OUTER_RADIUS;
const WHEEL_AXIS_COUNT = 5;
const WHEEL_BASE_START_ANGLE = (-3 * Math.PI) / 4;
const WHEEL_SLICE_ANGLE = (Math.PI * 2) / WHEEL_AXIS_COUNT;
const WHEEL_SLICE_GAP_ANGLE = 1.2 / 19;
const WHEEL_AXIS_CLASS_NAMES = [
    'tightness',
    'rationale',
    'attribution',
    'caution',
    'extent',
] as const;

const toPoint = (radius: number, angle: number): { x: number; y: number } => ({
    x: WHEEL_CENTER + Math.cos(angle) * radius,
    y: WHEEL_CENTER + Math.sin(angle) * radius,
});

const toPathNumber = (value: number): string => value.toFixed(3);

const ringSectorPath = (
    innerRadius: number,
    outerRadius: number,
    startAngle: number,
    endAngle: number
): string => {
    const outerStart = toPoint(outerRadius, startAngle);
    const outerEnd = toPoint(outerRadius, endAngle);
    const innerEnd = toPoint(innerRadius, endAngle);
    const innerStart = toPoint(innerRadius, startAngle);
    return [
        `M ${toPathNumber(outerStart.x)} ${toPathNumber(outerStart.y)}`,
        `A ${toPathNumber(outerRadius)} ${toPathNumber(outerRadius)} 0 0 1 ${toPathNumber(outerEnd.x)} ${toPathNumber(outerEnd.y)}`,
        `L ${toPathNumber(innerEnd.x)} ${toPathNumber(innerEnd.y)}`,
        `A ${toPathNumber(innerRadius)} ${toPathNumber(innerRadius)} 0 0 0 ${toPathNumber(innerStart.x)} ${toPathNumber(innerStart.y)}`,
        'Z',
    ].join(' ');
};

const sectorPath = (startAngle: number, endAngle: number): string => {
    const outerStart = toPoint(WHEEL_OUTER_RADIUS, startAngle);
    const outerEnd = toPoint(WHEEL_OUTER_RADIUS, endAngle);
    return [
        `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
        `L ${toPathNumber(outerStart.x)} ${toPathNumber(outerStart.y)}`,
        `A ${WHEEL_OUTER_RADIUS} ${WHEEL_OUTER_RADIUS} 0 0 1 ${toPathNumber(outerEnd.x)} ${toPathNumber(outerEnd.y)}`,
        'Z',
    ].join(' ');
};

const axisScore = (axis: ResponseFootnoteTraceAxis): number | null =>
    axis.final;

const axisColorClass = (index: number): string =>
    `canonical-response-footnote__axis--${WHEEL_AXIS_CLASS_NAMES[index]}`;

type SummaryIconName =
    | 'evidence'
    | 'safety'
    | 'licensing'
    | 'sources'
    | 'controls'
    | 'trace'
    | 'report';

const SummaryIcon = ({ name }: { name: SummaryIconName }): JSX.Element => {
    if (name === 'evidence' || name === 'trace') {
        return (
            <svg
                className="canonical-response-footnote__icon"
                viewBox="0 0 32 32"
                aria-hidden="true"
            >
                <path d="M8 3h11l6 6v20H8z" />
                <path d="M19 3v7h6M12 17h9M12 22h9" />
            </svg>
        );
    }
    if (name === 'safety') {
        return (
            <svg
                className="canonical-response-footnote__icon"
                viewBox="0 0 32 32"
                aria-hidden="true"
            >
                <path d="M16 3 27 7v8c0 7-4.5 11.5-11 14C9.5 26.5 5 22 5 15V7z" />
                <path d="m10.5 15.5 3.5 3.5 7-8" />
            </svg>
        );
    }
    if (name === 'licensing') {
        return (
            <svg
                className="canonical-response-footnote__icon"
                viewBox="0 0 32 32"
                aria-hidden="true"
            >
                <path d="M16 5v21M10 29h12M7 9h18M3 9l5 13H3zM29 9l-5 13h5zM11 5a5 5 0 0 1 10 0" />
            </svg>
        );
    }
    if (name === 'sources') {
        return (
            <svg
                className="canonical-response-footnote__icon"
                viewBox="0 0 32 32"
                aria-hidden="true"
            >
                <path d="M4 7c4-3 8-3 12 0v21c-4-3-8-3-12 0zM28 7c-4-3-8-3-12 0v21c4-3 8-3 12 0z" />
            </svg>
        );
    }
    if (name === 'controls') {
        return (
            <svg
                className="canonical-response-footnote__icon"
                viewBox="0 0 32 32"
                aria-hidden="true"
            >
                <path d="M4 8h24M4 16h24M4 24h24M10 5v6M22 13v6M14 21v6" />
                <circle cx="10" cy="8" r="2.5" />
                <circle cx="22" cy="16" r="2.5" />
                <circle cx="14" cy="24" r="2.5" />
            </svg>
        );
    }
    return (
        <svg
            className="canonical-response-footnote__icon"
            viewBox="0 0 32 32"
            aria-hidden="true"
        >
            <path d="M7 28V5M7 6c7-5 12 4 19-1v15c-7 5-12-4-19 1" />
        </svg>
    );
};

const toSafeExternalUrl = (value: string): string | null => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.toString()
            : null;
    } catch {
        return null;
    }
};

const renderWheel = (
    axes: ResponseFootnoteTraceAxis[],
    titleId: string,
    descriptionId: string
): JSX.Element => {
    const sectors: JSX.Element[] = [];
    const sliceGap = WHEEL_SLICE_GAP_ANGLE / 2;
    const bandThickness =
        (WHEEL_OUTER_RADIUS - WHEEL_INNER_RADIUS) / WHEEL_BAND_COUNT;

    axes.forEach((axis, index) => {
        const startAngle =
            WHEEL_BASE_START_ANGLE + index * WHEEL_SLICE_ANGLE + sliceGap;
        const endAngle =
            WHEEL_BASE_START_ANGLE + (index + 1) * WHEEL_SLICE_ANGLE - sliceGap;
        const score = axisScore(axis);
        const className = axisColorClass(index);

        if (score === null) {
            sectors.push(
                <path
                    key={`${axis.key}-missing`}
                    className={`${className} canonical-response-footnote__wheel-missing`}
                    d={sectorPath(startAngle, endAngle)}
                    aria-label={`${axis.label} unavailable`}
                />
            );
            return;
        }

        const scoreProgress = score / WHEEL_BAND_COUNT;
        for (let bandIndex = 0; bandIndex < WHEEL_BAND_COUNT; bandIndex += 1) {
            const bandStart = bandIndex / WHEEL_BAND_COUNT;
            const bandEnd = (bandIndex + 1) / WHEEL_BAND_COUNT;
            const bandInner =
                WHEEL_INNER_RADIUS +
                bandIndex * bandThickness +
                WHEEL_BAND_GAP / 2;
            const bandOuter =
                WHEEL_INNER_RADIUS +
                (bandIndex + 1) * bandThickness -
                WHEEL_BAND_GAP / 2;
            if (scoreProgress <= bandStart) {
                continue;
            }
            const bandFillFraction = Math.min(
                1,
                Math.max(0, (scoreProgress - bandStart) / (bandEnd - bandStart))
            );
            const filledOuter =
                bandInner + (bandOuter - bandInner) * bandFillFraction;
            sectors.push(
                <path
                    key={`${axis.key}-${bandIndex}`}
                    className={className}
                    d={ringSectorPath(
                        bandInner,
                        filledOuter,
                        startAngle,
                        endAngle
                    )}
                />
            );
        }
    });

    return (
        <svg
            className="canonical-response-footnote__wheel"
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
        >
            <title id={titleId}>TRACE posture wheel</title>
            <desc id={descriptionId}>
                Five-axis TRACE wheel. The filled radial level is the recorded
                final value; missing axes remain visibly unavailable.
            </desc>
            {sectors}
            <circle
                className="canonical-response-footnote__wheel-outline"
                cx={WHEEL_CENTER}
                cy={WHEEL_CENTER}
                r={WHEEL_OUTER_RADIUS}
            />
        </svg>
    );
};

const formatArtifactState = (state: ResponseFootnoteArtifactState): string => {
    switch (state) {
        case 'available':
            return 'Available';
        case 'unknown':
            return 'Availability unconfirmed';
        case 'stale':
            return 'Stored artifact may be stale';
        case 'unavailable':
            return 'Unavailable for this response';
    }
};

const ActionStatus = ({
    state,
    reason,
    unavailableLabel,
}: {
    state: ResponseFootnoteArtifactState;
    reason?: string;
    unavailableLabel?: string;
}): JSX.Element => (
    <span className="canonical-response-footnote__action-status">
        {state === 'unavailable' && unavailableLabel
            ? unavailableLabel
            : formatArtifactState(state)}
        {reason && <span className="sr-only">{reason}</span>}
    </span>
);

const SourceDetails = ({
    projection,
}: {
    projection: ReturnType<typeof projectResponseFootnote>;
}): JSX.Element => (
    <details className="canonical-response-footnote__details">
        <summary>Sources</summary>
        <div className="canonical-response-footnote__details-body">
            <p>
                {projection.summary.sources.label}:{' '}
                {projection.summary.sources.count ?? 'unavailable'}
            </p>
            <p>{projection.summary.sources.explanation}</p>
            {projection.facts?.citations.length ? (
                <ul>
                    {projection.facts.citations.map((citation, index) => {
                        const safeUrl = toSafeExternalUrl(citation.url);
                        return (
                            <li key={`${citation.url}-${index}`}>
                                {safeUrl ? (
                                    <a
                                        href={safeUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {citation.title || citation.url}
                                    </a>
                                ) : (
                                    <span>
                                        {citation.title || citation.url}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p>No recorded citations.</p>
            )}
        </div>
    </details>
);

const ControlsDetails = ({
    projection,
}: {
    projection: ReturnType<typeof projectResponseFootnote>;
}): JSX.Element => (
    <details className="canonical-response-footnote__details">
        <summary>Controls</summary>
        <div className="canonical-response-footnote__details-body">
            {projection.summary.controls.state === 'unavailable' ? (
                <p>Controls unavailable.</p>
            ) : projection.summary.controls.value?.controls.length ? (
                <ul>
                    {projection.summary.controls.value.controls.map(
                        (control) => (
                            <li key={control.controlId}>
                                <strong>{control.controlId}:</strong>{' '}
                                {control.value}
                                {control.mattered ? ' (mattered)' : ''}
                            </li>
                        )
                    )}
                </ul>
            ) : (
                <p>No recorded controls.</p>
            )}
        </div>
    </details>
);

const DetailsDisclosure = ({
    projection,
}: {
    projection: ReturnType<typeof projectResponseFootnote>;
}): JSX.Element => {
    const workflowItems = projection.facts
        ? [
              projection.facts.workflow?.runId
                  ? `Workflow ${projection.facts.workflow.runId}`
                  : null,
              projection.facts.workflow?.steps.length
                  ? `${projection.facts.workflow.steps.length} workflow steps recorded`
                  : null,
              projection.facts.execution?.length
                  ? `${projection.facts.execution.length} execution events recorded`
                  : null,
          ].filter((item): item is string => item !== null)
        : [];
    const executionSummary = projection.facts
        ? formatExecutionTimelineSummary(
              projection.facts.execution,
              projection.facts.workflow
          )
        : '';

    return (
        <details className="canonical-response-footnote__details">
            <summary>Details</summary>
            <div className="canonical-response-footnote__details-body">
                <h4>Workflow</h4>
                {!projection.facts?.workflow ? (
                    <p>Workflow details unavailable.</p>
                ) : (
                    <>
                        {workflowItems.map((item) => (
                            <p key={item}>{item}</p>
                        ))}
                        {executionSummary && <p>{executionSummary}</p>}
                        {!workflowItems.length && !executionSummary && (
                            <p>Workflow details unavailable.</p>
                        )}
                    </>
                )}
                <h4>Provenance</h4>
                {projection.facts ? (
                    <>
                        <p>Classification: {projection.facts.provenance}</p>
                        {projection.facts.provenanceAssessment ? (
                            <>
                                <p>
                                    Assessment method:{' '}
                                    {
                                        projection.facts.provenanceAssessment
                                            .methodLabel
                                    }{' '}
                                    (
                                    {
                                        projection.facts.provenanceAssessment
                                            .methodId
                                    }
                                    )
                                </p>
                                <p>
                                    Conflicts:{' '}
                                    {projection.facts.provenanceAssessment
                                        .conflicts.length > 0
                                        ? projection.facts.provenanceAssessment.conflicts.join(
                                              '; '
                                          )
                                        : 'none recorded'}
                                </p>
                                <p>
                                    Limitations:{' '}
                                    {projection.facts.provenanceAssessment
                                        .limitations.length > 0
                                        ? projection.facts.provenanceAssessment.limitations.join(
                                              '; '
                                          )
                                        : 'none recorded'}
                                </p>
                            </>
                        ) : (
                            <p>
                                Assessment method, conflicts, and limitations
                                unavailable.
                            </p>
                        )}
                    </>
                ) : (
                    <p>Provenance classification and assessment unavailable.</p>
                )}
                <h4>Safety record</h4>
                <p>
                    {RESPONSE_FOOTNOTE_SAFETY_LABELS.sensitivity}:{' '}
                    {projection.summary.safety.sensitivityTier ?? 'Unavailable'}
                </p>
                <p>
                    {RESPONSE_FOOTNOTE_SAFETY_LABELS.evaluator}:{' '}
                    {projection.summary.safety.evaluator.state === 'recorded'
                        ? `${projection.summary.safety.evaluator.authority ?? 'Unavailable'} / ${projection.summary.safety.evaluator.action ?? 'Unavailable'} / ${RESPONSE_FOOTNOTE_SAFETY_LABELS.evaluatorTier} ${projection.summary.safety.evaluator.safetyTier ?? 'Unavailable'}`
                        : 'Unavailable'}
                </p>
                {projection.trace.finalReasonCode && (
                    <p>
                        Final TRACE reason: {projection.trace.finalReasonCode}
                    </p>
                )}
                <p>TRACE describes posture, not answer quality.</p>
                {projection.summary.license.value && (
                    <p>License: {projection.summary.license.value}</p>
                )}
            </div>
        </details>
    );
};

const ActionLink = ({
    icon,
    label,
    state,
    reason,
    href,
}: {
    label: string;
    state: ResponseFootnoteArtifactState;
    reason?: string;
    href?: string;
    icon: SummaryIconName;
}): JSX.Element => {
    if (href && state !== 'unavailable') {
        return (
            <a
                className="canonical-response-footnote__action"
                href={href}
                title={reason}
            >
                <SummaryIcon name={icon} />
                <span>{label}</span>
                {state !== 'available' && (
                    <ActionStatus
                        state={state}
                        reason={reason}
                        unavailableLabel="Unavailable for this response"
                    />
                )}
            </a>
        );
    }
    return (
        <button
            className="canonical-response-footnote__action"
            type="button"
            disabled
            title={reason}
        >
            <SummaryIcon name={icon} />
            <span>{label}</span>
            <ActionStatus
                state={state}
                reason={reason}
                unavailableLabel={
                    label === 'Report'
                        ? 'Unavailable on web'
                        : 'Unavailable for this response'
                }
            />
        </button>
    );
};

const AxisRow = ({
    axis,
}: {
    axis: ResponseFootnoteTraceAxis;
}): JSX.Element => {
    const final = axis.final;
    return (
        <div
            className={`canonical-response-footnote__axis-row ${axisColorClass(WHEEL_AXIS_CLASS_NAMES.indexOf(axis.key))}`}
        >
            <div className="canonical-response-footnote__axis-copy">
                <strong>{axis.label}</strong>
                <span>{axis.description}</span>
            </div>
            <div
                className={`canonical-response-footnote__bar ${axisColorClass(WHEEL_AXIS_CLASS_NAMES.indexOf(axis.key))}`}
                role="img"
                aria-label={`${axis.label}: ${final === null ? 'unavailable' : `${final} of 5`}`}
            >
                {Array.from({ length: WHEEL_BAND_COUNT }, (_, index) => (
                    <span
                        key={index}
                        className={
                            final !== null && index < final
                                ? 'is-filled'
                                : undefined
                        }
                    />
                ))}
            </div>
            <span className="canonical-response-footnote__axis-values">
                {axis.target === null
                    ? 'Target unavailable'
                    : `Target ${axis.target}`}
                {' · '}
                {final === null ? 'Final unavailable' : `Final ${final}`}
            </span>
        </div>
    );
};

const SummaryItem = ({
    label,
    value,
    state,
}: {
    label: string;
    value: ReactNode;
    state: 'recorded' | 'partial' | 'unavailable';
}): JSX.Element => (
    <div className="canonical-response-footnote__summary-item">
        <span>{label}</span>
        <strong data-state={state}>{value}</strong>
    </div>
);

const CanonicalResponseFootnote = ({
    metadata,
    artifacts,
}: CanonicalResponseFootnoteProps): JSX.Element => {
    const projection = projectResponseFootnote({ metadata, artifacts });
    const instanceId = useId().replace(/:/g, '');
    const traceTitleId = `${instanceId}-trace-title`;
    const traceDescriptionId = `${instanceId}-trace-description`;
    const traceHref = projection.facts?.responseId
        ? `/traces/${encodeURIComponent(projection.facts.responseId)}`
        : undefined;

    return (
        <section
            className="canonical-response-footnote"
            data-state={projection.status}
            data-response-id={projection.facts?.responseId ?? undefined}
            aria-label="Response provenance and controls"
        >
            <div className="canonical-response-footnote__summary">
                <SummaryItem
                    label="Evidence"
                    value={
                        projection.summary.sources.count === null
                            ? 'Unavailable'
                            : `${projection.summary.sources.count} source${projection.summary.sources.count === 1 ? '' : 's'}`
                    }
                    state={projection.summary.sources.state}
                />
                <div className="canonical-response-footnote__summary-item canonical-response-footnote__summary-safety">
                    <SummaryItem
                        label={RESPONSE_FOOTNOTE_SAFETY_LABELS.sensitivity}
                        value={
                            projection.summary.safety.sensitivityTier ??
                            'Unavailable'
                        }
                        state={projection.summary.safety.state}
                    />
                    <SummaryItem
                        label={RESPONSE_FOOTNOTE_SAFETY_LABELS.evaluator}
                        value={
                            projection.summary.safety.evaluator.state ===
                            'recorded'
                                ? `${projection.summary.safety.evaluator.authority ?? 'Unavailable'} / ${projection.summary.safety.evaluator.action ?? 'Unavailable'} / ${RESPONSE_FOOTNOTE_SAFETY_LABELS.evaluatorTier} ${projection.summary.safety.evaluator.safetyTier ?? 'Unavailable'}`
                                : 'Unavailable'
                        }
                        state={
                            projection.summary.safety.evaluator.state ===
                            'recorded'
                                ? 'recorded'
                                : 'unavailable'
                        }
                    />
                </div>
                <SummaryItem
                    label="Licensing"
                    value={projection.summary.license.value ?? 'Unavailable'}
                    state={projection.summary.license.state}
                />
            </div>

            <div className="canonical-response-footnote__trace">
                <svg
                    className="canonical-response-footnote__connector"
                    viewBox="0 0 100 30"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <path d="M5 17 53 3 73 17" />
                    <circle cx="5" cy="17" r="2.5" />
                    <circle cx="73" cy="17" r="2.5" />
                </svg>
                {renderWheel(
                    projection.trace.axes,
                    traceTitleId,
                    traceDescriptionId
                )}
                <div className="canonical-response-footnote__axis-list">
                    {projection.trace.axes.map((axis) => (
                        <AxisRow key={axis.key} axis={axis} />
                    ))}
                </div>
            </div>

            <div className="canonical-response-footnote__disclosures">
                <SourceDetails projection={projection} />
                <ControlsDetails projection={projection} />
                <div className="canonical-response-footnote__actions">
                    <ActionLink
                        icon="trace"
                        label="Trace"
                        state={projection.actions.trace.state}
                        reason={projection.actions.trace.reason}
                        href={traceHref}
                    />
                    <ActionLink
                        icon="report"
                        label="Report"
                        state={projection.actions.report.state}
                        reason={projection.actions.report.reason}
                    />
                </div>
            </div>
            <div className="canonical-response-footnote__details-secondary">
                <DetailsDisclosure projection={projection} />
            </div>
        </section>
    );
};

export default CanonicalResponseFootnote;
