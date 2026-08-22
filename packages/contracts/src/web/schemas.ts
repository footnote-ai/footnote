/**
 * @description: Validates the shared request and response payloads used by Footnote's main web-facing APIs.
 * @footnote-scope: interface
 * @footnote-module: WebContractSchemas
 * @footnote-risk: medium - Schema drift can reject valid traffic or allow invalid payloads.
 * @footnote-ethics: medium - Validation quality affects provenance clarity and user trust.
 */

import { z } from 'zod';
import {
    BOUNDED_REVIEW_ASSESS_DECISIONS,
    TRACE_ASSESS_FINAL_TEMPERAMENT_SIGNAL_KEYS,
    TRACE_TEMPERAMENT_AXIS_KEYS,
    isTraceTemperamentEqual,
    WORKFLOW_LIMIT_KEYS,
    WORKFLOW_LIMIT_STATES,
    REVIEW_RUNTIME_LABELS,
    WORKFLOW_STEP_KINDS,
    WORKFLOW_STEP_STATUSES,
    WORKFLOW_TERMINATION_REASONS,
    type ExecutionEvent,
    type ImageGenerationMetadata,
    type GitHubContextMetadata,
    type ProjectContextMetadata,
    type ProvenanceAssessment,
    type ResponseMetadata,
    type SteerabilityControls,
    type TraceAxisScore,
    type TrustGraphMetadata,
} from '../policy/index.js';
import { SafetyDecisionSchema } from '../policy/schemas.js';
import type { ApiResponseValidationResult } from './client-core.js';
import type {
    GetTraceResponse,
    GetTraceStaleResponse,
    PostChatResponse,
} from './types.js';
import {
    internalImageRenderModels,
    internalImageTextModels,
    supportedImageOutputFormats,
    supportedReasoningEfforts,
} from '../providers.js';

const ProvenanceSchema = z.enum(['Retrieved', 'Inferred', 'Speculative']);
const SafetyTierSchema = z.enum(['Low', 'Medium', 'High']);
const IncidentStatusSchema = z.enum([
    'new',
    'under_review',
    'confirmed',
    'dismissed',
    'resolved',
]);
const IncidentAuditActionSchema = z.enum([
    'incident.created',
    'incident.remediated',
    'incident.status_changed',
    'incident.note_added',
]);
const IncidentRemediationStateSchema = z.enum([
    'pending',
    'applied',
    'already_marked',
    'skipped_not_assistant',
    'failed',
]);
const ChatSurfaceSchema = z.enum(['web', 'discord']);
const ChatTriggerKindSchema = z.enum([
    'submit',
    'direct',
    'invoked',
    'alias_candidate',
    'catchup',
]);
const ChatAddressingEvidenceSchema = z
    .object({
        assistantMentioned: z.boolean(),
        replyToAssistant: z.boolean(),
        otherParticipantMentioned: z.boolean(),
        replyToOtherParticipant: z.boolean(),
    })
    .strict();
const ChatPersonaIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const ChatModeIdSchema = z.enum(['express', 'balanced', 'grounded']);
const ChatConversationMessageSchema = z
    .object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1),
        authorName: z.string().min(1).optional(),
        authorId: z.string().min(1).optional(),
        messageId: z.string().min(1).optional(),
        createdAt: z.string().min(1).optional(),
    })
    .strict();
const ChatAttachmentSchema = z
    .object({
        kind: z.enum(['image', 'file']),
        url: z.string().url(),
        contentType: z.string().min(1).optional(),
    })
    .strict();
const ChatCapabilitiesSchema = z
    .object({
        canReact: z.boolean(),
        canGenerateImages: z.boolean(),
        canUseTts: z.boolean(),
    })
    .strict();
const ChatImageRequestSchema = z
    .object({
        prompt: z.string().min(1),
        aspectRatio: z
            .enum(['auto', 'square', 'portrait', 'landscape'])
            .optional(),
        background: z.string().min(1).optional(),
        quality: z.enum(['low', 'medium', 'high', 'auto']).optional(),
        style: z.string().min(1).optional(),
        allowPromptAdjustment: z.boolean().optional(),
        followUpResponseId: z.string().min(1).optional(),
        outputFormat: z.enum(['png', 'webp', 'jpeg']).optional(),
        outputCompression: z.number().int().min(1).max(100).optional(),
    })
    .strict();
export const InternalNewsItemSchema = z
    .object({
        title: z.string().min(1),
        summary: z.string().min(1),
        url: z.string().url(),
        source: z.string().min(1),
        timestamp: z.string().datetime().optional(),
        thumbnail: z.string().url().nullable().optional(),
        image: z.string().url().nullable().optional(),
    })
    .strict();

/**
 * Shared citation schema used in reflect/traces metadata payloads.
 */
export const CitationSchema = z
    .object({
        title: z.string(),
        url: z.string().url(),
        snippet: z.string().optional(),
    })
    .strict();

/**
 * TRACE temperament profile:
 * - [T]ightness: concision and structural efficiency
 * - [R]ationale: amount of visible rationale and trade-off explanation
 * - [A]ttribution: clarity of sourced vs inferred boundaries
 * - [C]aution: safeguard posture and overclaim restraint
 * - [E]xtent: breadth of viable options and perspectives
 *
 * We use literal values (1..5) instead of a broad number schema so Zod output
 * matches the TraceAxisScore contract type exactly.
 */
const TraceAxisScoreSchema: z.ZodType<TraceAxisScore> = z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
]);

const ResponseTemperamentSchema = z
    .object({
        tightness: TraceAxisScoreSchema,
        rationale: TraceAxisScoreSchema,
        attribution: TraceAxisScoreSchema,
        caution: TraceAxisScoreSchema,
        extent: TraceAxisScoreSchema,
    })
    .strict();
const PartialResponseTemperamentSchema = ResponseTemperamentSchema.partial();
const TraceFinalizationReasonCodeSchema = z.enum([
    'runtime_posture_adjustment',
    'assess_trace_misalignment',
]);
const ExecutionStatusSchema = z.enum(WORKFLOW_STEP_STATUSES);
const ExecutionReasonCodeSchema = z.enum([
    'planner_runtime_error',
    'planner_invalid_output',
    'evaluator_runtime_error',
    'generation_runtime_error',
    'presentation_finalized',
    'presentation_fallback',
    'tool_not_requested',
    'tool_not_used',
    'search_rerouted_to_fallback_profile',
    'search_reroute_not_permitted_by_selection_source',
    'search_reroute_no_tool_capable_fallback_available',
    'tool_unavailable',
    'tool_execution_error',
    'tool_timeout',
    'tool_http_error',
    'tool_network_error',
    'tool_invalid_response',
    'location_not_resolved',
    'search_not_supported_by_selected_profile',
    'unspecified_tool_outcome',
    'routing_chain_exhausted',
    'routing_chain_entry_ineligible',
    'routing_chain_transient_error',
    'routing_chain_non_transient_error',
]);
const PlannerExecutionReasonCodeSchema = z.enum([
    'planner_runtime_error',
    'planner_invalid_output',
]);
const PlannerExecutionPurposeSchema = z.enum([
    'chat_orchestrator_action_selection',
]);
const PlannerExecutionContractTypeSchema = z.enum([
    'structured',
    'text_json',
    'fallback',
]);
const PlannerExecutionApplyOutcomeSchema = z.enum([
    'applied',
    'adjusted_by_policy',
    'not_applied',
]);
const SteerabilityControlIdSchema = z.enum([
    'workflow_mode',
    'evidence_strictness',
    'review_intensity',
    'provider_preference',
    'persona_tone_overlay',
    'tool_allowance',
]);
const PlannerMatteredControlIdSchema = SteerabilityControlIdSchema;
const EvaluatorExecutionReasonCodeSchema = z.enum(['evaluator_runtime_error']);
const GenerationExecutionReasonCodeSchema = z.enum([
    'generation_runtime_error',
    'routing_chain_exhausted',
    'routing_chain_non_transient_error',
]);
const ToolExecutionReasonCodeSchema = z.enum([
    'tool_not_requested',
    'tool_not_used',
    'search_rerouted_to_fallback_profile',
    'search_reroute_not_permitted_by_selection_source',
    'search_reroute_no_tool_capable_fallback_available',
    'tool_unavailable',
    'tool_execution_error',
    'tool_timeout',
    'tool_http_error',
    'tool_network_error',
    'tool_invalid_response',
    'search_not_supported_by_selected_profile',
    'unspecified_tool_outcome',
]);
const EvaluatorAuthorityLevelSchema = z.enum([
    'observe',
    'influence',
    'enforce',
]);
const EvaluatorDecisionModeSchema = z.enum(['observe_only', 'enforced']);
const EvaluatorOutcomeSchema = z
    .object({
        authorityLevel: EvaluatorAuthorityLevelSchema.optional(),
        mode: EvaluatorDecisionModeSchema,
        provenance: ProvenanceSchema,
        safetyDecision: SafetyDecisionSchema,
    })
    .superRefine((value, context) => {
        if (value.authorityLevel === undefined) {
            return;
        }

        if (value.mode === 'enforced' && value.authorityLevel !== 'enforce') {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['authorityLevel'],
                message:
                    'authorityLevel must be "enforce" when mode is "enforced".',
            });
        }

        if (
            value.mode === 'observe_only' &&
            value.authorityLevel === 'enforce'
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['authorityLevel'],
                message:
                    'authorityLevel cannot be "enforce" when mode is "observe_only".',
            });
        }
    })
    .strict();
