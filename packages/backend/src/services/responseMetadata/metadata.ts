/**
 * @description: Canonical backend response metadata assembly from generation
 * facts plus runtime execution context.
 * @footnote-scope: utility
 * @footnote-module: ResponseMetadataAssembly
 * @footnote-risk: high - Metadata mistakes can misclassify provenance, TRACE chips, and execution timeline.
 * @footnote-ethics: high - Users depend on this metadata for transparency and governance trust.
 */

import crypto from 'node:crypto';
import type { ResponseMetadata, SafetyTier } from '@footnote/contracts/policy';
import { deriveReviewRuntimeSummary } from '@footnote/contracts/policy';
import { runtimeConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { resolveTradeoffCount } from '../responseMetadataHeuristics.js';
import {
    buildExecutionEvents,
    resolveProvenanceDecision,
    resolveRetrievedChipDecision,
    resolveTracePostureDecision,
} from './metadataDecisions.js';
import type {
    ResponseMetadataGenerationInput,
    ResponseMetadataRuntimeContext,
} from './types.js';

// Owns: response metadata assembly and normalization of execution metadata fields.
// Does not own: making provider calls or deciding chat policy.

/**
 * Builds canonical ResponseMetadata for trace storage and UI rendering.
 * All values are derived from control-plane context and API annotations.
 *
 * Semantics guardrail:
 * - execution/workflow are structural record surfaces for what happened.
 * - TRACE (trace_target/trace_final + optional chips) is answer-posture metadata.
 * - planner influence is represented in workflow.steps[] (stepKind=plan).
 * - steerability control influence is represented in steerabilityControls.
 * - provenance/provenanceAssessment are compact grounding classification-method
 *   metadata and may include deterministic heuristic derivation.
 */
const buildResponseMetadata = (
    generationMetadata: ResponseMetadataGenerationInput,
    runtimeContext: ResponseMetadataRuntimeContext
): ResponseMetadata => {
    const responseId = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    const chainHash = crypto
        .createHash('sha256')
        .update(runtimeContext.conversationSnapshot)
        .digest('hex')
        .substring(0, 16);
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    const citations = Array.isArray(generationMetadata.citations)
        ? generationMetadata.citations
        : [];
    const retrieval = runtimeContext.retrieval;
    const provenanceClassification = resolveProvenanceDecision(
        generationMetadata,
        runtimeContext,
        citations.length
    );
    // TODO(provenance-structural-first): Reduce heuristic dependence here by
    // preferring explicit runtime retrieval/tool evidence signals wherever they
    // are available and contract-stable.
    const provenance = provenanceClassification.provenance;
    const provenanceAssessment = provenanceClassification.assessment;
    const tradeoffCount = resolveTradeoffCount(
        generationMetadata.tradeoffCount,
        runtimeContext.plannerTemperament
    );
    // TODO(trace-lifecycle): TRACE may eventually evolve through planning /
    // workflow / review steps. If that model is added, keep canonical
    // lifecycle/history state and derive summary fields from it.
    // Current runtime stays summary-only and does not implement lifecycle.
    const tracePosture = resolveTracePostureDecision(runtimeContext);
    if (tracePosture.defaultedFinalReasonCode) {
        logger.warn(
            'TRACE target/final divergence reason code missing; defaulting to runtime_posture_adjustment.',
            {
                responseId,
            }
        );
    }
    // TRACE chips remain posture-facing summaries even when deterministically
    // derived from retrieval-context signals.
    const retrievedChipDecision = resolveRetrievedChipDecision({
        provenance,
        generationEvidenceScore: generationMetadata.evidenceScore,
        generationFreshnessScore: generationMetadata.freshnessScore,
        citationCount: citations.length,
        retrieval,
    });

    if (retrievedChipDecision.missingRetrievedChips) {
        logger.error(
            'Retrieved response metadata is missing required evidence/freshness chips.',
            {
                responseId,
                retrievalRequested: retrieval?.requested ?? false,
                retrievalUsed: retrieval?.used ?? false,
            }
        );
    }

    const safetyTier: SafetyTier = 'Low';
    const licenseContext = 'MIT + HL3';
    const execution = buildExecutionEvents(runtimeContext.executionContext);
    const evaluatorExecution = runtimeContext.executionContext?.evaluator;
    // TODO(workflow-execution-metadata): Extend execution events with lineage
    // (id/parentId), timing (startedAt/finishedAt), and per-step usage/cost
    // once multi-step workflow execution is enabled.
    const generationEventModel = execution
        .filter((event) => event.kind === 'generation')
        .at(-1)?.model;
    const reviewRuntime = deriveReviewRuntimeSummary({
        workflow: runtimeContext.workflow,
        execution,
    });

    return {
        responseId,
        provenance,
        safetyTier,
        tradeoffCount,
        chainHash,
        licenseContext,
        // TODO(workflow-execution-metadata): Remove modelVersion after metadata
        // consumers migrate to execution[] as canonical timeline authority.
        // Compatibility mirror for legacy consumers that still read only a
        // single model string.
        modelVersion:
            generationEventModel ??
            runtimeContext.modelVersion ??
            runtimeConfig.openai.defaultModel,
        staleAfter: new Date(Date.now() + ninetyDaysMs).toISOString(),
        citations,
        provenanceAssessment,
        ...(runtimeContext.totalDurationMs !== undefined && {
            totalDurationMs: runtimeContext.totalDurationMs,
        }),
        ...(execution.length > 0 && { execution }),
        ...(runtimeContext.workflow !== undefined && {
            workflow: runtimeContext.workflow,
        }),
        reviewRuntime,
        ...(runtimeContext.steerabilityControls !== undefined && {
            steerabilityControls: runtimeContext.steerabilityControls,
        }),
        ...(runtimeContext.styleRewrite !== undefined && {
            styleRewrite: runtimeContext.styleRewrite,
        }),
        ...(evaluatorExecution?.outcome !== undefined && {
            evaluator: evaluatorExecution.outcome,
        }),
        trace_target: tracePosture.traceTarget,
        trace_final: tracePosture.traceFinal,
        ...(tracePosture.traceFinalReasonCode !== undefined && {
            trace_final_reason_code: tracePosture.traceFinalReasonCode,
        }),
        ...(retrievedChipDecision.evidenceScore !== undefined && {
            evidenceScore: retrievedChipDecision.evidenceScore,
        }),
        ...(retrievedChipDecision.freshnessScore !== undefined && {
            freshnessScore: retrievedChipDecision.freshnessScore,
        }),
    };
};

export { buildResponseMetadata };
