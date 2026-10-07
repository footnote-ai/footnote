/**
 * @description: Projects stored trace JSON into a safe, field-level display payload.
 * Invalid optional provenance fields are omitted and named rather than repaired.
 * @footnote-scope: core
 * @footnote-module: TraceDisplayProjection
 * @footnote-risk: high - An unsafe projection could expose malformed or sensitive trace data.
 * @footnote-ethics: high - Partial provenance must be explicit so operators do not mistake missing evidence for complete evidence.
 */
import type {
    PartialResponseTemperament,
    ResponseMetadata,
    StepOutcome,
    StepRecord,
    TraceAxisScore,
    WorkflowAttemptRecord,
    WorkflowRecord,
    WorkflowResultRecord,
    WorkflowResultReference,
} from '@footnote/contracts/policy';
import type { TraceDisplayMetadata } from '@footnote/contracts/web';
import {
    CitationSchema,
    PresentationMetadataSchema,
    ResponseMetadataSchema,
} from '@footnote/contracts/web/schemas';

const TRACE_AXES = [
    'tightness',
    'rationale',
    'attribution',
    'caution',
    'extent',
] as const;

const PUBLIC_STEP_SIGNAL_KEYS = new Set(['action', 'contractType']);
const PUBLIC_FALLBACK_ROUTE_REASON_CODE = 'search_rerouted_to_fallback_profile';

const OPTIONAL_METADATA_FIELDS = [
    'totalDurationMs',
    'provenanceAssessment',
    'workflow',
    'evaluator',
    'presentation',
] as const;