const ProfileExecutionShape = {
    originalProfileId: z.string().min(1).optional(),
    effectiveProfileId: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
} as const;

const requireReasonCodeWhenNotExecuted = (
    value: {
        status: z.infer<typeof ExecutionStatusSchema>;
        reasonCode?: string;
    },
    context: z.RefinementCtx
): void => {
    if (
        (value.status === 'skipped' || value.status === 'failed') &&
        !value.reasonCode
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
                'reasonCode is required when execution status is skipped or failed.',
        });
    }
};

const PlannerExecutionEventSchema = z
    .object({
        kind: z.literal('planner'),
        status: ExecutionStatusSchema,
        ...ProfileExecutionShape,
        purpose: PlannerExecutionPurposeSchema,
        contractType: PlannerExecutionContractTypeSchema,
        applyOutcome: PlannerExecutionApplyOutcomeSchema,
        mattered: z.boolean(),
        matteredControlIds: z.array(PlannerMatteredControlIdSchema),
        reasonCode: PlannerExecutionReasonCodeSchema.optional(),
        durationMs: z.number().int().nonnegative().optional(),
    })
    .superRefine(requireReasonCodeWhenNotExecuted)
    .strict();

const EvaluatorExecutionEventSchema = z
    .object({
        kind: z.literal('evaluator'),
        status: ExecutionStatusSchema,
        evaluator: EvaluatorOutcomeSchema.optional(),
        reasonCode: EvaluatorExecutionReasonCodeSchema.optional(),
        durationMs: z.number().int().nonnegative().optional(),
    })
    .superRefine(requireReasonCodeWhenNotExecuted)
    .strict();

const ToolExecutionEventSchema = z
    .object({
        kind: z.literal('tool'),
        status: ExecutionStatusSchema,
        toolName: z.string().min(1),
        reasonCode: ToolExecutionReasonCodeSchema.optional(),
        durationMs: z.number().int().nonnegative().optional(),
    })
    .superRefine(requireReasonCodeWhenNotExecuted)
    .strict();

const GenerationExecutionEventSchema = z
    .object({
        kind: z.literal('generation'),
        status: ExecutionStatusSchema,
        ...ProfileExecutionShape,
        reasonCode: GenerationExecutionReasonCodeSchema.optional(),
        durationMs: z.number().int().nonnegative().optional(),
    })
    .superRefine(requireReasonCodeWhenNotExecuted)
    .strict();

const PresentationReasonCodeSchema = z.enum([
    'finalized',
    'evidence_repaired',
    'presentation_repaired',
    'audit_unavailable',
    'audit_invalid',
    'presentation_repair_unavailable',
    'evidence_repair_unavailable',
    'disabled',
    'profile_not_configured',
    'structured_output',
    'mechanical_preservation_failed',
    'trace_caution_high',
    'draft_timeout',
    'draft_provider_error',
    'finalizer_timeout',
    'finalizer_provider_error',
]);

export const PresentationMetadataSchema = z
    .object({
        step: z.literal('presentation'),
        outcome: z.enum([
            'finalized',
            'finalized_after_evidence_repair',
            'finalized_after_presentation_repair',
            'finalized_with_audit_unavailable',
            'fallback',
        ]),
        attempted: z.boolean(),
        reasonCode: PresentationReasonCodeSchema,
        personaId: z.string().min(1),
        draftProfileId: z.string().min(1).optional(),
        draftRequestedProvider: z.string().min(1).optional(),
        draftRequestedModel: z.string().min(1).optional(),
        draftModel: z.string().min(1).optional(),
        auditProfileId: z.string().min(1).optional(),
        auditProvider: z.string().min(1).optional(),
        auditModel: z.string().min(1).optional(),
        upstreamInferenceProvider: z.string().min(1).optional(),
        upstreamResolvedModel: z.string().min(1).optional(),
        upstreamRoutingAttempt: z.number().int().positive().optional(),
        upstreamRoutingAttemptCount: z.number().int().positive().optional(),
        backendEstimatedCostUsd: z.number().nonnegative().optional(),
        upstreamReportedCostUsd: z.number().nonnegative().optional(),
        durationMs: z.number().int().nonnegative().optional(),
        auditOutcome: z.enum([
            'not_attempted',
            'clear',
            'evidence_issue',
            'presentation_flattened',
            'invalid',
        ]),
        auditFailureCategory: z
            .enum([
                'timeout',
                'provider_failure',
                'invalid_structured_output',
                'unavailable',
            ])
            .optional(),
        draftAttemptCount: z.union([z.literal(0), z.literal(1)]),
        finalizerAttemptCount: z.union([
            z.literal(0),
            z.literal(1),
            z.literal(2),
        ]),
        auditAttemptCount: z.union([z.literal(0), z.literal(1)]),
        draftHmacId: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
        finalHmacId: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
        styledDraftRetentionRatio: z.number().min(0).max(1).optional(),
        caution: z
            .union([
                z.literal(1),
                z.literal(2),
                z.literal(3),
                z.literal(4),
                z.literal(5),
            ])
            .optional(),
        intensity: z.enum(['standard', 'restrained', 'skipped']),
        traceConstrained: z.boolean(),
    })
    .strict();

const ExecutionEventSchema: z.ZodType<ExecutionEvent> = z.discriminatedUnion(
    'kind',
    [
        PlannerExecutionEventSchema,
        EvaluatorExecutionEventSchema,
        ToolExecutionEventSchema,
        GenerationExecutionEventSchema,
    ]
);

const StepOutcomeSchema = z
    .object({
        status: z.enum(WORKFLOW_STEP_STATUSES),
        summary: z.string().min(1),
        artifacts: z.array(z.string()).optional(),
        signals: z
            .record(
                z.string(),
                z.union([z.string(), z.number(), z.boolean(), z.null()])
            )
            .optional(),
        recommendations: z.array(z.string()).optional(),
    })
    .strict();

type StepSignalRecord = Record<string, string | number | boolean | null>;

const hasSignalKey = (
    signals: StepSignalRecord | undefined,
    key: string
): boolean =>
    signals !== undefined && Object.prototype.hasOwnProperty.call(signals, key);

const addSignalIssue = (
    context: z.RefinementCtx,
    key: string,
    message: string
): void => {
    context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome', 'signals', key],
        message,
    });
};

const validatePlannerStepSignals = (
    signals: StepSignalRecord | undefined,
    context: z.RefinementCtx
): void => {
    if (!PlannerExecutionPurposeSchema.safeParse(signals?.purpose).success) {
        addSignalIssue(
            context,
            'purpose',
            'plan steps must include a valid purpose signal.'
        );
    }

    if (
        !PlannerExecutionContractTypeSchema.safeParse(signals?.contractType)
            .success
    ) {
        addSignalIssue(
            context,
            'contractType',
            'plan steps must include a valid contractType signal.'
        );
    }

    if (
        !PlannerExecutionApplyOutcomeSchema.safeParse(signals?.applyOutcome)
            .success
    ) {
        addSignalIssue(
            context,
            'applyOutcome',
            'plan steps must include a valid applyOutcome signal.'
        );
    }
};

const validateRoutingChainSignals = (
    signals: StepSignalRecord | undefined,
    context: z.RefinementCtx
): void => {
    const hasAttemptCount = hasSignalKey(signals, 'routingChainAttemptCount');
    const hasAttemptsJson = hasSignalKey(signals, 'routingChainAttemptsJson');

    if (!hasAttemptCount && !hasAttemptsJson) {
        return;
    }

    const attemptCount = signals?.routingChainAttemptCount;
    const attemptsJson = signals?.routingChainAttemptsJson;

    if (
        typeof attemptCount !== 'number' ||
        !Number.isInteger(attemptCount) ||
        attemptCount < 0
    ) {
        addSignalIssue(
            context,
            'routingChainAttemptCount',
            'routingChainAttemptCount must be a nonnegative integer when routing chain signals are present.'
        );
    }

    if (typeof attemptsJson !== 'string' || attemptsJson.trim().length === 0) {
        addSignalIssue(
            context,
            'routingChainAttemptsJson',
            'routingChainAttemptsJson must be a non-empty JSON array string when routing chain signals are present.'
        );
        return;
    }

    try {
        const parsedAttempts = JSON.parse(attemptsJson);
        if (!Array.isArray(parsedAttempts)) {
            addSignalIssue(
                context,
                'routingChainAttemptsJson',
                'routingChainAttemptsJson must parse to an array.'
            );
        }
    } catch {
        addSignalIssue(
            context,
            'routingChainAttemptsJson',
            'routingChainAttemptsJson must parse to an array.'
        );
    }
};

