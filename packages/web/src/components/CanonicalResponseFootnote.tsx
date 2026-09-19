/**
 * @description: Presents the shared response-footnote projection as an accessible web disclosure card.
 * @footnote-scope: web
 * @footnote-module: CanonicalResponseFootnote
 * @footnote-risk: medium - Presentation mistakes can overstate recorded provenance or artifact availability.
 * @footnote-ethics: high - The component makes evidence, controls, uncertainty, and response posture inspectable.
 */

import {
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type MutableRefObject,
} from 'react';
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
    answerProvenanceEligible?: boolean;
};

const SVG_SIZE = 240;
const WHEEL_CENTER = 120;
const WHEEL_OUTER_RADIUS = 100;
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

const WHEEL_VISUAL_ORDER = [
    'tightness',
    'rationale',
    'attribution',
    'caution',
    'extent',
] as const;

type AxisKey = (typeof WHEEL_AXIS_CLASS_NAMES)[number];
const TRACE_AXIS_DISPLAY_DESCRIPTIONS: Record<AxisKey, string> = {
    tightness: 'Space efficiency',
    rationale: 'Reasoning level',
    attribution: 'Connects to sources',
    caution: 'Care attention',
    extent: 'Breadth and coverage',
};

type LayoutRect = {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
};
type MeasurableElement = { getBoundingClientRect: () => LayoutRect };
type AnchorElementRefs = Partial<Record<AxisKey, MeasurableElement | null>>;
type RowElementRefs = Partial<Record<AxisKey, MeasurableElement | null>>;

type ConnectorGeometry = {
    height: number;
    source: { x: number; y: number };
    bend: { x: number; y: number };
    target: { x: number; y: number };
    width: number;
};

const toPoint = (radius: number, angle: number): { x: number; y: number } => ({
    x: WHEEL_CENTER + Math.cos(angle) * radius,
    y: WHEEL_CENTER + Math.sin(angle) * radius,
});

const wheelSliceAngles = (index: number): { start: number; end: number } => ({
    start:
        WHEEL_BASE_START_ANGLE +
        index * WHEEL_SLICE_ANGLE +
        WHEEL_SLICE_GAP_ANGLE / 2,
    end:
        WHEEL_BASE_START_ANGLE +
        (index + 1) * WHEEL_SLICE_ANGLE -
        WHEEL_SLICE_GAP_ANGLE / 2,
});

// Anchors use the same sector geometry as the painted wheel. They sit on the
// outer edge so the measured connector always begins on the active wedge.
const wheelAnchorAngle = (index: number): number => {
    const { start, end } = wheelSliceAngles(index);
    if (index === WHEEL_VISUAL_ORDER.length - 1) {
        return start + (end - start) * 0.08;
    }
    return start + (end - start) * 0.5;
};

const toPathNumber = (value: number): string => value.toFixed(3);

