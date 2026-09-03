/**
 * @description: Provider-neutral input types for backend-owned response
 * metadata assembly.
 * @footnote-scope: interface
 * @footnote-module: ResponseMetadataTypes
 * @footnote-risk: medium - Type drift can desynchronize runtime facts and metadata contracts.
 * @footnote-ethics: medium - Metadata type errors can misstate provenance and TRACE posture.
 */

import type {
    GenerationSearchContextSize,
    GenerationSearchIntent,
    GenerationReasoningEffort,
    GenerationVerbosity,
} from '@footnote/agent-runtime';
import type {
    Citation,
    GenerationCompletion,
    GenerationExecutionUsage,
    ExecutionReasonCode,
    ExecutionStatus,
    EvaluatorOutcome,
    PartialResponseTemperament,
    PlannerExecutionApplyOutcome,
    PlannerExecutionContractType,
    PlannerExecutionPurpose,
    ProjectContextMetadata,
    Provenance,
    ResponseMetadata,
    SteerabilityControlId,
    ToolExecutionContext,
    WorkflowRecord,
    PresentationMetadata,
    GitHubContextMetadata,
} from '@footnote/contracts/policy';

// Owns: provider-neutral metadata assembly input contracts.
// Does not own: runtime adapter behavior, citation parsing, or metadata policy logic.

export type GenerationMetadataUsage = GenerationExecutionUsage;

export type ResponseMetadataGenerationInput = {
    model: string;
    usage?: GenerationMetadataUsage;
    finishReason?: string;
    completion?: GenerationCompletion;
    reasoningEffort?: GenerationReasoningEffort;
    verbosity?: GenerationVerbosity;
    provenance?: Provenance;
    tradeoffCount?: number;
    citations?: Citation[];
    evidenceScore?: ResponseMetadata['evidenceScore'];
    freshnessScore?: ResponseMetadata['freshnessScore'];
};

export type ResponseMetadataRetrievalContext = {
    requested: boolean;
    used: boolean;
    /**
     * Backend-confirmed evidence reached the generation prompt. This is
     * retrieval authority, not a provider-native tool-call claim.
     */
    contextUsed?: boolean;
    intent?: GenerationSearchIntent;
    contextSize?: GenerationSearchContextSize;
};

export type ResponseMetadataRuntimeContext = {
    modelVersion: string;
    conversationSnapshot: string;
    totalDurationMs?: number;
    // Planner TRACE target posture. This is answer-shape intent metadata,
    // not source-grounding or retrieval truth.
    plannerTemperament?: PartialResponseTemperament;
    // Final TRACE posture delivered by runtime. If omitted, metadata assembly
    // treats target and final as the same posture.
    finalTemperament?: PartialResponseTemperament;
    // Required when finalTemperament diverges from plannerTemperament.
    temperamentFinalizationReasonCode?: ResponseMetadata['trace_final_reason_code'];
    retrieval?: ResponseMetadataRetrievalContext;
    trustGraphEvidenceAvailable?: boolean;
    trustGraphEvidenceUsed?: boolean;
    githubContext?: GitHubContextMetadata;
    projectContext?: ProjectContextMetadata;
    executionContext?: {
        planner?: {
            status: ExecutionStatus;
            reasonCode?: ExecutionReasonCode;
            purpose: PlannerExecutionPurpose;
            contractType: PlannerExecutionContractType;
            applyOutcome: PlannerExecutionApplyOutcome;
            mattered: boolean;
            matteredControlIds: SteerabilityControlId[];
            profileId: string;
            originalProfileId?: string;
            effectiveProfileId?: string;
            provider: string;
            model: string;
            durationMs?: number;
        };
        evaluator?: {
            status: ExecutionStatus;
            reasonCode?: ExecutionReasonCode;
            outcome?: EvaluatorOutcome;
            durationMs?: number;
        };
        generation?: {
            status: ExecutionStatus;
            reasonCode?: ExecutionReasonCode;
            finishReason?: string;
            completion?: GenerationCompletion;
            usage?: GenerationExecutionUsage;
            profileId: string;
            originalProfileId?: string;
            effectiveProfileId?: string;
            provider: string;
            model: string;
            /**
             * Safe, upstream-reported attribution signals. These facts come
             * from the provider path and are not independently verified by
             * Footnote's canonical execution record.
             */
            upstreamAttribution?: {
                /** Model identifier reported by the upstream provider. */
                resolvedModel?: string;
                /** Provider that performed upstream inference. */
                inferenceProvider?: string;
                /** One-based position of this attempt in upstream routing. */
                routingAttempt?: number;
                /** Total upstream routing attempts observed for this call. */
                routingAttemptCount?: number;
                /** Cost reported by the upstream provider, in USD. */
                upstreamReportedCostUsd?: number;
            };
            durationMs?: number;
        };
        tool?: {
            toolName: ToolExecutionContext['toolName'];
            status: ToolExecutionContext['status'];
            reasonCode?: ToolExecutionContext['reasonCode'];
            durationMs?: ToolExecutionContext['durationMs'];
        };
    };
    workflow?: WorkflowRecord;
    presentation?: PresentationMetadata;
    steerabilityControls?: ResponseMetadata['steerabilityControls'];
};