const validateClarificationSignals = (
    signals: StepSignalRecord | undefined,
    context: z.RefinementCtx
): void => {
    const hasReasonCode = hasSignalKey(signals, 'clarificationReasonCode');
    const hasOptionCount = hasSignalKey(signals, 'clarificationOptionCount');

    if (!hasReasonCode && !hasOptionCount) {
        return;
    }

    const reasonCode = signals?.clarificationReasonCode;
    const optionCount = signals?.clarificationOptionCount;

    if (typeof reasonCode !== 'string' || reasonCode.trim().length === 0) {
        addSignalIssue(
            context,
            'clarificationReasonCode',
            'clarificationReasonCode must be non-empty when clarification signals are present.'
        );
    }

    if (
        typeof optionCount !== 'number' ||
        !Number.isInteger(optionCount) ||
        optionCount < 0
    ) {
        addSignalIssue(
            context,
            'clarificationOptionCount',
            'clarificationOptionCount must be a nonnegative integer when clarification signals are present.'
        );
    }
};

const validateRefinementSignals = (
    signals: StepSignalRecord | undefined,
    context: z.RefinementCtx
): void => {
    if (signals?.refinementApplied !== true) {
        return;
    }

    const refinementSourceStepId = signals.refinementSourceStepId;
    const appliedModuleCount = signals.appliedModuleCount;

    if (
        typeof refinementSourceStepId !== 'string' ||
        refinementSourceStepId.trim().length === 0
    ) {
        addSignalIssue(
            context,
            'refinementSourceStepId',
            'refinementSourceStepId must be non-empty when refinementApplied is true.'
        );
    }

    if (
        typeof appliedModuleCount !== 'number' ||
        !Number.isInteger(appliedModuleCount) ||
        appliedModuleCount < 0
    ) {
        addSignalIssue(
            context,
            'appliedModuleCount',
            'appliedModuleCount must be a nonnegative integer when refinementApplied is true.'
        );
    }
};

const StepRecordSchema = z
    .object({
        stepId: z.string().min(1),
        parentStepId: z.string().min(1).optional(),
        attempt: z.number().int().positive(),
        stepKind: z.enum(WORKFLOW_STEP_KINDS),
        reasonCode: ExecutionReasonCodeSchema.optional(),
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime(),
        durationMs: z.number().int().nonnegative(),
        model: z.string().min(1).optional(),
        usage: z
            .object({
                promptTokens: z.number().int().nonnegative().optional(),
                completionTokens: z.number().int().nonnegative().optional(),
                totalTokens: z.number().int().nonnegative().optional(),
            })
            .strict()
            .optional(),
        cost: z
            .object({
                inputCostUsd: z.number().nonnegative(),
                outputCostUsd: z.number().nonnegative(),
                totalCostUsd: z.number().nonnegative(),
            })
            .strict()
            .optional(),
        outcome: StepOutcomeSchema,
    })
    .superRefine((value, context) => {
        const signals = value.outcome.signals;
        if (value.stepKind === 'plan') {
            validatePlannerStepSignals(signals, context);
        }
        validateRoutingChainSignals(signals, context);
        validateClarificationSignals(signals, context);
        validateRefinementSignals(signals, context);

        if (
            value.stepKind !== 'assess' ||
            value.outcome.status !== 'executed'
        ) {
            return;
        }

        const assessSignals = signals;
        const reviewDecision =
            assessSignals !== undefined
                ? assessSignals.reviewDecision
                : undefined;
        const reviewReason =
            assessSignals !== undefined
                ? assessSignals.reviewReason
                : undefined;
        const revisionInstruction =
            assessSignals !== undefined
                ? assessSignals.revisionInstruction
                : undefined;

        if (
            typeof reviewDecision !== 'string' ||
            !BOUNDED_REVIEW_ASSESS_DECISIONS.includes(
                reviewDecision as (typeof BOUNDED_REVIEW_ASSESS_DECISIONS)[number]
            )
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['outcome', 'signals', 'reviewDecision'],
                message:
                    'executed assess steps must include reviewDecision: "finalize" | "revise".',
            });
        }

        if (
            typeof reviewReason !== 'string' ||
            reviewReason.trim().length === 0
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['outcome', 'signals', 'reviewReason'],
                message:
                    'executed assess steps must include non-empty reviewReason.',
            });
        }

        if (
            reviewDecision === 'revise' &&
            (typeof revisionInstruction !== 'string' ||
                revisionInstruction.trim().length === 0)
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['outcome', 'signals', 'revisionInstruction'],
                message:
                    'executed assess steps must include non-empty revisionInstruction when reviewDecision is "revise".',
            });
        }

        validateAssessTraceSignals(assessSignals, context);
    })
    .strict();

const validateAssessTraceSignals = (
    assessSignals: Record<string, string | number | boolean | null> | undefined,
    context: z.RefinementCtx
): void => {
    const traceAlignment =
        assessSignals !== undefined ? assessSignals.traceAlignment : undefined;
    const traceAlignmentReason =
        assessSignals !== undefined
            ? assessSignals.traceAlignmentReason
            : undefined;
    const finalTemperamentAxisEntries = TRACE_TEMPERAMENT_AXIS_KEYS.map(
        (axisKey) => {
            const signalKey =
                TRACE_ASSESS_FINAL_TEMPERAMENT_SIGNAL_KEYS[axisKey];
            return {
                key: signalKey,
                value: assessSignals?.[signalKey],
            };
        }
    );
    const hasAnyFinalTemperamentAxis = finalTemperamentAxisEntries.some(
        (entry) => entry.value !== undefined
    );

    if (
        assessSignals !== undefined &&
        traceAlignment !== 'aligned' &&
        traceAlignment !== 'misaligned'
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['outcome', 'signals', 'traceAlignment'],
            message:
                'executed assess steps must include traceAlignment: "aligned" | "misaligned".',
        });
    }

    for (const axisEntry of finalTemperamentAxisEntries) {
        if (axisEntry.value === undefined) {
            continue;
        }
        if (
            typeof axisEntry.value !== 'number' ||
            !Number.isInteger(axisEntry.value) ||
            axisEntry.value < 1 ||
            axisEntry.value > 5
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['outcome', 'signals', axisEntry.key],
                message:
                    'executed assess steps finalTemperament axis values must be integers from 1 to 5.',
            });
        }
    }

    if (
        traceAlignment !== undefined &&
        traceAlignment !== 'aligned' &&
        traceAlignment !== 'misaligned'
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['outcome', 'signals', 'traceAlignment'],
            message:
                'executed assess steps traceAlignment must be "aligned" or "misaligned" when present.',
        });
    }

    if (
        traceAlignment === 'misaligned' &&
        (typeof traceAlignmentReason !== 'string' ||
            traceAlignmentReason.trim().length === 0)
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['outcome', 'signals', 'traceAlignmentReason'],
            message:
                'executed assess steps must include non-empty traceAlignmentReason when traceAlignment is "misaligned".',
        });
    }

    if (traceAlignment === 'misaligned' && !hasAnyFinalTemperamentAxis) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['outcome', 'signals'],
            message:
                'executed assess steps must include at least one finalTemperament axis when traceAlignment is "misaligned".',
        });
    }
};

