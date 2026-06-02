/**
 * @description: Pure domain decisions used by backend response metadata
 * assembly.
 * @footnote-scope: utility
 * @footnote-module: ResponseMetadataDecisions
 * @footnote-risk: high - Decision drift can misclassify provenance, TRACE chips, or execution records.
 * @footnote-ethics: high - Metadata decisions shape user-visible transparency and governance records.
 */

import type {
    ExecutionEvent,
    ExecutionReasonCode,
    ExecutionStatus,
    EvaluatorExecutionReasonCode,
    GenerationExecutionReasonCode,
    PartialResponseTemperament,
    Provenance,
    ProvenanceAssessment,
    ResponseMetadata,
    ToolInvocationReasonCode,
    TraceAxisScore,
} from '@footnote/contracts/policy';
import {
    isTraceTemperamentEqual,
    TRACE_TEMPERAMENT_AXIS_KEYS,
} from '@footnote/contracts/policy';
import {
    classifyProvenanceWithSignals,
    deriveRetrievedChips,
} from '../responseMetadataHeuristics.js';
import type {
    ResponseMetadataGenerationInput,
    ResponseMetadataRuntimeContext,
} from './types.js';

type ExecutionContext = NonNullable<
    ResponseMetadataRuntimeContext['executionContext']
>;

type ProvenanceDecision = {
    provenance: Provenance;
    assessment: ProvenanceAssessment;
};

type TracePostureDecision = {
    traceTarget: PartialResponseTemperament;
    traceFinal: PartialResponseTemperament;
    traceChanged: boolean;
    traceFinalReasonCode?: ResponseMetadata['trace_final_reason_code'];
    defaultedFinalReasonCode: boolean;
};

type RetrievedChipDecision = {
    evidenceScore?: TraceAxisScore;
    freshnessScore?: TraceAxisScore;
    missingRetrievedChips: boolean;
};

export const isTraceAxisScore = (value: unknown): value is TraceAxisScore =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5;