const radialBandSectorPath = (
    innerRadius: number,
    outerRadius: number,
    startAngle: number,
    endAngle: number
): string => {
    const outerStart = toPoint(outerRadius, startAngle);
    const outerEnd = toPoint(outerRadius, endAngle);
    if (innerRadius === 0) {
        return [
            `M ${WHEEL_CENTER} ${WHEEL_CENTER}`,
            `L ${toPathNumber(outerStart.x)} ${toPathNumber(outerStart.y)}`,
            `A ${toPathNumber(outerRadius)} ${toPathNumber(outerRadius)} 0 0 1 ${toPathNumber(outerEnd.x)} ${toPathNumber(outerEnd.y)}`,
            `L ${WHEEL_CENTER} ${WHEEL_CENTER}`,
            'Z',
        ].join(' ');
    }
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

const axisScore = (axis: ResponseFootnoteTraceAxis): number | null =>
    axis.final;

const axisColorClass = (index: number): string =>
    `canonical-response-footnote__axis--${WHEEL_AXIS_CLASS_NAMES[index]}`;

const axisColorClassForKey = (key: string): string => {
    const axisIndex = WHEEL_AXIS_CLASS_NAMES.indexOf(
        key as (typeof WHEEL_AXIS_CLASS_NAMES)[number]
    );
    return axisColorClass(axisIndex);
};

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
    descriptionId: string,
    activeAxisKey: AxisKey | null,
    activateAxis: (axisKey: AxisKey) => void,
    resetAxis: () => void,
    anchorRefs: MutableRefObject<AnchorElementRefs>
): JSX.Element => {
    const sectors: JSX.Element[] = [];
    const separators: JSX.Element[] = [];
    const bandThickness = WHEEL_OUTER_RADIUS / WHEEL_BAND_COUNT;

    const axesByKey = new Map(axes.map((axis) => [axis.key, axis]));
    WHEEL_VISUAL_ORDER.forEach((axisKey, index) => {
        const { start: startAngle, end: endAngle } = wheelSliceAngles(index);
        const axis = axesByKey.get(axisKey);
        if (!axis) {
            return;
        }
        const score = axisScore(axis);
        const className = axisColorClassForKey(axis.key);

        for (let bandIndex = 0; bandIndex < WHEEL_BAND_COUNT; bandIndex += 1) {
            const bandInner =
                bandIndex === 0
                    ? 0
                    : bandIndex * bandThickness + WHEEL_BAND_GAP / 2;
            const bandOuter =
                (bandIndex + 1) * bandThickness - WHEEL_BAND_GAP / 2;
            sectors.push(
                <path
                    key={`${axis.key}-background-${bandIndex}`}
                    className={`${className} canonical-response-footnote__wheel-background`}
                    d={radialBandSectorPath(
                        bandInner,
                        bandOuter,
                        startAngle,
                        endAngle
                    )}
                />
            );
        }

        if (score === null) {
            sectors.push(
                <title
                    key={`${axis.key}-missing`}
                >{`${axis.label} unavailable`}</title>
            );
            return;
        }

        const scoreProgress = score / WHEEL_BAND_COUNT;
        for (let bandIndex = 0; bandIndex < WHEEL_BAND_COUNT; bandIndex += 1) {
            const bandStart = bandIndex / WHEEL_BAND_COUNT;
            const bandEnd = (bandIndex + 1) / WHEEL_BAND_COUNT;
            const bandInner =
                bandIndex === 0
                    ? 0
                    : bandIndex * bandThickness + WHEEL_BAND_GAP / 2;
            const bandOuter =
                (bandIndex + 1) * bandThickness - WHEEL_BAND_GAP / 2;
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
                    d={radialBandSectorPath(
                        bandInner,
                        filledOuter,
                        startAngle,
                        endAngle
                    )}
                />
            );
        }
    });

    WHEEL_VISUAL_ORDER.forEach((axisKey, index) => {
        const angle = WHEEL_BASE_START_ANGLE + index * WHEEL_SLICE_ANGLE;
        const inner = toPoint(0, angle);
        const outer = toPoint(WHEEL_OUTER_RADIUS, angle);
        separators.push(
            <line
                key={`${axisKey}-separator`}
                className="canonical-response-footnote__wheel-separator"
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
            />
        );
    });

    const hitAreas = WHEEL_VISUAL_ORDER.map((axisKey, index) => {
        const axis = axesByKey.get(axisKey);
        if (!axis) {
            return null;
        }
        const { start, end } = wheelSliceAngles(index);
        return (
            <g key={`${axisKey}-interaction`}>
                <circle
                    ref={(node) => {
                        anchorRefs.current[axisKey] = node;
                    }}
                    className="canonical-response-footnote__wheel-anchor"
                    cx={toPoint(WHEEL_OUTER_RADIUS, wheelAnchorAngle(index)).x}
                    cy={toPoint(WHEEL_OUTER_RADIUS, wheelAnchorAngle(index)).y}
                    r="0.5"
                    aria-hidden="true"
                />
                <path
                    className={`canonical-response-footnote__wheel-hit-area${axisKey === activeAxisKey ? ' canonical-response-footnote__wheel-hit-area--active' : ''}`}
                    d={radialBandSectorPath(0, WHEEL_OUTER_RADIUS, start, end)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Select ${axis.label} TRACE axis`}
                    data-axis-key={axisKey}
                    onPointerEnter={() => activateAxis(axisKey)}
                    onPointerLeave={resetAxis}
                    onFocus={() => activateAxis(axisKey)}
                    onBlur={resetAxis}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            activateAxis(axisKey);
                        }
                    }}
                />
            </g>
        );
    });

    return (
        <svg
            className="canonical-response-footnote__wheel"
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            role="group"
            aria-labelledby={`${titleId} ${descriptionId}`}
            data-active-axis={activeAxisKey}
        >
            <title id={titleId}>TRACE posture wheel</title>
            <desc id={descriptionId}>
                Five-axis TRACE wheel. The filled radial level is the recorded
                final value; missing axes remain visibly unavailable.
            </desc>
            {sectors}
            {separators}
            {hitAreas}
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
}: {
    state: ResponseFootnoteArtifactState;
    reason?: string;
}): JSX.Element => (
    <span className="canonical-response-footnote__action-status">
        {state === 'unavailable' && reason
            ? reason
            : formatArtifactState(state)}
        {reason && state !== 'unavailable' && (
            <span className="sr-only">{reason}</span>
        )}
    </span>
);

type DrawerId = 'sources' | 'controls' | 'trace' | 'report';

const SourcesDrawerContent = ({
    projection,
}: {
    projection: ReturnType<typeof projectResponseFootnote>;
}): JSX.Element => (
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
                                <span>{citation.title || citation.url}</span>
                            )}
                        </li>
                    );
                })}
            </ul>
        ) : (
            <p>No recorded citations.</p>
        )}
    </div>
);

const ControlsDrawerContent = ({
    projection,
}: {
    projection: ReturnType<typeof projectResponseFootnote>;
}): JSX.Element => (
    <div className="canonical-response-footnote__details-body">
        {projection.summary.controls.state === 'unavailable' ? (
            <p>Controls unavailable.</p>
        ) : projection.summary.controls.value?.controls.length ? (
            <ul>
                {projection.summary.controls.value.controls.map((control) => (
                    <li key={control.controlId}>
                        <strong>{control.controlId}:</strong> {control.value}
                        {control.mattered ? ' (mattered)' : ''}
                    </li>
                ))}
            </ul>
        ) : (
            <p>No recorded controls.</p>
        )}
        <DetailsDisclosure projection={projection} />
    </div>
);

const TraceDrawerContent = ({
    href,
    reason,
    state,
}: {
    href?: string;
    reason?: string;
    state: ResponseFootnoteArtifactState;
}): JSX.Element => (
    <div className="canonical-response-footnote__details-body">
        {state !== 'unavailable' && (
            <p>
                <ActionStatus state={state} reason={reason} />
            </p>
        )}
        <p>TRACE describes posture, not answer quality.</p>
        {state === 'available' && href && <a href={href}>Open full Trace</a>}
    </div>
);

const ReportDrawerContent = ({
    reason,
    state,
}: {
    reason?: string;
    state: ResponseFootnoteArtifactState;
}): JSX.Element => (
    <div className="canonical-response-footnote__details-body">
        {state !== 'unavailable' && (
            <>
                <p>
                    <ActionStatus state={state} reason={reason} />
                </p>
                {state === 'available' && (
                    <p>The report action is enabled for this response.</p>
                )}
            </>
        )}
    </div>
);

const DrawerButton = ({
    active,
    drawerId,
    icon,
    label,
    onClick,
    reason,
    state,
}: {
    active: boolean;
    drawerId: string;
    icon: SummaryIconName;
    label: string;
    onClick: () => void;
    reason?: string;
    state: ResponseFootnoteArtifactState;
}): JSX.Element => (
    <button
        className="canonical-response-footnote__action"
        type="button"
        disabled={state === 'unavailable'}
        aria-expanded={active}
        aria-controls={drawerId}
        onClick={onClick}
    >
        <SummaryIcon name={icon} />
        <span>{label}</span>
        {state === 'unavailable' && (
            <ActionStatus state={state} reason={reason} />
        )}
    </button>
);

const DisclosureDrawer = ({
    children,
    drawerId,
    label,
    open,
    onClose,
}: {
    children: ReactNode;
    drawerId: string;
    label: string;
    open: boolean;
    onClose: () => void;
}): JSX.Element => (
    <section
        className="canonical-response-footnote__drawer"
        id={drawerId}
        aria-labelledby={`${drawerId}-title`}
        hidden={!open}
    >
        <div className="canonical-response-footnote__drawer-header">
            <h3 id={`${drawerId}-title`}>{label}</h3>
            <button
                className="canonical-response-footnote__drawer-close"
                type="button"
                aria-label={`Close ${label} drawer`}
                onClick={onClose}
            >
                Close
            </button>
        </div>
        {children}
    </section>
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

const AxisRow = ({
    axis,
    isActive,
    activateAxis,
    resetAxis,
    rowRef,
}: {
    axis: ResponseFootnoteTraceAxis;
    isActive: boolean;
    activateAxis: (axisKey: AxisKey) => void;
    resetAxis: () => void;
    rowRef: (node: MeasurableElement | null) => void;
}): JSX.Element => {
    const final = axis.final;
    const axisKey = axis.key as AxisKey;
    const axisClassName = axisColorClass(
        WHEEL_AXIS_CLASS_NAMES.indexOf(axis.key)
    );
    const axisValueLabel = final === null ? 'unavailable' : `${final} of 5`;
    return (
        <button
            type="button"
            ref={rowRef}
            className={`canonical-response-footnote__axis-row ${axisClassName}${isActive ? ' canonical-response-footnote__axis-row--active' : ''}`}
            data-axis-key={axisKey}
            aria-pressed={isActive}
            onPointerEnter={() => activateAxis(axisKey)}
            onPointerLeave={resetAxis}
            onFocus={() => activateAxis(axisKey)}
            onBlur={resetAxis}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateAxis(axisKey);
                }
            }}
        >
            <strong className="canonical-response-footnote__axis-label">
                {axis.label}
            </strong>
            <span
                className={`canonical-response-footnote__bar ${axisClassName}`}
                role="img"
                aria-label={`${axis.label}: ${axisValueLabel}`}
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
            </span>
            <span className="canonical-response-footnote__axis-description">
                {TRACE_AXIS_DISPLAY_DESCRIPTIONS[axisKey]}
            </span>
            <span className="canonical-response-footnote__axis-values">
                {axis.target === null
                    ? 'Target unavailable'
                    : `Target ${axis.target}`}
                {' · '}
                {final === null ? 'Final unavailable' : `Final ${final}`}
            </span>
        </button>
    );
};

const TraceConnector = ({
    activeAxisKey,
    geometry,
}: {
    activeAxisKey: AxisKey | null;
    geometry: ConnectorGeometry | null;
}): JSX.Element | null => {
    if (!activeAxisKey || !geometry) {
        return null;
    }
    const path = [
        `M ${geometry.source.x.toFixed(2)} ${geometry.source.y.toFixed(2)}`,
        `L ${geometry.bend.x.toFixed(2)} ${geometry.bend.y.toFixed(2)}`,
        `L ${geometry.target.x.toFixed(2)} ${geometry.target.y.toFixed(2)}`,
    ].join(' ');
    return (
        <svg
            className="canonical-response-footnote__connector"
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            data-active-axis={activeAxisKey}
        >
            <path d={path} />
            <circle
                className="canonical-response-footnote__connector-source"
                cx={geometry.source.x}
                cy={geometry.source.y}
                r="3.4"
            />
            <circle cx={geometry.source.x} cy={geometry.source.y} r="1.25" />
            <circle cx={geometry.target.x} cy={geometry.target.y} r="2.5" />
        </svg>
    );
};

const SummaryItem = ({
    label,
    value,
    state,
    className,
}: {
    label: string;
    value: ReactNode;
    state: 'recorded' | 'partial' | 'unavailable';
    className?: string;
}): JSX.Element => {
    const summaryClassName = className
        ? `canonical-response-footnote__summary-item ${className}`
        : 'canonical-response-footnote__summary-item';
    return (
        <div className={summaryClassName}>
            <span>{label}</span>
            <strong data-state={state}>{value}</strong>
        </div>
    );
};

const CanonicalResponseFootnote = ({
    metadata,
    artifacts,
    answerProvenanceEligible,
}: CanonicalResponseFootnoteProps): JSX.Element | null => {
    const projection = projectResponseFootnote({
        metadata,
        artifacts,
        answerProvenanceEligible,
    });
    const instanceId = useId().replace(/:/g, '');
    const traceTitleId = `${instanceId}-trace-title`;
    const traceDescriptionId = `${instanceId}-trace-description`;
    const traceHref = projection.facts?.responseId
        ? `/traces/${encodeURIComponent(projection.facts.responseId)}`
        : undefined;
    const [activeAxisKey, setActiveAxisKey] = useState<AxisKey | null>(null);
    const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null);
    const [connectorGeometry, setConnectorGeometry] =
        useState<ConnectorGeometry | null>(null);
    const traceRef = useRef<HTMLDivElement>(null);
    const anchorRefs = useRef<AnchorElementRefs>({});
    const rowRefs = useRef<RowElementRefs>({});

    useLayoutEffect(() => {
        const trace = traceRef.current;
        const anchor = activeAxisKey ? anchorRefs.current[activeAxisKey] : null;
        const row = activeAxisKey ? rowRefs.current[activeAxisKey] : null;
        const wheel = trace?.querySelector(
            '.canonical-response-footnote__wheel'
        ) as MeasurableElement | null;
        if (!trace || !anchor || !row || !wheel) {
            setConnectorGeometry(null);
            return;
        }

        const updateGeometry = (): void => {
            const traceRect = trace.getBoundingClientRect();
            const anchorRect = anchor.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const wheelRect = wheel.getBoundingClientRect();
            const source = {
                x: anchorRect.left + anchorRect.width / 2 - traceRect.left,
                y: anchorRect.top + anchorRect.height / 2 - traceRect.top,
            };
            const target = {
                x: rowRect.left - traceRect.left,
                y: rowRect.top + rowRect.height / 2 - traceRect.top,
            };
            const wheelTop = wheelRect.top - traceRect.top;
            const wheelBottom = wheelRect.bottom - traceRect.top;
            const wheelMiddle = (wheelTop + wheelBottom) / 2;
            const bend = {
                x: Math.min(
                    traceRect.width - 4,
                    wheelRect.right - traceRect.left + 0.75
                ),
                y:
                    source.y <= wheelMiddle
                        ? Math.max(4, wheelTop - 4)
                        : Math.min(traceRect.height - 4, wheelBottom + 4),
            };
            setConnectorGeometry({
                height: traceRect.height,
                source,
                bend,
                target,
                width: traceRect.width,
            });
        };

        updateGeometry();
        const observer = new ResizeObserver(updateGeometry);
        observer.observe(trace);
        window.addEventListener('resize', updateGeometry);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateGeometry);
        };
    }, [activeAxisKey, projection.trace.axes.length]);

    if (answerProvenanceEligible === false) {
        return null;
    }

    const activateAxis = (axisKey: AxisKey): void => {
        setActiveAxisKey(axisKey);
    };
    const resetAxis = (): void => {
        setActiveAxisKey(null);
    };
    const toggleDrawer = (drawerId: DrawerId): void => {
        if (projection.actions[drawerId].state === 'unavailable') {
            return;
        }
        setActiveDrawer((current) => (current === drawerId ? null : drawerId));
    };
    const activeDrawerId =
        activeDrawer && projection.actions[activeDrawer].state !== 'unavailable'
            ? activeDrawer
            : null;
    const drawerDomId = (drawerId: DrawerId): string =>
        `${instanceId}-${drawerId}-drawer`;

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
                <SummaryItem
                    className="canonical-response-footnote__summary-safety"
                    label={RESPONSE_FOOTNOTE_SAFETY_LABELS.sensitivity}
                    value={
                        projection.summary.safety.sensitivityTier ??
                        'Unavailable'
                    }
                    state={projection.summary.safety.state}
                />
                <SummaryItem
                    label="Licensing"
                    value={projection.summary.license.value ?? 'Unavailable'}
                    state={projection.summary.license.state}
                />
            </div>

            <div
                ref={traceRef}
                className="canonical-response-footnote__trace"
                data-active-axis={activeAxisKey}
            >
                <TraceConnector
                    activeAxisKey={activeAxisKey}
                    geometry={connectorGeometry}
                />
                {renderWheel(
                    projection.trace.axes,
                    traceTitleId,
                    traceDescriptionId,
                    activeAxisKey,
                    activateAxis,
                    resetAxis,
                    anchorRefs
                )}
                <div className="canonical-response-footnote__axis-list">
                    {projection.trace.axes.map((axis) => (
                        <AxisRow
                            key={axis.key}
                            axis={axis}
                            isActive={axis.key === activeAxisKey}
                            activateAxis={activateAxis}
                            resetAxis={resetAxis}
                            rowRef={(node) => {
                                rowRefs.current[axis.key as AxisKey] = node;
                            }}
                        />
                    ))}
                </div>
            </div>

            <div className="canonical-response-footnote__disclosures">
                <div className="canonical-response-footnote__disclosure-actions">
                    <DrawerButton
                        active={activeDrawerId === 'sources'}
                        drawerId={drawerDomId('sources')}
                        icon="sources"
                        label="Sources"
                        onClick={() => toggleDrawer('sources')}
                        reason={projection.actions.sources.reason}
                        state={projection.actions.sources.state}
                    />
                    <DrawerButton
                        active={activeDrawerId === 'controls'}
                        drawerId={drawerDomId('controls')}
                        icon="controls"
                        label="Controls"
                        onClick={() => toggleDrawer('controls')}
                        reason={projection.actions.controls.reason}
                        state={projection.actions.controls.state}
                    />
                    <DrawerButton
                        active={activeDrawerId === 'trace'}
                        drawerId={drawerDomId('trace')}
                        icon="trace"
                        label="Trace"
                        onClick={() => toggleDrawer('trace')}
                        reason={projection.actions.trace.reason}
                        state={projection.actions.trace.state}
                    />
                    <DrawerButton
                        active={activeDrawerId === 'report'}
                        drawerId={drawerDomId('report')}
                        icon="report"
                        label="Report"
                        onClick={() => toggleDrawer('report')}
                        reason={projection.actions.report.reason}
                        state={projection.actions.report.state}
                    />
                </div>
                <DisclosureDrawer
                    drawerId={drawerDomId('sources')}
                    label="Sources"
                    open={activeDrawerId === 'sources'}
                    onClose={() => setActiveDrawer(null)}
                >
                    <SourcesDrawerContent projection={projection} />
                </DisclosureDrawer>
                <DisclosureDrawer
                    drawerId={drawerDomId('controls')}
                    label="Controls"
                    open={activeDrawerId === 'controls'}
                    onClose={() => setActiveDrawer(null)}
                >
                    <ControlsDrawerContent projection={projection} />
                </DisclosureDrawer>
                <DisclosureDrawer
                    drawerId={drawerDomId('trace')}
                    label="Trace"
                    open={activeDrawerId === 'trace'}
                    onClose={() => setActiveDrawer(null)}
                >
                    <TraceDrawerContent
                        href={
                            projection.actions.trace.state === 'available'
                                ? traceHref
                                : undefined
                        }
                        reason={projection.actions.trace.reason}
                        state={projection.actions.trace.state}
                    />
                </DisclosureDrawer>
                <DisclosureDrawer
                    drawerId={drawerDomId('report')}
                    label="Report"
                    open={activeDrawerId === 'report'}
                    onClose={() => setActiveDrawer(null)}
                >
                    <ReportDrawerContent
                        reason={projection.actions.report.reason}
                        state={projection.actions.report.state}
                    />
                </DisclosureDrawer>
            </div>
        </section>
    );
};

export default CanonicalResponseFootnote;