const WorkflowRecordSchema = z
    .object({
        workflowId: z.string().min(1),
        workflowName: z.string().min(1),
        status: z.enum(['completed', 'degraded']),
        stepCount: z.number().int().nonnegative(),
        maxSteps: z.number().int().positive(),
        maxDurationMs: z.number().int().positive(),
        effectiveLimits: z
            .array(
                z
                    .object({
                        key: z.enum(WORKFLOW_LIMIT_KEYS),
                        state: z.enum(WORKFLOW_LIMIT_STATES),
                        value: z.number().int().nonnegative().optional(),
                        stoppedRun: z.boolean(),
                    })
                    .strict()
            )
            .optional(),
        limitStop: z
            .object({
                stoppedByLimit: z.boolean(),
                terminationReason: z.enum(WORKFLOW_TERMINATION_REASONS),
                exhaustedLimitKey: z.enum(WORKFLOW_LIMIT_KEYS).optional(),
                stoppedBeforeStepKind: z.enum(WORKFLOW_STEP_KINDS).optional(),
            })
            .strict()
            .optional(),
        terminationReason: z.enum(WORKFLOW_TERMINATION_REASONS),
        steps: z.array(StepRecordSchema),
    })
    .superRefine((value, context) => {
        if (value.stepCount !== value.steps.length) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'stepCount must equal steps.length.',
            });
        }

        const seenStepIds = new Set<string>();
        for (const step of value.steps) {
            if (seenStepIds.has(step.stepId)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `stepId "${step.stepId}" must be unique within a workflow.`,
                });
            }

            if (
                step.parentStepId !== undefined &&
                step.parentStepId === step.stepId
            ) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `stepId "${step.stepId}" cannot self-reference as parentStepId.`,
                });
            }

            seenStepIds.add(step.stepId);
        }

        for (const step of value.steps) {
            if (
                step.parentStepId !== undefined &&
                !seenStepIds.has(step.parentStepId)
            ) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `parentStepId "${step.parentStepId}" must reference a stepId in the same workflow.`,
                });
            }
        }

        const seenLimitKeys = new Set<string>();
        for (const limit of value.effectiveLimits ?? []) {
            if (seenLimitKeys.has(limit.key)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `effective limit key "${limit.key}" must be unique.`,
                });
            }
            seenLimitKeys.add(limit.key);
        }

        if (
            value.limitStop?.stoppedByLimit === true &&
            value.limitStop.exhaustedLimitKey === undefined
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['limitStop', 'exhaustedLimitKey'],
                message:
                    'limitStop.exhaustedLimitKey is required when stoppedByLimit is true.',
            });
        }

        if (
            value.limitStop?.stoppedByLimit === false &&
            value.limitStop.exhaustedLimitKey !== undefined
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['limitStop', 'exhaustedLimitKey'],
                message:
                    'limitStop.exhaustedLimitKey must be omitted when stoppedByLimit is false.',
            });
        }
        if (
            value.limitStop?.stoppedByLimit === false &&
            value.limitStop.stoppedBeforeStepKind !== undefined
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['limitStop', 'stoppedBeforeStepKind'],
                message:
                    'limitStop.stoppedBeforeStepKind must be omitted when stoppedByLimit is false.',
            });
        }
    })
    .strict();

const ReviewRuntimeLabelSchema = z.enum(REVIEW_RUNTIME_LABELS);

const ReviewRuntimeSummarySchema = z
    .object({
        label: ReviewRuntimeLabelSchema,
    })
    .strict();

const TrustGraphProvenanceReasonCodeSchema = z.enum([
    'external_scope_validation_failed',
    'adapter_scope_mismatch',
    'adapter_disabled',
    'adapter_timeout',
    'adapter_timeout_cancellation_requested',
    'adapter_error',
    'adapter_processing_failed',
    'poisoned_evidence_dropped',
    'aggregate_signals_neutralized_after_filtering',
    'ownership_validation_explicitly_none_denied',
    'ownership_validation_explicitly_none_allowed_non_production',
]);

const TrustGraphScopeTupleSchema = z
    .object({
        userId: z.string().min(1),
        projectId: z.string().min(1).optional(),
        collectionId: z.string().min(1).optional(),
    })
    .strict();

const TrustGraphScopeValidationResultSchema = z.discriminatedUnion('ok', [
    z
        .object({
            ok: z.literal(true),
            normalizedScope: TrustGraphScopeTupleSchema,
        })
        .strict(),
    z
        .object({
            ok: z.literal(false),
            reasonCode: z.literal('external_scope_validation_failed'),
            details: z.string().min(1),
        })
        .strict(),
]);

const TrustGraphMetadataSchema = z
    .object({
        adapterStatus: z.enum([
            'off',
            'scope_denied',
            'success',
            'timeout',
            'error',
        ]),
        scopeValidation: TrustGraphScopeValidationResultSchema,
        terminalAuthority: z.literal('backend_execution_contract'),
        failOpenBehavior: z.literal('local_behavior'),
        verificationRequired: z.literal(true),
        advisoryEvidenceItemCount: z.number().int().nonnegative(),
        droppedEvidenceCount: z.number().int().nonnegative(),
        droppedEvidenceIds: z.array(z.string().min(1)),
        provenanceReasonCodes: z.array(TrustGraphProvenanceReasonCodeSchema),
        sufficiencyView: z
            .object({
                coverageValue: z.number().nonnegative().optional(),
                coverageEvaluationUnit: z
                    .enum(['claim', 'subquestion', 'source'])
                    .optional(),
                conflictSignals: z.array(z.string().min(1)),
            })
            .strict(),
        evidenceView: z
            .object({
                sourceRefs: z.array(z.string().min(1)),
                provenancePathRefs: z.array(z.string().min(1)),
                traceRefs: z.array(z.string().min(1)),
            })
            .strict(),
        provenanceJoin: z
            .object({
                externalEvidenceBundleId: z.string().min(1),
                externalTraceRefs: z.array(z.string().min(1)),
                adapterVersion: z.string().min(1),
                consumedGovernedFieldPaths: z.array(z.string().min(1)),
                consumedByConsumers: z.array(z.enum(['P_SUFF', 'P_EVID'])),
                droppedEvidenceIds: z.array(z.string().min(1)),
                reasonCodes: z.array(TrustGraphProvenanceReasonCodeSchema),
            })
            .strict()
            .optional(),
    })
    .strict();

type _AssertTrustGraphMetadata =
    z.infer<typeof TrustGraphMetadataSchema> extends TrustGraphMetadata
        ? TrustGraphMetadata extends z.infer<typeof TrustGraphMetadataSchema>
            ? true
            : false
        : false;
const _assertTrustGraphMetadata: _AssertTrustGraphMetadata = true;
void _assertTrustGraphMetadata;

const ProvenanceAssessmentSchema = z
    .object({
        methodId: z.literal('deterministic_multi_signal_v1'),
        methodLabel: z.string().min(1),
        signals: z
            .object({
                citationsPresent: z.boolean(),
                retrievalRequested: z.boolean(),
                retrievalUsed: z.boolean(),
                retrievalToolExecuted: z.boolean(),
                workflowEvidence: z.boolean(),
                trustGraphEvidenceAvailable: z.boolean(),
                trustGraphEvidenceUsed: z.boolean(),
                assistantDeclaredSpeculative: z.boolean(),
            })
            .strict(),
        conflicts: z.array(z.string().min(1)),
        limitations: z.array(z.string().min(1)),
    })
    .strict();

type _AssertProvenanceAssessment =
    z.infer<typeof ProvenanceAssessmentSchema> extends ProvenanceAssessment
        ? ProvenanceAssessment extends z.infer<
              typeof ProvenanceAssessmentSchema
          >
            ? true
            : false
        : false;
const _assertProvenanceAssessment: _AssertProvenanceAssessment = true;
void _assertProvenanceAssessment;

const SteerabilityControlSourceSchema = z.enum([
    'runtime_config',
    'execution_contract',
    'request_override',
    'planner_output',
    'surface_profile',
    'capability_policy',
    'tool_policy',
    'fail_open_default',
]);

const SteerabilityImpactTargetSchema = z.enum([
    'workflow_execution',
    'execution_contract_selection',
    'review_loop_execution',
    'model_profile_selection',
    'persona_prompt_layer',
    'tool_eligibility',
]);

const SteerabilityControlRecordSchema = z
    .object({
        controlId: SteerabilityControlIdSchema,
        value: z.string().min(1),
        source: SteerabilityControlSourceSchema,
        rationale: z.string().min(1),
        mattered: z.boolean(),
        impactedTargets: z.array(SteerabilityImpactTargetSchema),
    })
    .strict();

const SteerabilityControlsSchema = z
    .object({
        version: z.literal('v1'),
        controls: z.array(SteerabilityControlRecordSchema).min(1),
    })
    .strict();

type _AssertSteerabilityControls =
    z.infer<typeof SteerabilityControlsSchema> extends SteerabilityControls
        ? SteerabilityControls extends z.infer<
              typeof SteerabilityControlsSchema
          >
            ? true
            : false
        : false;
const _assertSteerabilityControls: _AssertSteerabilityControls = true;
void _assertSteerabilityControls;