type MetadataField = (typeof OPTIONAL_METADATA_FIELDS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A GitHub source citation has no public/private visibility fact in its contract.
 * Withhold the exact citation produced for that source rather than exposing a
 * private repository path or revision through the otherwise-public title/URL.
 */
const isGitHubSourceCitation = (
    citation: { title: string; url: string },
    value: unknown
): boolean => {
    if (!isRecord(value)) return false;
    const { repository, path, resolvedRevision } = value;
    if (
        typeof repository !== 'string' ||
        typeof path !== 'string' ||
        typeof resolvedRevision !== 'string' ||
        !/^[A-Fa-f0-9]{40}$/u.test(resolvedRevision)
    ) {
        return false;
    }
    const citationUrl = `https://github.com/${repository}/blob/${resolvedRevision}/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
    return citation.title === path && citation.url === citationUrl;
};

const isTraceAxisScore = (value: unknown): value is TraceAxisScore =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5;

const projectTraceAxes = (
    value: unknown,
    unavailableFields: string[],
    fieldName: 'trace_target' | 'trace_final'
): PartialResponseTemperament => {
    if (!isRecord(value)) {
        unavailableFields.push(fieldName);
        return {};
    }

    const projected: PartialResponseTemperament = {};
    for (const axis of TRACE_AXES) {
        const axisValue = value[axis];
        if (axisValue === undefined) {
            continue;
        }
        if (isTraceAxisScore(axisValue)) {
            projected[axis] = axisValue;
        } else {
            unavailableFields.push(`${fieldName}.${axis}`);
        }
    }
    return projected;
};

const buildValidationBase = (
    responseId: string,
    target: PartialResponseTemperament,
    final: PartialResponseTemperament
): Record<string, unknown> => ({
    responseId,
    provenance: 'Inferred',
    safetyTier: 'Low',
    tradeoffCount: 0,
    chainHash: '',
    licenseContext: '',
    modelVersion: '',
    staleAfter: '',
    citations: [],
    trace_target: target,
    trace_final: final,
});

const readValidOptionalField = (
    raw: Record<string, unknown>,
    field: MetadataField,
    base: Record<string, unknown>
): unknown => {
    if (raw[field] === undefined) {
        return undefined;
    }
    const parsed = ResponseMetadataSchema.safeParse({
        ...base,
        trace_target: {},
        trace_final: {},
        [field]: raw[field],
    });
    return parsed.success ? parsed.data[field] : undefined;
};

const projectPublicOutcome = (outcome: StepOutcome): StepOutcome => ({
    status: outcome.status,
    summary: outcome.summary,
    ...(outcome.artifacts !== undefined && {
        artifacts: outcome.artifacts.map(
            (artifact) => `[redacted:${artifact.length} chars]`
        ),
    }),
    ...(outcome.signals !== undefined && {
        signals: Object.fromEntries(
            Object.entries(outcome.signals).filter(([key]) =>
                PUBLIC_STEP_SIGNAL_KEYS.has(key)
            )
        ),
    }),
});

const projectPublicAttempt = (
    attempt: WorkflowAttemptRecord
): WorkflowAttemptRecord => ({
    attempt: attempt.attempt,
    status: attempt.status,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    ...(attempt.requestedProvider !== undefined && {
        requestedProvider: attempt.requestedProvider,
    }),
    ...(attempt.requestedModel !== undefined && {
        requestedModel: attempt.requestedModel,
    }),
    ...(attempt.actualProvider !== undefined && {
        actualProvider: attempt.actualProvider,
    }),
    ...(attempt.actualModel !== undefined && {
        actualModel: attempt.actualModel,
    }),
    ...(attempt.completion !== undefined && {
        completion: { ...attempt.completion },
    }),
    // Preserve only this stable public fact; routing profiles and diagnostics stay private.
    ...(attempt.routingAttempts?.some(
        (routingAttempt) =>
            routingAttempt.reasonCode === PUBLIC_FALLBACK_ROUTE_REASON_CODE
    ) && {
        reasonCode: PUBLIC_FALLBACK_ROUTE_REASON_CODE,
    }),
    ...(attempt.usage !== undefined && {
        usage: {
            ...(attempt.usage.promptTokens !== undefined && {
                promptTokens: attempt.usage.promptTokens,
            }),
            ...(attempt.usage.cachedInputTokens !== undefined && {
                cachedInputTokens: attempt.usage.cachedInputTokens,
            }),
            ...(attempt.usage.cacheWriteTokens !== undefined && {
                cacheWriteTokens: attempt.usage.cacheWriteTokens,
            }),
            ...(attempt.usage.completionTokens !== undefined && {
                completionTokens: attempt.usage.completionTokens,
            }),
            ...(attempt.usage.totalTokens !== undefined && {
                totalTokens: attempt.usage.totalTokens,
            }),
            ...(attempt.usage.reasoningTokens !== undefined && {
                reasoningTokens: attempt.usage.reasoningTokens,
            }),
        },
    }),
    ...(attempt.cost !== undefined && {
        cost: {
            inputCostUsd: attempt.cost.inputCostUsd,
            outputCostUsd: attempt.cost.outputCostUsd,
            totalCostUsd: attempt.cost.totalCostUsd,
        },
    }),
});

const projectPublicResultReference = (
    reference: WorkflowResultReference
): WorkflowResultReference => ({
    name: reference.name,
    ...(reference.resultId !== undefined && { resultId: reference.resultId }),
    ...(reference.optional !== undefined && { optional: reference.optional }),
});

const projectPublicResult = (
    result: WorkflowResultRecord
): WorkflowResultRecord => ({
    resultId: result.resultId,
    name: result.name,
    status: result.status,
    producedByStepId: result.producedByStepId,
    producedByAttempt: result.producedByAttempt,
});

const projectPublicStep = (step: StepRecord): StepRecord => ({
    stepId: step.stepId,
    ...(step.parentStepId !== undefined && { parentStepId: step.parentStepId }),
    attempt: step.attempt,
    stepKind: step.stepKind,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    durationMs: step.durationMs,
    ...(step.model !== undefined && { model: step.model }),
    ...(step.usage !== undefined && {
        usage: {
            ...(step.usage.promptTokens !== undefined && {
                promptTokens: step.usage.promptTokens,
            }),
            ...(step.usage.cachedInputTokens !== undefined && {
                cachedInputTokens: step.usage.cachedInputTokens,
            }),
            ...(step.usage.cacheWriteTokens !== undefined && {
                cacheWriteTokens: step.usage.cacheWriteTokens,
            }),
            ...(step.usage.completionTokens !== undefined && {
                completionTokens: step.usage.completionTokens,
            }),
            ...(step.usage.totalTokens !== undefined && {
                totalTokens: step.usage.totalTokens,
            }),
            ...(step.usage.reasoningTokens !== undefined && {
                reasoningTokens: step.usage.reasoningTokens,
            }),
        },
    }),
    ...(step.cost !== undefined && {
        cost: {
            inputCostUsd: step.cost.inputCostUsd,
            outputCostUsd: step.cost.outputCostUsd,
            totalCostUsd: step.cost.totalCostUsd,
        },
    }),
    ...(step.inputRefs !== undefined && {
        inputRefs: step.inputRefs.map(projectPublicResultReference),
    }),
    ...(step.resultRefs !== undefined && {
        resultRefs: step.resultRefs.map(projectPublicResultReference),
    }),
    ...(step.attempts !== undefined && {
        attempts: step.attempts.map(projectPublicAttempt),
    }),
    outcome: projectPublicOutcome(step.outcome),
});

const projectPublicWorkflow = (workflow: WorkflowRecord): WorkflowRecord => ({
    ...(workflow.runId !== undefined && { runId: workflow.runId }),
    ...(workflow.runStatus !== undefined && { runStatus: workflow.runStatus }),
    ...(workflow.startedAt !== undefined && { startedAt: workflow.startedAt }),
    ...(workflow.finishedAt !== undefined && {
        finishedAt: workflow.finishedAt,
    }),
    ...(workflow.durationMs !== undefined && {
        durationMs: workflow.durationMs,
    }),
    workflowId: workflow.workflowId,
    workflowName: workflow.workflowName,
    status: workflow.status,
    terminationReason: workflow.terminationReason,
    stepCount: workflow.stepCount,
    maxSteps: workflow.maxSteps,
    maxDurationMs: workflow.maxDurationMs,
    ...(workflow.effectiveLimits !== undefined && {
        effectiveLimits: workflow.effectiveLimits.map((limit) => ({
            key: limit.key,
            state: limit.state,
            ...(limit.value !== undefined && { value: limit.value }),
            stoppedRun: limit.stoppedRun,
        })),
    }),
    ...(workflow.limitStop !== undefined && {
        limitStop: {
            stoppedByLimit: workflow.limitStop.stoppedByLimit,
            terminationReason: workflow.limitStop.terminationReason,
            ...(workflow.limitStop.exhaustedLimitKey !== undefined && {
                exhaustedLimitKey: workflow.limitStop.exhaustedLimitKey,
            }),
            ...(workflow.limitStop.stoppedBeforeStepKind !== undefined && {
                stoppedBeforeStepKind: workflow.limitStop.stoppedBeforeStepKind,
            }),
        },
    }),
    ...(workflow.results !== undefined && {
        results: workflow.results.map(projectPublicResult),
    }),
    ...(workflow.userMemory !== undefined && {
        userMemory: {
            includedItemCount: workflow.userMemory.includedItemCount,
        },
    }),
    steps: workflow.steps.map(projectPublicStep),
});

const projectKnownMetadata = (
    raw: Record<string, unknown>,
    unavailableFields: string[]
): Omit<TraceDisplayMetadata, 'displayIntegrity'> | null => {
    const responseId = raw.responseId;
    if (typeof responseId !== 'string' || responseId.trim().length === 0) {
        unavailableFields.push('responseId');
        return null;
    }

    const target = projectTraceAxes(
        raw.trace_target,
        unavailableFields,
        'trace_target'
    );
    const final = projectTraceAxes(
        raw.trace_final,
        unavailableFields,
        'trace_final'
    );
    const validationBase = buildValidationBase(responseId, target, final);

    const requiredCandidate = ResponseMetadataSchema.safeParse({
        ...validationBase,
        trace_target: {},
        trace_final: {},
        responseId: raw.responseId,
        provenance: raw.provenance,
        safetyTier: raw.safetyTier,
        tradeoffCount: raw.tradeoffCount,
        chainHash: raw.chainHash,
        licenseContext: raw.licenseContext,
        modelVersion: raw.modelVersion,
        staleAfter: raw.staleAfter,
    });
    if (!requiredCandidate.success) {
        for (const issue of requiredCandidate.error.issues) {
            const path = issue.path[0];
            if (typeof path === 'string' && !unavailableFields.includes(path)) {
                unavailableFields.push(path);
            }
        }
        return null;
    }

    const rawCitations = raw.citations;
    const citations: ResponseMetadata['citations'] = [];
    if (!Array.isArray(rawCitations)) {
        unavailableFields.push('citations');
    } else {
        rawCitations.forEach((citation, index) => {
            const parsedCitation = CitationSchema.safeParse(
                isRecord(citation)
                    ? { title: citation.title, url: citation.url }
                    : citation
            );
            if (parsedCitation.success) {
                if (
                    isGitHubSourceCitation(
                        parsedCitation.data,
                        raw.githubSource
                    )
                ) {
                    unavailableFields.push(`citations[${index}]`);
                    return;
                }
                citations.push(parsedCitation.data);
            } else {
                unavailableFields.push(`citations[${index}]`);
            }
        });
    }

    const projected: Record<string, unknown> = {
        responseId: raw.responseId,
        provenance: raw.provenance,
        safetyTier: raw.safetyTier,
        tradeoffCount: raw.tradeoffCount,
        chainHash: raw.chainHash,
        licenseContext: raw.licenseContext,
        modelVersion: raw.modelVersion,
        staleAfter: raw.staleAfter,
        citations,
        trace_target: target,
        trace_final: final,
    };

    for (const field of OPTIONAL_METADATA_FIELDS) {
        const value = readValidOptionalField(raw, field, {
            ...validationBase,
            citations,
        });
        if (value !== undefined) {
            projected[field] =
                field === 'workflow'
                    ? projectPublicWorkflow(value as WorkflowRecord)
                    : value;
        } else if (raw[field] !== undefined) {
            unavailableFields.push(field);
        }
    }

    if (raw.evidenceScore !== undefined) {
        if (isTraceAxisScore(raw.evidenceScore)) {
            projected.evidenceScore = raw.evidenceScore;
        } else {
            unavailableFields.push('evidenceScore');
        }
    }
    if (raw.freshnessScore !== undefined) {
        if (isTraceAxisScore(raw.freshnessScore)) {
            projected.freshnessScore = raw.freshnessScore;
        } else {
            unavailableFields.push('freshnessScore');
        }
    }
    if (raw.trace_final_reason_code !== undefined) {
        const parsed = ResponseMetadataSchema.safeParse({
            ...validationBase,
            citations,
            trace_target: target,
            trace_final: final,
            trace_final_reason_code: raw.trace_final_reason_code,
        });
        if (parsed.success) {
            projected.trace_final_reason_code = raw.trace_final_reason_code;
        } else {
            unavailableFields.push('trace_final_reason_code');
        }
    }

    return projected as Omit<TraceDisplayMetadata, 'displayIntegrity'>;
};

/**
 * Produces the public trace-read projection without mutating persisted data.
 * A valid record is still normalized through the same allowlist, so unknown
 * stored keys cannot leak prompts, response bodies, secrets, or reasoning.
 */
export const projectTraceMetadataForDisplay = (
    value: unknown,
    responseId: string
):
    | (TraceDisplayMetadata & {
          displayIntegrity: NonNullable<
              TraceDisplayMetadata['displayIntegrity']
          >;
      })
    | null => {
    if (!isRecord(value)) {
        return null;
    }

    const unavailableFields: string[] = [];
    const projected = projectKnownMetadata(value, unavailableFields);
    if (!projected || projected.responseId !== responseId) {
        return null;
    }

    return {
        ...projected,
        displayIntegrity: {
            status: unavailableFields.length > 0 ? 'partial' : 'complete',
            unavailableFields: Array.from(new Set(unavailableFields)),
        },
    };
};

/** Validates the presentation section independently for projection tests. */
export const isDisplayPresentationMetadata = (value: unknown): boolean =>
    PresentationMetadataSchema.safeParse(value).success;