export const normalizeResponseTemperament = (
    temperament: PartialResponseTemperament | undefined
): PartialResponseTemperament | undefined => {
    if (!temperament) {
        return undefined;
    }

    const normalized: PartialResponseTemperament = {};
    for (const axis of TRACE_TEMPERAMENT_AXIS_KEYS) {
        const score = temperament[axis];
        if (isTraceAxisScore(score)) {
            normalized[axis] = score;
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const normalizeEvaluatorReasonCode = (
    status: ExecutionStatus,
    reasonCode: ExecutionReasonCode | undefined
): EvaluatorExecutionReasonCode | undefined => {
    if (status === 'executed' || status === 'skipped') {
        return undefined;
    }

    if (reasonCode === 'evaluator_runtime_error') {
        return reasonCode;
    }

    return undefined;
};

export const normalizeGenerationReasonCode = (
    status: ExecutionStatus,
    reasonCode: ExecutionReasonCode | undefined
): GenerationExecutionReasonCode | undefined => {
    if (status === 'executed' || status === 'skipped') {
        return undefined;
    }

    if (
        reasonCode === 'generation_runtime_error' ||
        reasonCode === 'routing_chain_exhausted' ||
        reasonCode === 'routing_chain_non_transient_error'
    ) {
        return reasonCode;
    }

    return undefined;
};

export const normalizeToolReasonCode = (
    status: ExecutionStatus,
    reasonCode: ToolInvocationReasonCode | undefined
): ToolInvocationReasonCode | undefined => {
    if (
        reasonCode === 'tool_not_requested' ||
        reasonCode === 'tool_not_used' ||
        reasonCode === 'search_rerouted_to_fallback_profile' ||
        reasonCode === 'search_reroute_not_permitted_by_selection_source' ||
        reasonCode === 'search_reroute_no_tool_capable_fallback_available' ||
        reasonCode === 'tool_unavailable' ||
        reasonCode === 'tool_execution_error' ||
        reasonCode === 'tool_timeout' ||
        reasonCode === 'tool_http_error' ||
        reasonCode === 'tool_network_error' ||
        reasonCode === 'tool_invalid_response' ||
        reasonCode === 'search_not_supported_by_selected_profile' ||
        reasonCode === 'unspecified_tool_outcome'
    ) {
        return reasonCode;
    }

    if (status === 'executed') {
        return undefined;
    }

    return status === 'failed'
        ? 'tool_execution_error'
        : 'unspecified_tool_outcome';
};

export const resolveProvenanceDecision = (
    generationMetadata: ResponseMetadataGenerationInput,
    runtimeContext: ResponseMetadataRuntimeContext,
    citationCount: number
): ProvenanceDecision => {
    const retrieval = runtimeContext.retrieval;
    const classificationToolExecution = runtimeContext.executionContext?.tool;
    const retrievalToolExecuted =
        classificationToolExecution?.status === 'executed' &&
        classificationToolExecution.toolName === 'web_search';

    return classifyProvenanceWithSignals({
        assistantProvenance: generationMetadata.provenance,
        citationCount,
        retrievalRequested: retrieval?.requested ?? false,
        retrievalUsed: retrieval?.used ?? false,
        retrievalToolExecuted,
        workflowEvidence: runtimeContext.workflow !== undefined,
        trustGraphEvidenceAvailable:
            runtimeContext.trustGraphEvidenceAvailable ?? false,
        trustGraphEvidenceUsed: runtimeContext.trustGraphEvidenceUsed ?? false,
    });
};

export const resolveTracePostureDecision = (
    runtimeContext: ResponseMetadataRuntimeContext
): TracePostureDecision => {
    const traceTarget =
        normalizeResponseTemperament(runtimeContext.plannerTemperament) ?? {};
    const traceFinal =
        normalizeResponseTemperament(runtimeContext.finalTemperament) ??
        traceTarget;
    const traceChanged = !isTraceTemperamentEqual(traceTarget, traceFinal);
    const traceFinalReasonCode = traceChanged
        ? (runtimeContext.temperamentFinalizationReasonCode ??
          'runtime_posture_adjustment')
        : undefined;

    return {
        traceTarget,
        traceFinal,
        traceChanged,
        ...(traceFinalReasonCode !== undefined && {
            traceFinalReasonCode,
        }),
        defaultedFinalReasonCode:
            traceChanged &&
            runtimeContext.temperamentFinalizationReasonCode === undefined,
    };
};

export const resolveRetrievedChipDecision = (input: {
    provenance: Provenance;
    generationEvidenceScore: unknown;
    generationFreshnessScore: unknown;
    citationCount: number;
    retrieval: ResponseMetadataRuntimeContext['retrieval'];
}): RetrievedChipDecision => {
    const evidenceScore = isTraceAxisScore(input.generationEvidenceScore)
        ? input.generationEvidenceScore
        : undefined;
    const freshnessScore = isTraceAxisScore(input.generationFreshnessScore)
        ? input.generationFreshnessScore
        : undefined;
    const shouldDeriveRetrievedChips =
        input.provenance === 'Retrieved' &&
        (evidenceScore === undefined || freshnessScore === undefined);
    const derivedRetrievedChips = shouldDeriveRetrievedChips
        ? deriveRetrievedChips({
              citationCount: input.citationCount,
              intent: input.retrieval?.intent,
              contextSize: input.retrieval?.contextSize,
          })
        : undefined;
    const finalEvidenceScore =
        evidenceScore ?? derivedRetrievedChips?.evidenceScore;
    const finalFreshnessScore =
        freshnessScore ?? derivedRetrievedChips?.freshnessScore;

    return {
        ...(finalEvidenceScore !== undefined && {
            evidenceScore: finalEvidenceScore,
        }),
        ...(finalFreshnessScore !== undefined && {
            freshnessScore: finalFreshnessScore,
        }),
        missingRetrievedChips:
            input.provenance === 'Retrieved' &&
            (finalEvidenceScore === undefined ||
                finalFreshnessScore === undefined),
    };
};

export const buildExecutionEvents = (
    executionContext: ExecutionContext | undefined
): ExecutionEvent[] => {
    const execution: ExecutionEvent[] = [];
    const evaluatorExecution = executionContext?.evaluator;
    if (evaluatorExecution) {
        const normalizedEvaluatorReasonCode = normalizeEvaluatorReasonCode(
            evaluatorExecution.status,
            evaluatorExecution.reasonCode
        );
        execution.push({
            kind: 'evaluator',
            status: evaluatorExecution.status,
            ...(evaluatorExecution.outcome !== undefined && {
                evaluator: evaluatorExecution.outcome,
            }),
            ...(normalizedEvaluatorReasonCode !== undefined && {
                reasonCode: normalizedEvaluatorReasonCode,
            }),
            ...(evaluatorExecution.durationMs !== undefined && {
                durationMs: evaluatorExecution.durationMs,
            }),
        });
    }

    const toolExecution = executionContext?.tool;
    if (toolExecution) {
        const normalizedToolReasonCode = normalizeToolReasonCode(
            toolExecution.status,
            toolExecution.reasonCode
        );
        execution.push({
            kind: 'tool',
            status: toolExecution.status,
            toolName: toolExecution.toolName,
            ...(normalizedToolReasonCode !== undefined && {
                reasonCode: normalizedToolReasonCode,
            }),
            ...(toolExecution.durationMs !== undefined && {
                durationMs: toolExecution.durationMs,
            }),
        });
    }

    const generationExecution = executionContext?.generation;
    if (generationExecution) {
        const normalizedGenerationReasonCode = normalizeGenerationReasonCode(
            generationExecution.status,
            generationExecution.reasonCode
        );
        execution.push({
            kind: 'generation',
            status: generationExecution.status,
            profileId: generationExecution.profileId,
            ...(generationExecution.originalProfileId !== undefined && {
                originalProfileId: generationExecution.originalProfileId,
            }),
            ...(generationExecution.effectiveProfileId !== undefined && {
                effectiveProfileId: generationExecution.effectiveProfileId,
            }),
            provider: generationExecution.provider,
            model: generationExecution.model,
            ...(normalizedGenerationReasonCode !== undefined && {
                reasonCode: normalizedGenerationReasonCode,
            }),
            ...(generationExecution.durationMs !== undefined && {
                durationMs: generationExecution.durationMs,
            }),
        });
    }

    return execution;
};