const ImageGenerationMetadataSchema = z
    .object({
        version: z.literal('v1'),
        prompts: z
            .object({
                original: z.string(),
                active: z.string(),
                revised: z.string().nullable(),
                maxInputChars: z.number().int().positive(),
                policyTruncated: z.boolean(),
            })
            .strict(),
        request: z
            .object({
                textModel: z.string().min(1),
                reasoningEffort: z
                    .enum(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
                    .nullable(),
                imageModel: z.string().min(1),
                quality: z.enum(['low', 'medium', 'high', 'auto']),
                size: z.enum(['auto', '1024x1024', '1024x1536', '1536x1024']),
                aspectRatio: z.enum([
                    'auto',
                    'square',
                    'portrait',
                    'landscape',
                ]),
                background: z.enum(['auto', 'transparent', 'opaque']),
                style: z.string(),
                allowPromptAdjustment: z.boolean(),
                outputFormat: z.enum(['png', 'webp', 'jpeg']),
                outputCompression: z.number().int().min(1).max(100),
            })
            .strict(),
        linkage: z
            .object({
                followUpResponseId: z.string().min(1).nullable(),
            })
            .strict(),
        result: z
            .object({
                outputResponseId: z.string().min(1).nullable(),
                finalStyle: z.string(),
                generationTimeMs: z.number().int().nonnegative(),
            })
            .strict(),
        usage: z
            .object({
                inputTokens: z.number().int().nonnegative(),
                cachedInputTokens: z.number().int().nonnegative().optional(),
                cacheWriteTokens: z.number().int().nonnegative().optional(),
                outputTokens: z.number().int().nonnegative(),
                totalTokens: z.number().int().nonnegative(),
                imageCount: z.number().int().nonnegative(),
                partialImageCount: z.number().int().nonnegative(),
                providerUsageAvailable: z.boolean().optional(),
            })
            .strict(),
        costComponents: z
            .object({
                prompt: z
                    .object({
                        model: z.string().min(1),
                        inputTokens: z.number().int().nonnegative(),
                        cachedInputTokens: z
                            .number()
                            .int()
                            .nonnegative()
                            .optional(),
                        cacheWriteTokens: z
                            .number()
                            .int()
                            .nonnegative()
                            .optional(),
                        outputTokens: z.number().int().nonnegative(),
                        totalTokens: z.number().int().nonnegative(),
                        reasoningEffort: z
                            .enum([
                                'none',
                                'low',
                                'medium',
                                'high',
                                'xhigh',
                                'max',
                            ])
                            .nullable(),
                        inputCost: z.number().nonnegative(),
                        outputCost: z.number().nonnegative(),
                        totalCost: z.number().nonnegative(),
                        completeness: z.enum([
                            'complete',
                            'partial',
                            'unknown',
                        ]),
                        incompleteReasons: z.array(z.string()),
                    })
                    .strict(),
                render: z
                    .object({
                        model: z.string().min(1),
                        imageCount: z.number().int().nonnegative(),
                        partialImageCount: z.number().int().nonnegative(),
                        quality: z.enum(['low', 'medium', 'high', 'auto']),
                        size: z.enum([
                            'auto',
                            '1024x1024',
                            '1024x1536',
                            '1536x1024',
                        ]),
                        perImageCost: z.number().nonnegative(),
                        totalCost: z.number().nonnegative(),
                        completeness: z.enum(['complete', 'unknown']),
                        incompleteReasons: z.array(z.string()),
                    })
                    .strict(),
            })
            .strict(),
        costs: z
            .object({
                text: z.number().nonnegative(),
                image: z.number().nonnegative(),
                total: z.number().nonnegative(),
                perImage: z.number().nonnegative(),
            })
            .strict(),
    })
    .strict();

type _AssertImageGenerationMetadata =
    z.infer<
        typeof ImageGenerationMetadataSchema
    > extends ImageGenerationMetadata
        ? ImageGenerationMetadata extends z.infer<
              typeof ImageGenerationMetadataSchema
          >
            ? true
            : false
        : false;
const _assertImageGenerationMetadata: _AssertImageGenerationMetadata = true;
void _assertImageGenerationMetadata;

const GitHubContextSectionSchema = z.enum([
    'repository',
    'issues',
    'pulls',
    'releases',
    'commits',
]);
const GitHubContextReasonCodeSchema = z.enum([
    'disabled',
    'invalid_repository',
    'not_in_conversation',
    'private_access_denied',
    'unauthorized',
    'not_found',
    'rate_limited',
    'timeout',
    'malformed_response',
    'network_error',
]);

const GitHubContextMetadataSchema: z.ZodType<GitHubContextMetadata> = z
    .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        requestedSections: z.array(GitHubContextSectionSchema).max(5),
        status: z.enum(['current', 'partial', 'stale', 'unavailable']),
        fetchTimestamp: z.string().datetime().optional(),
        maxRecordsPerSection: z.number().int().positive().optional(),
        returnedCounts: z
            .object({
                repository: z.number().int().nonnegative().optional(),
                issues: z.number().int().nonnegative().optional(),
                pulls: z.number().int().nonnegative().optional(),
                releases: z.number().int().nonnegative().optional(),
                commits: z.number().int().nonnegative().optional(),
            })
            .strict(),
        failedSections: z.array(GitHubContextSectionSchema).max(5),
        reasonCodes: z.array(GitHubContextReasonCodeSchema).max(5),
    })
    .strict();

const ProjectContextCategorySchema = z.enum([
    'documented_intent',
    'documented_behavior',
    'current_state',
]);
const ProjectContextReasonCodeSchema = z.enum([
    'disabled',
    'tool_not_requested',
    'invalid_query',
    'query_embedding_failed',
    'embedding_timeout',
    'index_unavailable',
    'no_relevant_matches',
    'execution_error',
]);
export const ProjectContextMetadataSchema: z.ZodType<ProjectContextMetadata> = z
    .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        provider: z.string().min(1),
        model: z.string().min(1),
        chunkerVersion: z.number().int().positive(),
        indexVersion: z.number().int().positive(),
        indexedCommitSha: z.string().min(1).optional(),
        indexedAt: z.string().datetime().optional(),
        requestedCategories: z.array(ProjectContextCategorySchema).max(3),
        returnedCounts: z
            .object({
                documented_intent: z.number().int().nonnegative().optional(),
                documented_behavior: z.number().int().nonnegative().optional(),
                current_state: z.number().int().nonnegative().optional(),
            })
            .strict(),
        maxChunks: z.number().int().positive(),
        topKPerCategory: z.number().int().positive(),
        maxMatches: z.number().int().positive().optional(),
        minScore: z.number().min(-1).max(1).optional(),
        embeddingTimeoutMs: z.number().int().positive().optional(),
        status: z.enum(['current', 'partial', 'stale', 'unavailable']),
        reasonCodes: z.array(ProjectContextReasonCodeSchema).max(5),
    })
    .strict();

const responseMetadataShape = {
    responseId: z.string().min(1),
    provenance: ProvenanceSchema,
    safetyTier: SafetyTierSchema,
    tradeoffCount: z.number().nonnegative(),
    chainHash: z.string(),
    licenseContext: z.string(),
    // Deprecated compatibility field; prefer execution[] as structural record authority.
    modelVersion: z.string(),
    staleAfter: z.string(),
    totalDurationMs: z.number().int().nonnegative().optional(),
    citations: z.array(CitationSchema),
    provenanceAssessment: ProvenanceAssessmentSchema.optional(),
    execution: z.array(ExecutionEventSchema).optional(),
    workflow: WorkflowRecordSchema.optional(),
    reviewRuntime: ReviewRuntimeSummarySchema.optional(),
    steerabilityControls: SteerabilityControlsSchema.optional(),
    evaluator: EvaluatorOutcomeSchema.optional(),
    imageDescriptions: z.array(z.string()).optional(),
    evidenceScore: TraceAxisScoreSchema.optional(),
    freshnessScore: TraceAxisScoreSchema.optional(),
    // TRACE posture metadata; keep separate from execution policy and provenance
    // classification/record fields.
    trace_target: PartialResponseTemperamentSchema,
    trace_final: PartialResponseTemperamentSchema,
    trace_final_reason_code: TraceFinalizationReasonCodeSchema.optional(),
    trustGraph: TrustGraphMetadataSchema.optional(),
    githubContext: GitHubContextMetadataSchema.optional(),
    projectContext: ProjectContextMetadataSchema.optional(),
    // TODO(auth-memory-governance): Apply user opt-in auth/memory/governance
    // policy before broad prompt-rich image metadata exposure/retention.
    imageGeneration: ImageGenerationMetadataSchema.optional(),
    presentation: PresentationMetadataSchema.optional(),
} as const;

const requireTraceFinalReasonWhenChanged = (
    value: {
        trace_target: z.infer<typeof PartialResponseTemperamentSchema>;
        trace_final: z.infer<typeof PartialResponseTemperamentSchema>;
        trace_final_reason_code?: z.infer<
            typeof TraceFinalizationReasonCodeSchema
        >;
    },
    context: z.RefinementCtx
): void => {
    // TODO(trace-lifecycle): This validates the current summary-field model.
    // If TRACE later becomes multi-step, keep one canonical lifecycle/history
    // shape and derive these summary fields instead of treating the pair as
    // the conceptual source of truth.
    const traceChanged = !isTraceTemperamentEqual(
        value.trace_target,
        value.trace_final
    );

    if (traceChanged && value.trace_final_reason_code === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['trace_final_reason_code'],
            message:
                'trace_final_reason_code is required when trace_final differs from trace_target.',
        });
    }

    if (!traceChanged && value.trace_final_reason_code !== undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['trace_final_reason_code'],
            message:
                'trace_final_reason_code must be omitted when trace_final matches trace_target.',
        });
    }
};

const TraceCardChipDataSchema = z
    .object({
        evidenceScore: TraceAxisScoreSchema.optional(),
        freshnessScore: TraceAxisScoreSchema.optional(),
    })
    .strict();

/**
 * Response metadata is intentionally tolerant so additive backend fields do not
 * break clients.
 *
 * Stability guidance for consumers:
 * - Prefer execution/workflow/trustGraph for structural record surfaces.
 * - Treat TRACE fields (`trace_target`, `trace_final`, optional chips) as
 *   answer-posture metadata.
 * - Treat planner influence as workflow `steps[]` with `stepKind=plan`.
 * - Treat steerabilityControls as control-influence records.
 * - Treat provenance/provenanceAssessment as compact grounding
 *   classification-method metadata, not complete execution truth.
 * - Treat modelVersion as compatibility-shaped and transitional.
 *
 * TODO(metadata-stability-tiers): Once field stability tiers are published for
 * external consumers, tighten this boundary deliberately without breaking
 * compatibility-shaped rollout paths.
 * TODO(metadata-compat-model-version): Remove modelVersion from this shape
 * once compatibility consumers migrate fully to execution[] generation events.
 */
export const ResponseMetadataSchema: z.ZodType<ResponseMetadata> = z
    .object(responseMetadataShape)
    .superRefine(requireTraceFinalReasonWhenChanged)
    .passthrough();

/**
 * @api.operationId: postChat
 * @api.path: POST /api/chat
 */
export const PostChatRequestSchema = z
    .object({
        surface: ChatSurfaceSchema,
        botPersonaId: ChatPersonaIdSchema.optional(),
        modeId: ChatModeIdSchema.optional(),
        maxReviewCycles: z.number().int().nonnegative().optional(),
        traceTarget: PartialResponseTemperamentSchema.optional(),
        plannerProfileId: z.string().min(1).max(64).optional(),
        generateProfileId: z.string().min(1).max(64).optional(),
        assessProfileId: z.string().min(1).max(64).optional(),
        trigger: z
            .object({
                kind: ChatTriggerKindSchema,
                messageId: z.string().min(1).optional(),
                addressing: ChatAddressingEvidenceSchema.optional(),
            })
            .strict(),
        latestUserInput: z.string().min(0).max(3072),
        conversation: z.array(ChatConversationMessageSchema).min(1).max(64),
        attachments: z.array(ChatAttachmentSchema).max(8).optional(),
        capabilities: ChatCapabilitiesSchema.optional(),
        sessionId: z.string().min(1).max(128).optional(),
        surfaceContext: z
            .object({
                channelId: z.string().min(1).optional(),
                guildId: z.string().min(1).optional(),
                userId: z.string().min(1).optional(),
                requestHost: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

/**
 * @api.operationId: postChat
 * @api.path: POST /api/chat
 */
export const PostChatResponseSchema: z.ZodType<PostChatResponse> =
    z.discriminatedUnion('action', [
        z
            .object({
                action: z.literal('message'),
                message: z.string(),
                modality: z.enum(['text', 'tts']),
                metadata: ResponseMetadataSchema,
            })
            .passthrough(),
        z
            .object({
                action: z.literal('react'),
                reaction: z.string().min(1),
                metadata: z.null(),
            })
            .passthrough(),
        z
            .object({
                action: z.literal('ignore'),
                metadata: z.null(),
            })
            .passthrough(),
        z
            .object({
                action: z.literal('image'),
                imageRequest: ChatImageRequestSchema,
                metadata: z.null(),
            })
            .passthrough(),
    ]);

/**
 * @api.operationId: getChatProfiles
 * @api.path: GET /api/chat/profiles
 */
export const GetChatProfilesResponseSchema = z
    .object({
        profiles: z
            .array(
                z
                    .object({
                        id: z.string().min(1),
                        description: z.string().min(1).optional(),
                    })
                    .strict()
            )
            .max(100),
    })
    .strict();

/**
 * @api.operationId: postInternalTextTask
 * @api.path: POST /api/internal/text
 */
export const PostInternalNewsTaskRequestSchema = z
    .object({
        task: z.literal('news'),
        query: z.string().min(1).max(512).optional(),
        category: z.string().min(1).max(128).optional(),
        maxResults: z.number().int().min(1).max(5).optional(),
        reasoningEffort: z
            .enum(supportedReasoningEfforts)
            .describe(
                'Backend resolves this value against the selected model profile and omits unsupported values fail-open.'
            )
            .optional(),
        verbosity: z.enum(['low', 'medium', 'high']).optional(),
        channelContext: z
            .object({
                channelId: z.string().min(1).optional(),
                guildId: z.string().min(1).optional(),
                userId: z
                    .string()
                    .min(1)
                    .describe(
                        'Backend-only safety identifier material; never model prompt or log context.'
                    )
                    .optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

/**
 * @api.operationId: postInternalTextTask
 * @api.path: POST /api/internal/text
 */
export const PostInternalNewsTaskResponseSchema = z
    .object({
        task: z.literal('news'),
        result: z
            .object({
                news: z.array(InternalNewsItemSchema),
                summary: z.string(),
            })
            .strict(),
    })
    .strict();

/**
 * @api.operationId: postInternalTextTask
 * @api.path: POST /api/internal/text
 */
export const PostInternalImageDescriptionTaskRequestSchema = z
    .object({
        task: z.literal('image_description'),
        imageUrl: z.string().url(),
        context: z.string().min(1).max(4096).optional(),
        channelContext: z
            .object({
                channelId: z.string().min(1).optional(),
                guildId: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

/**
 * @api.operationId: postInternalTextTask
 * @api.path: POST /api/internal/text
 */
export const PostInternalImageDescriptionTaskResponseSchema = z
    .object({
        task: z.literal('image_description'),
        result: z
            .object({
                description: z.string().min(1),
                model: z.string().min(1),
                usage: z
                    .object({
                        inputTokens: z.number().int().nonnegative(),
                        outputTokens: z.number().int().nonnegative(),
                        totalTokens: z.number().int().nonnegative(),
                    })
                    .strict(),
                costs: z
                    .object({
                        input: z.number().nonnegative(),
                        output: z.number().nonnegative(),
                        total: z.number().nonnegative(),
                    })
                    .strict(),
            })
            .strict(),
    })
    .strict();

/**
 * @api.operationId: postInternalImageTask
 * @api.path: POST /api/internal/image
 */
export const PostInternalImageGenerateRequestSchema = z
    .object({
        task: z.literal('generate'),
        prompt: z.string().min(1).max(8000),
        textModel: z.enum(internalImageTextModels),
        imageModel: z.enum(internalImageRenderModels),
        size: z.enum(['1024x1024', '1024x1536', '1536x1024', 'auto']),
        quality: z.enum(['low', 'medium', 'high', 'auto']),
        background: z.enum(['auto', 'transparent', 'opaque']),
        style: z.string().min(1).max(100),
        allowPromptAdjustment: z.boolean(),
        outputFormat: z.enum(supportedImageOutputFormats),
        outputCompression: z.number().int().min(0).max(100),
        aspectRatio: z
            .enum(['auto', 'square', 'portrait', 'landscape'])
            .optional(),
        promptPolicy: z
            .object({
                originalPrompt: z.string().min(1).max(8000).optional(),
                maxInputChars: z.number().int().positive().optional(),
                policyTruncated: z.boolean().optional(),
            })
            .strict()
            .optional(),
        user: z
            .object({
                username: z.string().min(1).max(128),
                nickname: z.string().min(1).max(128),
                guildName: z.string().min(1).max(256),
            })
            .strict(),
        followUpResponseId: z.string().min(1).optional(),
        recoverableTaskId: z.string().uuid().optional(),
        stream: z.boolean().optional(),
        channelContext: z
            .object({
                channelId: z.string().min(1).optional(),
                guildId: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

const InternalImageAnnotationsSchema = z
    .object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        note: z.string().nullable(),
        adjustedPrompt: z.string().nullable().optional(),
    })
    .strict();

/**
 * @api.operationId: postInternalImageTask
 * @api.path: POST /api/internal/image
 */
export const PostInternalImageGenerateResponseSchema = z
    .object({
        task: z.literal('generate'),
        result: z
            .object({
                responseId: z.string().min(1).nullable(),
                textModel: z.enum(internalImageTextModels),
                reasoningEffort: z.enum(supportedReasoningEfforts).optional(),
                imageModel: z.enum(internalImageRenderModels),
                revisedPrompt: z.string().nullable(),
                finalStyle: z.string().min(1),
                annotations: InternalImageAnnotationsSchema,
                finalImageBase64: z.string().min(1),
                outputFormat: z.enum(supportedImageOutputFormats),
                outputCompression: z.number().int().min(0).max(100),
                usage: z
                    .object({
                        inputTokens: z.number().int().nonnegative(),
                        cachedInputTokens: z
                            .number()
                            .int()
                            .nonnegative()
                            .optional(),
                        cacheWriteTokens: z
                            .number()
                            .int()
                            .nonnegative()
                            .optional(),
                        outputTokens: z.number().int().nonnegative(),
                        totalTokens: z.number().int().nonnegative(),
                        imageCount: z.number().int().nonnegative(),
                        partialImageCount: z.number().int().nonnegative(),
                        providerUsageAvailable: z.boolean().optional(),
                    })
                    .strict(),
                costs: z
                    .object({
                        text: z.number().nonnegative(),
                        image: z.number().nonnegative(),
                        total: z.number().nonnegative(),
                        perImage: z.number().nonnegative(),
                    })
                    .strict(),
                generationTimeMs: z.number().int().nonnegative(),
            })
            .strict(),
    })
    .strict();

/**
 * Endpoint-level request union for trusted internal image tasks. This stays
 * narrow on purpose and currently includes the `generate` task only.
 *
 * @api.operationId: postInternalImageTask
 * @api.path: POST /api/internal/image
 */
export const PostInternalImageRequestSchema = z.discriminatedUnion('task', [
    PostInternalImageGenerateRequestSchema,
]);

/**
 * Endpoint-level response union for trusted internal image tasks.
 *
 * @api.operationId: postInternalImageTask
 * @api.path: POST /api/internal/image
 */
export const PostInternalImageResponseSchema = z.discriminatedUnion('task', [
    PostInternalImageGenerateResponseSchema,
]);

/**
 * @api.operationId: postInternalImageTask
 * @api.path: POST /api/internal/image
 */
export const InternalImageStreamEventSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('partial_image'),
            index: z.number().int().nonnegative(),
            base64: z.string().min(1),
        })
        .strict(),
    z
        .object({
            type: z.literal('result'),
            task: z.literal('generate'),
            result: PostInternalImageGenerateResponseSchema.shape.result,
        })
        .strict(),
    z
        .object({
            type: z.literal('error'),
            error: z.string().min(1),
        })
        .strict(),
]);

/**
 * Endpoint-level request union for trusted internal text tasks. This stays
 * narrow on purpose and includes only purpose-built backend helpers.
 *
 * @api.operationId: postInternalTextTask
 * @api.path: POST /api/internal/text
 */
export const PostInternalTextRequestSchema = z.discriminatedUnion('task', [
    PostInternalNewsTaskRequestSchema,
    PostInternalImageDescriptionTaskRequestSchema,
]);

/**
 * Endpoint-level response union for trusted internal text tasks.
 *
 * @api.operationId: postInternalTextTask
 * @api.path: POST /api/internal/text
 */
export const PostInternalTextResponseSchema = z.discriminatedUnion('task', [
    PostInternalNewsTaskResponseSchema,
    PostInternalImageDescriptionTaskResponseSchema,
]);

/**
 * @api.operationId: postTraces
 * @api.path: POST /api/traces
 */
export const PostTracesRequestSchema = z
    .object(responseMetadataShape)
    .superRefine(requireTraceFinalReasonWhenChanged)
    .strict();

/**
 * @api.operationId: postTraces
 * @api.path: POST /api/traces
 */
export const PostTracesResponseSchema = z
    .object({
        ok: z.literal(true),
        responseId: z.string().min(1),
    })
    .passthrough();

/**
 * @api.operationId: postTraceCards
 * @api.path: POST /api/trace-cards
 */
export const PostTraceCardRequestSchema = z
    .object({
        responseId: z.string().min(1).optional(),
        temperament: PartialResponseTemperamentSchema.optional(),
        chips: TraceCardChipDataSchema.optional(),
    })
    .strict();

/**
 * @api.operationId: postTraceCards
 * @api.path: POST /api/trace-cards
 */
export const PostTraceCardResponseSchema = z
    .object({
        responseId: z.string().min(1),
        pngBase64: z.string().min(1),
    })
    .passthrough();

/**
 * @api.operationId: postTraceCardsFromTrace
 * @api.path: POST /api/trace-cards/from-trace
 */
export const PostTraceCardFromTraceRequestSchema = z
    .object({
        responseId: z.string().min(1),
    })
    .strict();

/**
 * @api.operationId: postTraceCardsFromTrace
 * @api.path: POST /api/trace-cards/from-trace
 */
export const PostTraceCardFromTraceResponseSchema = PostTraceCardResponseSchema;

/**
 * @api.operationId: getTrace
 * @api.path: GET /api/traces/{responseId}
 */
export const GetTraceResponseSchema: z.ZodType<GetTraceResponse> =
    ResponseMetadataSchema;

/**
 * @api.operationId: getTrace
 * @api.path: GET /api/traces/{responseId}
 */
export const GetTraceStaleResponseSchema: z.ZodType<GetTraceStaleResponse> = z
    .object({
        message: z.literal('Trace is stale'),
        metadata: ResponseMetadataSchema,
    })
    .passthrough();

/** @api.operationId: getResponseVersions @api.path: GET /api/traces/{responseId}/response-versions */
export const ResponseCandidateSchema = z
    .object({
        id: z.string().min(1),
        parentCandidateId: z.string().min(1).optional(),
        workflowStepId: z.string().min(1),
        sequence: z.number().int().nonnegative(),
        stage: z.enum([
            'initial_generation',
            'revision',
            'presentation_draft',
            'presentation_finalization',
            'presentation_repair',
            'fallback',
        ]),
        state: z.enum(['selected', 'superseded']),
        text: z.string().min(1),
    })
    .strict();

/** @api.operationId: getResponseVersions @api.path: GET /api/traces/{responseId}/response-versions */
export const GetResponseVersionsResponseSchema = z
    .object({
        responseId: z.string().min(1),
        candidates: z.array(ResponseCandidateSchema),
    })
    .strict();

/** @api.operationId: getResponseVersions @api.path: GET /api/traces/{responseId}/response-versions */
export const GetResponseVersionsStaleResponseSchema = z
    .object({
        message: z.literal('Trace is stale'),
        responseId: z.string().min(1),
        candidates: z.array(ResponseCandidateSchema),
    })
    .strict();

export const GetResponseVersionsApiResponseSchema = z.union([
    GetResponseVersionsResponseSchema,
    GetResponseVersionsStaleResponseSchema,
]);

/**
 * Trace reads can return either live metadata or a stale envelope depending on status.
 */
export const GetTraceApiResponseSchema: z.ZodType<
    GetTraceResponse | GetTraceStaleResponse
> = z.union([GetTraceResponseSchema, GetTraceStaleResponseSchema]);

/**
 * Shared API error envelope for normalized server-side error responses.
 */
export const ApiErrorResponseSchema = z
    .object({
        error: z.string(),
        details: z.string().optional(),
        retryAfter: z.number().int().nonnegative().optional(),
    })
    .strict();

/**
 * @api.operationId: postSetupSession
 * @api.path: POST /api/setup/session
 */
export const PostSetupSessionRequestSchema = z
    .object({
        code: z.string().min(1),
    })
    .strict();

/**
 * @api.operationId: postSetupSession
 * @api.path: POST /api/setup/session
 */
export const PostSetupSessionResponseSchema = z
    .object({
        ok: z.literal(true),
        expiresAt: z.string().datetime(),
        csrfToken: z.string().min(1),
    })
    .strict();

/**
 * @api.operationId: postSetupOperatorLink
 * @api.path: POST /api/setup/operator-link
 */
export const PostSetupOperatorLinkRequestSchema = z
    .object({
        action: z.enum(['settings', 'reset']),
    })
    .strict();

/**
 * @api.operationId: postSetupOperatorLink
 * @api.path: POST /api/setup/operator-link
 */
export const PostSetupOperatorLinkResponseSchema = z
    .object({
        ok: z.literal(true),
        action: z.enum(['settings', 'reset']),
        mode: z.enum(['operator', 'first-run']),
        setupPath: z.string().min(1),
        setupUrl: z.string().url(),
        expiresAt: z.string().datetime(),
        settingsState: z.enum(['present', 'missing', 'reset']),
        backupPath: z.string().min(1).optional(),
    })
    .strict();

const AdminSettingsValidationErrorCategorySchema = z.enum([
    'yaml_parse_error',
    'invalid_root',
    'legacy_shape_removed',
    'invalid_key_format',
    'unsupported_key',
    'secret_key_forbidden',
    'bootstrap_key_forbidden',
    'invalid_version',
    'type_mismatch',
    'payload_too_large',
    'internal_error',
]);

export const AdminSettingsValidationErrorSchema = z
    .object({
        message: z.string().min(1),
        pointer: z.string().min(1).nullable(),
        category: AdminSettingsValidationErrorCategorySchema,
    })
    .strict();

export const AdminSettingsValidationFailureResponseSchema = z
    .object({
        error: z.string().min(1),
        validationErrors: z.array(AdminSettingsValidationErrorSchema).min(1),
    })
    .strict();

/**
 * @api.operationId: getAdminSettingsSchema
 * @api.path: GET /api/admin/settings/schema
 */
export const GetAdminSettingsSchemaResponseSchema = z
    .object({
        ok: z.literal(true),
        schemaVersion: z.number().int().positive(),
        settingsDocumentVersion: z.number().int().positive(),
        fields: z.array(
            z
                .object({
                    envKey: z.string().min(1),
                    section: z.string().min(1),
                    path: z.array(z.string().min(1)).min(1),
                    kind: z.enum([
                        'string',
                        'boolean',
                        'integer',
                        'number',
                        'csv',
                        'enum',
                        'json',
                    ]),
                    description: z.string().min(1),
                    defaultValue: z
                        .union([
                            z.string(),
                            z.number(),
                            z.boolean(),
                            z.array(z.string()),
                        ])
                        .optional(),
                    allowedValues: z.array(z.string()).optional(),
                })
                .strict()
        ),
    })
    .strict();

/**
 * @api.operationId: postAdminSettingsValidate
 * @api.path: POST /api/admin/settings/validate
 */
export const PostAdminSettingsValidateRequestSchema = z.string();

/**
 * @api.operationId: postAdminSettingsValidate
 * @api.path: POST /api/admin/settings/validate
 */
export const PostAdminSettingsValidateResponseSchema = z
    .object({
        ok: z.literal(true),
        valid: z.literal(true),
        normalizedSummary: z
            .object({
                version: z.number().int().positive(),
                settingsKeysCount: z.number().int().nonnegative(),
                discordBotsCount: z.number().int().nonnegative(),
            })
            .strict(),
        warnings: z.array(z.string()),
        restartRequired: z.literal(true),
    })
    .strict();

/**
 * @api.operationId: putAdminSettingsYaml
 * @api.path: PUT /api/admin/settings.yaml
 */
export const PutAdminSettingsYamlResponseSchema = z
    .object({
        ok: z.literal(true),
        etag: z.string().min(1),
        restartRequired: z.literal(true),
        applied: z.literal(false),
    })
    .strict();

const IncidentPointersSchema = z
    .object({
        responseId: z.string().min(1).optional(),
        guildId: z.string().min(1).optional(),
        channelId: z.string().min(1).optional(),
        messageId: z.string().min(1).optional(),
        modelVersion: z.string().min(1).optional(),
        chainHash: z.string().min(1).optional(),
    })
    .strict();

const IncidentAuditEventSchema = z
    .object({
        action: IncidentAuditActionSchema,
        actorHash: z.string().min(1).nullable().optional(),
        notes: z.string().min(1).nullable().optional(),
        createdAt: z.string().datetime(),
    })
    .strict();

const IncidentRemediationSchema = z
    .object({
        state: IncidentRemediationStateSchema,
        applied: z.boolean(),
        notes: z.string().min(1).nullable().optional(),
        updatedAt: z.string().datetime().nullable().optional(),
    })
    .strict();

const IncidentSummarySchema = z
    .object({
        incidentId: z.string().min(1),
        status: IncidentStatusSchema,
        tags: z.array(z.string().min(1)),
        description: z.string().min(1).nullable().optional(),
        contact: z.string().min(1).nullable().optional(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        consentedAt: z.string().datetime(),
        pointers: IncidentPointersSchema,
        remediation: IncidentRemediationSchema,
    })
    .strict();

const IncidentDetailSchema = IncidentSummarySchema.extend({
    auditEvents: z.array(IncidentAuditEventSchema),
}).strict();

/**
 * @api.operationId: postIncidentReport
 * @api.path: POST /api/incidents/report
 */
export const PostIncidentReportRequestSchema = z
    .object({
        reporterUserId: z.string().min(1),
        guildId: z.string().min(1).optional(),
        channelId: z.string().min(1).optional(),
        messageId: z.string().min(1).optional(),
        jumpUrl: z.string().url().optional(),
        responseId: z.string().min(1).optional(),
        chainHash: z.string().min(1).optional(),
        modelVersion: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).max(25).optional(),
        description: z.string().trim().min(1).max(2000).optional(),
        contact: z.string().trim().min(1).max(500).optional(),
        consentedAt: z.string().datetime(),
    })
    .strict();

/**
 * @api.operationId: postIncidentReport
 * @api.path: POST /api/incidents/report
 */
export const PostIncidentReportResponseSchema = z
    .object({
        incident: IncidentDetailSchema,
        remediation: z
            .object({
                state: z.literal('pending'),
            })
            .strict(),
    })
    .strict();

/**
 * @api.operationId: listIncidents
 * @api.path: GET /api/incidents
 */
export const GetIncidentsResponseSchema = z
    .object({
        incidents: z.array(IncidentSummarySchema),
    })
    .strict();

/**
 * @api.operationId: getIncident
 * @api.path: GET /api/incidents/{incidentId}
 */
export const GetIncidentResponseSchema = z
    .object({
        incident: IncidentDetailSchema,
    })
    .strict();

/**
 * @api.operationId: postIncidentStatus
 * @api.path: POST /api/incidents/{incidentId}/status
 */
export const PostIncidentStatusRequestSchema = z
    .object({
        status: IncidentStatusSchema,
        actorUserId: z.string().min(1).optional(),
        notes: z.string().max(2000).optional(),
    })
    .strict();

/**
 * @api.operationId: postIncidentStatus
 * @api.path: POST /api/incidents/{incidentId}/status
 */
export const PostIncidentStatusResponseSchema = GetIncidentResponseSchema;

/**
 * @api.operationId: postIncidentNotes
 * @api.path: POST /api/incidents/{incidentId}/notes
 */
export const PostIncidentNotesRequestSchema = z
    .object({
        actorUserId: z.string().min(1).optional(),
        notes: z.string().trim().min(1).max(2000),
    })
    .strict();

/**
 * @api.operationId: postIncidentNotes
 * @api.path: POST /api/incidents/{incidentId}/notes
 */
export const PostIncidentNotesResponseSchema = GetIncidentResponseSchema;

/**
 * @api.operationId: postIncidentRemediation
 * @api.path: POST /api/incidents/{incidentId}/remediation
 */
export const PostIncidentRemediationRequestSchema = z
    .object({
        actorUserId: z.string().min(1).optional(),
        state: z.enum([
            'applied',
            'already_marked',
            'skipped_not_assistant',
            'failed',
        ]),
        notes: z.string().max(2000).optional(),
    })
    .strict();

/**
 * @api.operationId: postIncidentRemediation
 * @api.path: POST /api/incidents/{incidentId}/remediation
 */
export const PostIncidentRemediationResponseSchema = GetIncidentResponseSchema;

const formatSchemaIssues = (error: z.ZodError): string => {
    const firstIssue = error.issues[0];
    if (!firstIssue) {
        return 'Response payload did not match the expected schema.';
    }

    const issuePath =
        firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'body';
    return `${issuePath}: ${firstIssue.message}`;
};

export const createSchemaResponseValidator =
    <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
    (data: unknown): ApiResponseValidationResult<z.output<TSchema>> => {
        const parsed = schema.safeParse(data);
        if (parsed.success) {
            return {
                success: true,
                data: parsed.data,
            };
        }

        return {
            success: false,
            error: formatSchemaIssues(parsed.error),
        };
    };

const RecoverableTaskSchema = z
    .object({
        id: z.string().uuid(),
        kind: z.literal('image_generation'),
        state: z.enum(['started', 'recovering', 'complete', 'failed']),
        botProfileId: z.string().min(1).max(128),
        discordChannelId: z.string().min(1).max(32),
        discordMessageId: z.string().min(1).max(32),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

/** @api.operationId: postInternalRecoverableTask @api.path: POST /api/internal/recoverable-tasks */
export const PostInternalRecoverableTaskCreateRequestSchema = z
    .object({
        kind: z.literal('image_generation'),
        botProfileId: z.string().min(1).max(128),
        discordChannelId: z.string().min(1).max(32),
        discordMessageId: z.string().min(1).max(32),
    })
    .strict();

/** @api.operationId: postInternalRecoverableTask @api.path: POST /api/internal/recoverable-tasks */
export const PostInternalRecoverableTaskCreateResponseSchema = z
    .object({ task: RecoverableTaskSchema })
    .strict();

/** @api.operationId: postInternalRecoverableTaskClaim @api.path: POST /api/internal/recoverable-tasks/claim */
export const PostInternalRecoverableTaskClaimRequestSchema = z
    .object({ botProfileId: z.string().min(1).max(128) })
    .strict();

/** @api.operationId: postInternalRecoverableTaskClaim @api.path: POST /api/internal/recoverable-tasks/claim */
export const PostInternalRecoverableTaskClaimResponseSchema = z
    .object({ tasks: z.array(RecoverableTaskSchema) })
    .strict();

/** @api.operationId: postInternalRecoverableTaskFinish @api.path: POST /api/internal/recoverable-tasks/{taskId}/finish */
export const PostInternalRecoverableTaskFinishRequestSchema = z
    .object({ state: z.enum(['complete', 'failed']) })
    .strict();

/** @api.operationId: postInternalRecoverableTaskFinish @api.path: POST /api/internal/recoverable-tasks/{taskId}/finish */
export const PostInternalRecoverableTaskFinishResponseSchema = z
    .object({ task: RecoverableTaskSchema.nullable(), changed: z.boolean() })
    .strict();
