/**
 * @description: Unit tests for shared reflect/traces runtime schemas in contracts.
 * @footnote-scope: test
 * @footnote-module: WebContractSchemasTests
 * @footnote-risk: low - Tests only validate schema behavior for known payload shapes.
 * @footnote-ethics: low - Uses synthetic metadata and no user-identifying data.
 */

import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ApiErrorResponseSchema,
    AdminSettingsValidationErrorSchema,
    AdminSettingsValidationFailureResponseSchema,
    AuthenticatedPrincipalSchema,
    GetAdminSettingsSchemaResponseSchema,
    GetAuthSessionResponseSchema,
    PostAdminSettingsValidateRequestSchema,
    PostAdminSettingsValidateResponseSchema,
    PostSetupSessionRequestSchema,
    PostSetupSessionResponseSchema,
    PutAdminSettingsYamlResponseSchema,
    GetIncidentResponseSchema,
    GetIncidentsResponseSchema,
    InternalImageStreamEventSchema,
    PostInternalImageDescriptionTaskRequestSchema,
    PostInternalImageDescriptionTaskResponseSchema,
    PostInternalImageGenerateRequestSchema,
    PostInternalImageGenerateResponseSchema,
    PostInternalImageRequestSchema,
    PostInternalImageResponseSchema,
    PostInternalNewsTaskRequestSchema,
    PostInternalNewsTaskResponseSchema,
    PostInternalTextRequestSchema,
    PostInternalTextResponseSchema,
    GetTraceApiResponseSchema,
    GetResponseVersionsApiResponseSchema,
    GetTraceStaleResponseSchema,
    PostIncidentNotesRequestSchema,
    PostIncidentRemediationRequestSchema,
    PostIncidentReportRequestSchema,
    PostIncidentReportResponseSchema,
    PostIncidentStatusRequestSchema,
    PostChatRequestSchema,
    PostChatResponseSchema,
    PostTraceCardFromTraceRequestSchema,
    PostTraceCardFromTraceResponseSchema,
    PostTraceCardRequestSchema,
    PostTraceCardResponseSchema,
    PostTracesRequestSchema,
    ResponseMetadataSchema,
    createSchemaResponseValidator,
} from '../src/web/schemas';
import {
    internalImageRenderModels,
    internalImageTextModels,
} from '../src/providers';
import type {
    GetAdminSettingsSchemaResponse,
    GetIncidentResponse,
    GetIncidentsResponse,
    PutAdminSettingsYamlResponse,
    PostInternalImageGenerateResponse,
    PostInternalImageResponse,
    PostInternalNewsTaskResponse,
    PostInternalTextResponse,
    GetTraceResponse,
    GetTraceStaleResponse,
    GetResponseVersionsResponse,
    PostIncidentReportResponse,
    PostChatResponse,
} from '../src/web/types';
import type { ApiResponseValidationResult } from '../src/web/client-core';
import type { ResponseMetadata } from '../src/policy';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const openApiSource = fs.readFileSync(
    path.join(repoRoot, 'docs/api/openapi.yaml'),
    'utf-8'
);

test('account session schemas accept only the three public session states', () => {
    assert.equal(
        GetAuthSessionResponseSchema.safeParse({
            enabled: false,
            authenticated: false,
        }).success,
        true
    );
    assert.equal(
        GetAuthSessionResponseSchema.safeParse({
            enabled: true,
            authenticated: false,
        }).success,
        true
    );
    assert.equal(
        GetAuthSessionResponseSchema.safeParse({
            enabled: true,
            authenticated: true,
            principal: {
                issuer: 'https://identity.example/application/o/footnote/',
                subject: 'account-123',
                displayName: 'Example Operator',
            },
            expiresAt: '2026-07-23T12:00:00.000Z',
            csrfToken: 'csrf-token',
        }).success,
        true
    );

    const invalidStates: unknown[] = [
        { enabled: false, authenticated: true },
        {
            enabled: true,
            authenticated: false,
            principal: {
                issuer: 'https://identity.example',
                subject: 'account-123',
                displayName: null,
            },
        },
        {
            enabled: true,
            authenticated: true,
            principal: {
                issuer: 'https://identity.example',
                subject: 'account-123',
                displayName: null,
            },
            expiresAt: 'not-a-date',
            csrfToken: 'csrf-token',
        },
        {
            enabled: true,
            authenticated: true,
            principal: {
                issuer: '',
                subject: 'account-123',
                displayName: null,
            },
            expiresAt: '2026-07-23T12:00:00.000Z',
            csrfToken: 'csrf-token',
        },
        {
            enabled: true,
            authenticated: true,
            principal: {
                issuer: 'https://identity.example',
                subject: 'account-123',
                displayName: null,
                providerToken: 'must-not-cross-the-boundary',
            },
            expiresAt: '2026-07-23T12:00:00.000Z',
            csrfToken: 'csrf-token',
        },
    ];

    for (const invalidState of invalidStates) {
        assert.equal(
            GetAuthSessionResponseSchema.safeParse(invalidState).success,
            false
        );
    }
});

test('authenticated principal schema permits a null display name and stays strict', () => {
    assert.deepEqual(
        AuthenticatedPrincipalSchema.parse({
            issuer: 'https://identity.example',
            subject: 'account-123',
            displayName: null,
        }),
        {
            issuer: 'https://identity.example',
            subject: 'account-123',
            displayName: null,
        }
    );
    assert.equal(
        AuthenticatedPrincipalSchema.safeParse({
            issuer: 'https://identity.example',
            subject: 'account-123',
            displayName: '',
        }).success,
        false
    );
});

const baseMetadata: ResponseMetadata = {
    responseId: 'response_123',
    provenance: 'Retrieved',
    safetyTier: 'Low',
    tradeoffCount: 2,
    chainHash: 'hash_abc',
    licenseContext: 'MIT + HL3',
    modelVersion: 'gpt-5',
    staleAfter: new Date().toISOString(),
    citations: [
        {
            title: 'Example source',
            url: 'https://example.com/article',
        },
    ],
    trace_target: {
        tightness: 5,
        rationale: 3,
        attribution: 4,
        caution: 3,
        extent: 4,
    },
    trace_final: {
        tightness: 5,
        rationale: 3,
        attribution: 4,
        caution: 3,
        extent: 4,
    },
};

type WorkflowMetadataPayload = ResponseMetadata & {
    workflow: NonNullable<ResponseMetadata['workflow']>;
};

const baseIncidentDetail = {
    incident: {
        incidentId: '1a2b3c4d',
        status: 'new',
        tags: ['safety'],
        description: 'Reported response',
        contact: 'contact@example.com',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        consentedAt: new Date().toISOString(),
        pointers: {
            responseId: 'response_123',
            guildId: 'a'.repeat(64),
            channelId: 'b'.repeat(64),
            messageId: 'c'.repeat(64),
            modelVersion: 'gpt-5-mini',
            chainHash: 'hash_abc',
        },
        remediation: {
            state: 'pending',
            applied: false,
            notes: null,
            updatedAt: null,
        },
        auditEvents: [
            {
                action: 'incident.created',
                actorHash: 'd'.repeat(64),
                notes: 'created',
                createdAt: new Date().toISOString(),
            },
        ],
    },
} as const;

test('PostChatRequestSchema enforces strict request payload rules', () => {
    assert.equal(
        PostChatRequestSchema.safeParse({
            surface: 'web',
            modeId: 'grounded',
            personaExpressionStrength: 'strong',
            maxReviewCycles: 3,
            traceTarget: {
                tightness: 4,
            },
            trigger: { kind: 'submit' },
            latestUserInput: 'What is Footnote?',
            conversation: [
                {
                    role: 'user',
                    content: 'What is Footnote?',
                },
            ],
        }).success,
        true
    );

    assert.equal(
        PostChatRequestSchema.safeParse({
            surface: 'web',
            trigger: { kind: 'submit' },
            latestUserInput: 'What is Footnote?',
            conversation: [
                {
                    role: 'user',
                    content: 'What is Footnote?',
                },
            ],
            extra: true,
        }).success,
        false
    );

    assert.equal(
        PostChatRequestSchema.safeParse({
            surface: 'web',
            trigger: { kind: 'submit' },
            latestUserInput: 'x'.repeat(3073),
            conversation: [
                {
                    role: 'user',
                    content: 'What is Footnote?',
                },
            ],
        }).success,
        false
    );

    assert.equal(
        PostChatRequestSchema.safeParse({
            surface: 'discord',
            maxReviewCycles: -1,
            trigger: { kind: 'direct' },
            latestUserInput: 'What is Footnote?',
            conversation: [
                {
                    role: 'user',
                    content: 'What is Footnote?',
                },
            ],
        }).success,
        false
    );

    assert.equal(
        PostChatRequestSchema.safeParse({
            surface: 'discord',
            trigger: {
                kind: 'alias_candidate',
                addressing: {
                    assistantMentioned: false,
                    replyToAssistant: false,
                    otherParticipantMentioned: true,
                    replyToOtherParticipant: false,
                },
            },
            latestUserInput: 'There is a footnote about that.',
            conversation: [
                {
                    role: 'user',
                    content: 'There is a footnote about that.',
                },
            ],
        }).success,
        true
    );

    assert.equal(
        PostChatRequestSchema.safeParse({
            surface: 'web',
            personaExpressionStrength: 'dramatic',
            trigger: { kind: 'submit' },
            latestUserInput: 'What is Footnote?',
            conversation: [{ role: 'user', content: 'What is Footnote?' }],
        }).success,
        false
    );
});

test('openapi ChatRequest documents optional mode/review/trace request controls', () => {
    const chatRequestSectionMatch = openApiSource.match(
        /ChatRequest:[\s\S]*?ChatResponse:/m
    );
    assert.ok(chatRequestSectionMatch);

    const chatRequestSection = chatRequestSectionMatch[0];
    assert.match(chatRequestSection, /botPersonaId:\s*\n\s*type:\s*string/);
    assert.match(
        chatRequestSection,
        /personaExpressionStrength:\s*\n\s*type:\s*string/
    );
    assert.match(chatRequestSection, /modeId:\s*\n\s*type:\s*string/);
    assert.match(chatRequestSection, /maxReviewCycles:\s*\n\s*type:\s*integer/);
    assert.match(chatRequestSection, /traceTarget:\s*\n\s*type:\s*object/);
    assert.equal(
        /required:\s*[\s\S]*-\s*botPersonaId/.test(chatRequestSection),
        false
    );
    assert.equal(
        /required:\s*[\s\S]*-\s*modeId/.test(chatRequestSection),
        false
    );
    assert.equal(
        /required:\s*[\s\S]*-\s*maxReviewCycles/.test(chatRequestSection),
        false
    );
    assert.equal(
        /required:\s*[\s\S]*-\s*traceTarget/.test(chatRequestSection),
        false
    );
    assert.ok(!/profileId:/.test(chatRequestSection));
    assert.ok(!/generation:/.test(chatRequestSection));
});

test('ResponseMetadataSchema remains tolerant for forward-compatible responses', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        futureField: { source: 'future-backend' },
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema accepts typed GitHub context metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        githubContext: {
            repository: 'acme/repo',
            requestedSections: ['repository', 'issues'],
            status: 'partial',
            fetchTimestamp: new Date().toISOString(),
            maxRecordsPerSection: 5,
            returnedCounts: { repository: 1 },
            failedSections: ['issues'],
            reasonCodes: ['rate_limited'],
        },
    });
    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema accepts typed project context metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        projectContext: {
            repository: 'footnote-ai/footnote',
            provider: 'openai',
            model: 'text-embedding-3-small',
            chunkerVersion: 1,
            indexVersion: 1,
            indexedCommitSha: 'abc123',
            indexedAt: new Date().toISOString(),
            requestedCategories: ['documented_intent', 'current_state'],
            returnedCounts: { documented_intent: 2, current_state: 1 },
            maxChunks: 200,
            topKPerCategory: 5,
            status: 'current',
            reasonCodes: [],
        },
    });
    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects invalid GitHub context metadata', () => {
    for (const githubContext of [
        { repository: 'missing-slash', requestedSections: [] },
        {
            repository: 'acme/repo',
            requestedSections: ['repository'],
            status: 'partial',
            returnedCounts: {},
            failedSections: ['unsupported_section'],
            reasonCodes: [],
        },
        {
            repository: 'acme/repo',
            requestedSections: ['repository'],
            status: 'partial',
            returnedCounts: {},
            failedSections: [],
            reasonCodes: ['unsupported_reason'],
        },
    ]) {
        const parsed = ResponseMetadataSchema.safeParse({
            ...baseMetadata,
            githubContext,
        });
        assert.equal(parsed.success, false);
    }
});

test('ResponseMetadataSchema accepts execution timeline events', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            authorityLevel: 'observe',
            mode: 'observe_only',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'allow',
                safetyTier: 'Low',
                ruleId: null,
            },
        },
        execution: [
            {
                kind: 'planner',
                status: 'executed',
                purpose: 'chat_orchestrator_action_selection',
                contractType: 'text_json',
                applyOutcome: 'applied',
                mattered: true,
                matteredControlIds: ['provider_preference'],
                profileId: 'openai-text-fast',
                provider: 'openai',
                model: 'gpt-5-nano',
                durationMs: 12,
            },
            {
                kind: 'tool',
                status: 'skipped',
                toolName: 'web_search',
                reasonCode: 'search_not_supported_by_selected_profile',
                durationMs: 5,
            },
            {
                kind: 'evaluator',
                status: 'executed',
                evaluator: {
                    authorityLevel: 'observe',
                    mode: 'observe_only',
                    provenance: 'Inferred',
                    safetyDecision: {
                        action: 'allow',
                        safetyTier: 'Low',
                        ruleId: null,
                    },
                },
                durationMs: 2,
            },
            {
                kind: 'generation',
                status: 'executed',
                profileId: 'openai-text-medium',
                originalProfileId: 'openai-text-fast',
                effectiveProfileId: 'openai-text-medium',
                provider: 'openai',
                model: 'gpt-5-mini',
                durationMs: 20,
            },
        ],
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema accepts one payload with distinct mode, TRACE, planner, controls, and provenance categories', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        provenanceAssessment: {
            methodId: 'deterministic_multi_signal_v1',
            methodLabel:
                'Deterministic multi-signal provenance classification (backend)',
            signals: {
                citationsPresent: true,
                retrievalRequested: true,
                retrievalUsed: true,
                retrievalToolExecuted: true,
                workflowEvidence: false,
                trustGraphEvidenceAvailable: false,
                trustGraphEvidenceUsed: false,
                assistantDeclaredSpeculative: false,
            },
            conflicts: [],
            limitations: [],
        },
        workflowMode: {
            modeId: 'grounded',
            selectedBy: 'requested_mode',
            selectionReason: 'Configured mode selected.',
            initial_mode: 'grounded',
            behavior: {
                executionContractPresetId: 'quality-grounded',
                workflowProfileClass: 'reviewed',
                workflowProfileId: 'reviewed',
                workflowExecution: 'policy_gated',
                reviewPass: 'included',
                reviseStep: 'allowed',
                evidencePosture: 'strict',
                maxWorkflowSteps: 8,
                maxDeliberationCalls: 4,
            },
        },
        execution: [
            {
                kind: 'planner',
                status: 'executed',
                purpose: 'chat_orchestrator_action_selection',
                contractType: 'text_json',
                applyOutcome: 'applied',
                mattered: true,
                matteredControlIds: ['tool_allowance'],
            },
        ],
        steerabilityControls: {
            version: 'v1',
            controls: [
                {
                    controlId: 'tool_allowance',
                    value: 'allowed:web_search',
                    source: 'tool_policy',
                    rationale:
                        'Tool request was eligible under selected profile.',
                    mattered: true,
                    impactedTargets: ['tool_eligibility'],
                },
            ],
        },
    });

    assert.equal(parsed.success, true);
});

const createValidWorkflowMetadataPayload = (
    now: string
): WorkflowMetadataPayload => ({
    ...baseMetadata,
    workflow: {
        workflowId: 'wf_123',
        workflowName: 'message_reviewed',
        status: 'completed',
        stepCount: 2,
        maxSteps: 5,
        maxDurationMs: 15000,
        effectiveLimits: [
            {
                key: 'maxWorkflowSteps',
                state: 'enforced',
                value: 5,
                stoppedRun: false,
            },
            {
                key: 'maxToolCalls',
                state: 'configured_inactive',
                value: 0,
                stoppedRun: false,
            },
            {
                key: 'maxDeliberationCalls',
                state: 'enforced',
                value: 2,
                stoppedRun: false,
            },
            {
                key: 'maxTokensTotal',
                state: 'unavailable',
                stoppedRun: false,
            },
            {
                key: 'maxDurationMs',
                state: 'enforced',
                value: 15000,
                stoppedRun: false,
            },
        ],
        limitStop: {
            stoppedByLimit: false,
            terminationReason: 'goal_satisfied',
        },
        terminationReason: 'goal_satisfied',
        steps: [
            {
                stepId: 'step_1',
                attempt: 1,
                stepKind: 'generate',
                startedAt: now,
                finishedAt: now,
                durationMs: 10,
                model: 'gpt-5-mini',
                usage: {
                    promptTokens: 10,
                    completionTokens: 20,
                    totalTokens: 30,
                },
                cost: {
                    inputCostUsd: 0.00001,
                    outputCostUsd: 0.00002,
                    totalCostUsd: 0.00003,
                },
                outcome: {
                    status: 'executed',
                    summary: 'Generated initial draft response.',
                },
            },
            {
                stepId: 'step_2',
                parentStepId: 'step_1',
                attempt: 1,
                stepKind: 'assess',
                startedAt: now,
                finishedAt: now,
                durationMs: 5,
                outcome: {
                    status: 'executed',
                    summary: 'Assessment step evaluated draft quality.',
                    signals: {
                        reviewDecision: 'finalize',
                        reviewReason:
                            'Draft answers the request with sufficient clarity.',
                        traceAlignment: 'aligned',
                    },
                },
            },
        ],
    },
});

test('ResponseMetadataSchema accepts workflow lineage metadata', () => {
    const now = new Date().toISOString();
    const parsed = ResponseMetadataSchema.safeParse(
        createValidWorkflowMetadataPayload(now)
    );

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema accepts a presentation receipt separately from workflow steps', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        presentation: {
            step: 'presentation',
            outcome: 'finalized_after_evidence_repair',
            attempted: true,
            reasonCode: 'evidence_repaired',
            personaId: 'myuri',
            auditOutcome: 'evidence_issue',
            draftAttemptCount: 1,
            finalizerAttemptCount: 2,
            auditAttemptCount: 1,
            expressionStrength: 'balanced',
            expressionSource: 'persona_default',
        },
    });

    assert.equal(parsed.success, true);
});

test('PostTracesRequestSchema normalizes legacy presentation fields', () => {
    const parsed = PostTracesRequestSchema.safeParse({
        ...baseMetadata,
        presentation: {
            step: 'presentation',
            outcome: 'finalized',
            attempted: true,
            reasonCode: 'finalized',
            personaId: 'winter',
            auditOutcome: 'clear',
            draftAttemptCount: 1,
            finalizerAttemptCount: 1,
            auditAttemptCount: 1,
            intensity: 'restrained',
            traceConstrained: true,
        },
    });

    assert.equal(parsed.success, true);
    if (!parsed.success) {
        return;
    }
    assert.equal(parsed.data.presentation?.expressionStrength, 'subtle');
    assert.equal(parsed.data.presentation?.expressionSource, 'persona_default');
    assert.equal('intensity' in (parsed.data.presentation ?? {}), false);
    assert.equal('traceConstrained' in (parsed.data.presentation ?? {}), false);
});

test('ResponseMetadataSchema accepts normalized review runtime summary labels', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        reviewRuntime: {
            label: 'reviewed_no_revision',
        },
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects unknown normalized review runtime labels', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        reviewRuntime: {
            label: 'approved',
        },
    });

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema accepts structured steerability controls metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        steerabilityControls: {
            version: 'v1',
            controls: [
                {
                    controlId: 'workflow_mode',
                    value: 'grounded',
                    source: 'runtime_config',
                    rationale: 'Configured workflow mode applied.',
                    mattered: true,
                    impactedTargets: [
                        'workflow_execution',
                        'execution_contract_selection',
                    ],
                },
                {
                    controlId: 'tool_allowance',
                    value: 'blocked:web_search:search_not_supported_by_selected_profile',
                    source: 'capability_policy',
                    rationale:
                        'Selected profile cannot use web search; tool path blocked.',
                    mattered: true,
                    impactedTargets: ['tool_eligibility'],
                },
            ],
        },
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema accepts workflow mode escalation attachment metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        workflowMode: {
            modeId: 'grounded',
            selectedBy: 'workflow_mode_escalation',
            selectionReason:
                'Workflow escalation seam accepted one mode transition.',
            initial_mode: 'fast',
            escalated_mode: 'grounded',
            escalation_reason: 'insufficient evidence confidence for fast mode',
            behavior: {
                executionContractPresetId: 'quality-grounded',
                workflowProfileClass: 'reviewed',
                workflowProfileId: 'reviewed',
                workflowExecution: 'policy_gated',
                reviewPass: 'included',
                reviseStep: 'allowed',
                evidencePosture: 'strict',
                maxWorkflowSteps: 8,
                maxDeliberationCalls: 4,
            },
        },
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects steerability controls with unknown enums', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        steerabilityControls: {
            version: 'v1',
            controls: [
                {
                    controlId: 'unknown_control',
                    value: 'value',
                    source: 'runtime_config',
                    rationale: 'test',
                    mattered: true,
                    impactedTargets: ['workflow_execution'],
                },
            ],
        },
    });

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage with duplicate step ids', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[1].stepId = 'step_1';
    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage with missing parent reference', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[1].parentStepId = 'missing_step';
    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage with self-parent reference', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[1].parentStepId = 'step_2';
    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage with mismatched stepCount', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.stepCount = payload.workflow.steps.length + 1;
    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage with invalid termination reason', () => {
    const now = new Date().toISOString();
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        workflow: {
            workflowId: 'wf_123',
            workflowName: 'message_reviewed',
            status: 'completed',
            stepCount: 1,
            maxSteps: 2,
            maxDurationMs: 15000,
            terminationReason: 'unknown_reason',
            steps: [
                {
                    stepId: 'step_1',
                    attempt: 1,
                    stepKind: 'generate',
                    startedAt: now,
                    finishedAt: now,
                    durationMs: 10,
                    outcome: {
                        status: 'executed',
                        summary: 'Generated initial draft response.',
                    },
                },
            ],
        },
    });

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage limitStop without exhaustedLimitKey when stoppedByLimit is true', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    if (payload.workflow.limitStop === undefined) {
        throw new Error('Expected limitStop fixture to be present.');
    }
    payload.workflow.limitStop = {
        stoppedByLimit: true,
        terminationReason: 'budget_exhausted_steps',
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);
    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema accepts the step prevented by an exhausted workflow limit', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.status = 'degraded';
    payload.workflow.terminationReason = 'budget_exhausted_tokens';
    payload.workflow.limitStop = {
        stoppedByLimit: true,
        terminationReason: 'budget_exhausted_tokens',
        exhaustedLimitKey: 'maxTokensTotal',
        stoppedBeforeStepKind: 'assess',
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);
    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects a prevented step when no workflow limit stopped the run', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.limitStop = {
        stoppedByLimit: false,
        terminationReason: 'goal_satisfied',
        stoppedBeforeStepKind: 'assess',
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);
    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects workflow lineage with duplicate effective limit keys', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    if (payload.workflow.effectiveLimits === undefined) {
        throw new Error('Expected effectiveLimits fixture to be present.');
    }
    payload.workflow.effectiveLimits.push({
        key: 'maxWorkflowSteps',
        state: 'enforced',
        value: 7,
        stoppedRun: false,
    });

    const parsed = ResponseMetadataSchema.safeParse(payload);
    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema accepts plan step with valid planner signals', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow = {
        workflowId: 'wf_plan',
        workflowName: 'message_reviewed',
        status: 'completed',
        stepCount: 1,
        maxSteps: 3,
        maxDurationMs: 15000,
        terminationReason: 'goal_satisfied',
        steps: [
            {
                stepId: 'step_plan_1',
                attempt: 1,
                stepKind: 'plan',
                startedAt: now,
                finishedAt: now,
                durationMs: 5,
                outcome: {
                    status: 'executed',
                    summary:
                        'Planner step emitted bounded action-selection summary.',
                    signals: {
                        purpose: 'chat_orchestrator_action_selection',
                        contractType: 'text_json',
                        applyOutcome: 'applied',
                        action: 'message',
                    },
                },
            },
        ],
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects plan step missing contractType', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow = {
        workflowId: 'wf_plan',
        workflowName: 'message_reviewed',
        status: 'completed',
        stepCount: 1,
        maxSteps: 3,
        maxDurationMs: 15000,
        terminationReason: 'goal_satisfied',
        steps: [
            {
                stepId: 'step_plan_1',
                attempt: 1,
                stepKind: 'plan',
                startedAt: now,
                finishedAt: now,
                durationMs: 5,
                outcome: {
                    status: 'executed',
                    summary:
                        'Planner step emitted bounded action-selection summary.',
                    signals: {
                        purpose: 'chat_orchestrator_action_selection',
                        applyOutcome: 'applied',
                    },
                },
            },
        ],
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects malformed routing-chain signal pairs', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[0].outcome.signals = {
        routingChainAttemptCount: 1,
    };

    const parsedMissingJson = ResponseMetadataSchema.safeParse(payload);
    assert.equal(parsedMissingJson.success, false);

    payload.workflow.steps[0].outcome.signals = {
        routingChainAttemptCount: 1,
        routingChainAttemptsJson: '{"not":"array"}',
    };

    const parsedInvalidJson = ResponseMetadataSchema.safeParse(payload);
    assert.equal(parsedInvalidJson.success, false);
});

test('ResponseMetadataSchema accepts tool clarification signals', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow = {
        workflowId: 'wf_tool',
        workflowName: 'message_reviewed',
        status: 'completed',
        stepCount: 1,
        maxSteps: 3,
        maxDurationMs: 15000,
        terminationReason: 'goal_satisfied',
        steps: [
            {
                stepId: 'step_tool_1',
                attempt: 1,
                stepKind: 'tool',
                startedAt: now,
                finishedAt: now,
                durationMs: 4,
                outcome: {
                    status: 'executed',
                    summary: 'Context step requires user clarification.',
                    signals: {
                        clarificationReasonCode: 'ambiguous_location',
                        clarificationOptionCount: 2,
                    },
                },
            },
        ],
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects partial clarification signals', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[0].outcome.signals = {
        clarificationReasonCode: 'ambiguous_location',
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema accepts refinement generate signals', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[0].outcome.signals = {
        refinementApplied: true,
        refinementSourceStepId: 'step_2',
        appliedModuleCount: 1,
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects refinement without refinementSourceStepId', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    payload.workflow.steps[0].outcome.signals = {
        refinementApplied: true,
        appliedModuleCount: 1,
    };

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects executed assess step without canonical decision signals', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    const assessSignals = payload.workflow.steps[1].outcome.signals as Record<
        string,
        unknown
    >;
    delete assessSignals.reviewDecision;
    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema rejects executed assess step without reviewReason', () => {
    const now = new Date().toISOString();
    const payloadMissingReason = createValidWorkflowMetadataPayload(now);
    const missingReasonSignals = payloadMissingReason.workflow.steps[1].outcome
        .signals as Record<string, unknown>;
    delete missingReasonSignals.reviewReason;
    const missingReasonParsed =
        ResponseMetadataSchema.safeParse(payloadMissingReason);

    assert.equal(missingReasonParsed.success, false);

    const payloadBlankReason = createValidWorkflowMetadataPayload(now);
    const blankReasonSignals = payloadBlankReason.workflow.steps[1].outcome
        .signals as Record<string, unknown>;
    blankReasonSignals.reviewReason = '';
    const blankReasonParsed =
        ResponseMetadataSchema.safeParse(payloadBlankReason);

    assert.equal(blankReasonParsed.success, false);
});

test('ResponseMetadataSchema accepts executed assess revise step with revisionInstruction', () => {
    const now = new Date().toISOString();
    const payload = createValidWorkflowMetadataPayload(now);
    const reviseSignals = payload.workflow.steps[1].outcome.signals as Record<
        string,
        unknown
    >;
    reviseSignals.reviewDecision = 'revise';
    reviseSignals.reviewReason = 'Need one revision pass.';
    reviseSignals.revisionInstruction = 'Shorten and clarify the wording.';

    const parsed = ResponseMetadataSchema.safeParse(payload);

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects executed assess revise step without revisionInstruction', () => {
    const now = new Date().toISOString();
    const payloadMissingInstruction = createValidWorkflowMetadataPayload(now);
    const missingInstructionSignals = payloadMissingInstruction.workflow
        .steps[1].outcome.signals as Record<string, unknown>;
    missingInstructionSignals.reviewDecision = 'revise';
    missingInstructionSignals.reviewReason = 'Need one revision pass.';
    delete missingInstructionSignals.revisionInstruction;
    const missingInstructionParsed = ResponseMetadataSchema.safeParse(
        payloadMissingInstruction
    );

    assert.equal(missingInstructionParsed.success, false);

    const payloadBlankInstruction = createValidWorkflowMetadataPayload(now);
    const blankInstructionSignals = payloadBlankInstruction.workflow.steps[1]
        .outcome.signals as Record<string, unknown>;
    blankInstructionSignals.reviewDecision = 'revise';
    blankInstructionSignals.reviewReason = 'Need one revision pass.';
    blankInstructionSignals.revisionInstruction = '   ';
    const blankInstructionParsed = ResponseMetadataSchema.safeParse(
        payloadBlankInstruction
    );

    assert.equal(blankInstructionParsed.success, false);
});

test('ResponseMetadataSchema rejects non-canonical safety decision rule tuples', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            authorityLevel: 'influence',
            mode: 'observe_only',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'block',
                safetyTier: 'Low',
                ruleId: 'safety.weaponization_request.v1',
                reasonCode: 'self_harm_crisis_intent',
                reason: 'Invalid tuple for test coverage.',
            },
        },
    });

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema accepts tool_unavailable reason code for skipped tool events', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'tool',
                status: 'skipped',
                toolName: 'web_search',
                reasonCode: 'tool_unavailable',
            },
        ],
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects invalid execution timeline event kind/status', () => {
    const invalidKind = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'step',
                status: 'executed',
            },
        ],
    });
    assert.equal(invalidKind.success, false);

    const invalidStatus = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'planner',
                status: 'requested',
            },
        ],
    });
    assert.equal(invalidStatus.success, false);

    const missingReasonForSkipped = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'tool',
                status: 'skipped',
                toolName: 'web_search',
            },
        ],
    });
    assert.equal(missingReasonForSkipped.success, false);

    const invalidReasonCode = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'evaluator',
                status: 'failed',
                reasonCode: 'unknown_failure',
            },
        ],
    });
    assert.equal(invalidReasonCode.success, false);

    const plannerWithToolReasonCode = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'planner',
                status: 'failed',
                reasonCode: 'tool_execution_error',
            },
        ],
    });
    assert.equal(plannerWithToolReasonCode.success, false);

    const generationWithPlannerReasonCode = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'generation',
                status: 'failed',
                reasonCode: 'planner_runtime_error',
            },
        ],
    });
    assert.equal(generationWithPlannerReasonCode.success, false);

    const toolWithoutToolName = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'tool',
                status: 'failed',
                reasonCode: 'tool_execution_error',
            },
        ],
    });
    assert.equal(toolWithoutToolName.success, false);

    const executedWithReasonCode = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        execution: [
            {
                kind: 'tool',
                status: 'executed',
                toolName: 'web_search',
                reasonCode: 'search_rerouted_to_fallback_profile',
            },
        ],
    });
    assert.equal(executedWithReasonCode.success, true);

    const invalidEvaluatorMode = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            authorityLevel: 'observe',
            mode: 'shadow',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'allow',
                safetyTier: 'Low',
                ruleId: null,
            },
        },
    });
    assert.equal(invalidEvaluatorMode.success, false);

    const legacyEvaluatorWithoutAuthority = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            mode: 'observe_only',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'block',
                safetyTier: 'High',
                ruleId: 'safety.weaponization_request.v1',
                reasonCode: 'weaponization_request',
                reason: 'Deterministic weaponization-request rule matched.',
            },
        },
    });
    assert.equal(legacyEvaluatorWithoutAuthority.success, true);

    const legacyEnforcedWithoutAuthority = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            mode: 'enforced',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'block',
                safetyTier: 'High',
                ruleId: 'safety.weaponization_request.v1',
                reasonCode: 'weaponization_request',
                reason: 'Deterministic weaponization-request rule matched.',
            },
        },
    });
    assert.equal(legacyEnforcedWithoutAuthority.success, true);

    const invalidNonAllowBreaker = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            authorityLevel: 'influence',
            mode: 'observe_only',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'block',
                safetyTier: 'High',
                ruleId: 'safety.weaponization_request.v1',
                reasonCode: 'weaponization_request',
            },
        },
    });
    assert.equal(invalidNonAllowBreaker.success, false);

    const validNonAllowBreaker = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evaluator: {
            authorityLevel: 'influence',
            mode: 'observe_only',
            provenance: 'Inferred',
            safetyDecision: {
                action: 'block',
                safetyTier: 'High',
                ruleId: 'safety.weaponization_request.v1',
                reasonCode: 'weaponization_request',
                reason: 'Deterministic weaponization-request rule matched.',
            },
        },
    });
    assert.equal(validNonAllowBreaker.success, true);
});

test('ResponseMetadataSchema accepts valid TRACE target/final metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_target: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
        trace_final: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema accepts partial TRACE target/final metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_target: {
            tightness: 5,
            attribution: 4,
        },
        trace_final: {
            tightness: 5,
            attribution: 4,
        },
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects invalid TRACE target/final metadata', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_target: {
            tightness: 6,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
        trace_final: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
    });

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema requires divergence reason code when trace_target and trace_final differ', () => {
    const missingReason = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_target: { tightness: 3 },
        trace_final: { tightness: 5 },
    });
    assert.equal(missingReason.success, false);

    const withReason = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_target: { tightness: 3 },
        trace_final: { tightness: 5 },
        trace_final_reason_code: 'runtime_posture_adjustment',
    });
    assert.equal(withReason.success, true);

    const withAssessReason = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_target: { tightness: 3 },
        trace_final: { tightness: 5 },
        trace_final_reason_code: 'assess_trace_misalignment',
    });
    assert.equal(withAssessReason.success, true);
});

test('ResponseMetadataSchema rejects trace_final_reason_code when trace_target and trace_final match', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        trace_final_reason_code: 'runtime_posture_adjustment',
    });

    assert.equal(parsed.success, false);
});

test('ResponseMetadataSchema accepts optional integer evidence/freshness scores', () => {
    const parsed = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evidenceScore: 4,
        freshnessScore: 2,
    });

    assert.equal(parsed.success, true);
});

test('ResponseMetadataSchema rejects non-integer or out-of-range evidence/freshness scores', () => {
    const invalidDecimal = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        evidenceScore: 3.2,
    });
    assert.equal(invalidDecimal.success, false);

    const invalidRange = ResponseMetadataSchema.safeParse({
        ...baseMetadata,
        freshnessScore: 6,
    });
    assert.equal(invalidRange.success, false);
});

test('PostTracesRequestSchema rejects unknown request keys', () => {
    const parsed = PostTracesRequestSchema.safeParse({
        ...baseMetadata,
        extra: 'should-fail',
    });

    assert.equal(parsed.success, false);
});

test('PostTraceCardRequestSchema accepts valid trace-card payloads', () => {
    const parsed = PostTraceCardRequestSchema.safeParse({
        temperament: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
        chips: {
            evidenceScore: 4,
            freshnessScore: 5,
        },
    });

    assert.equal(parsed.success, true);
});

test('PostTraceCardRequestSchema rejects invalid chip values', () => {
    const parsed = PostTraceCardRequestSchema.safeParse({
        temperament: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
        chips: {
            evidenceScore: 6,
            freshnessScore: 2,
        },
    });

    assert.equal(parsed.success, false);
});

test('PostIncidentNotesRequestSchema rejects whitespace-only notes', () => {
    const parsed = PostIncidentNotesRequestSchema.safeParse({
        actorUserId: 'user_123',
        notes: '   ',
    });

    assert.equal(parsed.success, false);
});

test('PostIncidentReportRequestSchema rejects whitespace-only description and contact', () => {
    const parsed = PostIncidentReportRequestSchema.safeParse({
        reporterUserId: 'user_123',
        description: '   ',
        contact: '   ',
        consentedAt: new Date().toISOString(),
    });

    assert.equal(parsed.success, false);
});

test('PostTraceCardRequestSchema accepts missing chips and partial chip payloads', () => {
    const missingChips = PostTraceCardRequestSchema.safeParse({
        temperament: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
    });
    assert.equal(missingChips.success, true);

    const missingFreshness = PostTraceCardRequestSchema.safeParse({
        temperament: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
        chips: {
            evidenceScore: 3,
        },
    });
    assert.equal(missingFreshness.success, true);

    const scoreBelowRange = PostTraceCardRequestSchema.safeParse({
        temperament: {
            tightness: 5,
            rationale: 3,
            attribution: 4,
            caution: 3,
            extent: 4,
        },
        chips: {
            evidenceScore: 0.8,
            freshnessScore: 2,
        },
    });
    assert.equal(scoreBelowRange.success, false);

    const minimalPayload = PostTraceCardRequestSchema.safeParse({
        responseId: 'resp_minimal',
    });
    assert.equal(minimalPayload.success, true);
});

test('PostTraceCardResponseSchema requires responseId and pngBase64', () => {
    assert.equal(
        PostTraceCardResponseSchema.safeParse({
            responseId: 'trace-card-preview-1',
            pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        }).success,
        true
    );

    assert.equal(
        PostTraceCardResponseSchema.safeParse({
            responseId: 'trace-card-preview-1',
        }).success,
        false
    );
});

test('PostTraceCardFromTrace schemas require responseId and parse response envelope', () => {
    assert.equal(
        PostTraceCardFromTraceRequestSchema.safeParse({
            responseId: 'resp_trace_1',
        }).success,
        true
    );

    assert.equal(
        PostTraceCardFromTraceRequestSchema.safeParse({}).success,
        false
    );

    assert.equal(
        PostTraceCardFromTraceRequestSchema.safeParse({
            responseId: 'resp_trace_1',
            chips: {
                evidenceScore: 2,
            },
        }).success,
        false
    );

    assert.equal(
        PostTraceCardFromTraceResponseSchema.safeParse({
            responseId: 'resp_trace_1',
            pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        }).success,
        true
    );
});

test('PostChatResponseSchema and GetTraceStaleResponseSchema accept extensible responses', () => {
    const reflectParsed = PostChatResponseSchema.safeParse({
        action: 'message',
        message: 'Hello',
        modality: 'text',
        metadata: {
            ...baseMetadata,
            additionalMetadata: true,
        },
        extraTopLevel: 'new-field',
    });
    assert.equal(reflectParsed.success, true);

    const imageParsed = PostChatResponseSchema.safeParse({
        action: 'image',
        imageRequest: {
            prompt: 'a thoughtful robot reading under a tree',
            allowPromptAdjustment: false,
        },
        metadata: null,
        extraTopLevel: 'future-field',
    });
    assert.equal(imageParsed.success, true);

    const staleParsed = GetTraceStaleResponseSchema.safeParse({
        message: 'Trace is stale',
        metadata: {
            ...baseMetadata,
            archivalHint: 'cold-storage',
        },
        extraTopLevel: true,
    });
    assert.equal(staleParsed.success, true);
});

test('GetTraceApiResponseSchema accepts both live and stale trace payloads', () => {
    assert.equal(
        GetTraceApiResponseSchema.safeParse(baseMetadata).success,
        true
    );

    assert.equal(
        GetTraceApiResponseSchema.safeParse({
            message: 'Trace is stale',
            metadata: baseMetadata,
        }).success,
        true
    );
});

test('response-version schemas serialize ordered candidate history and stale envelopes', () => {
    const payload: GetResponseVersionsResponse = {
        responseId: baseMetadata.responseId,
        candidates: [
            {
                id: 'candidate_1',
                workflowStepId: 'step_1',
                sequence: 0,
                stage: 'initial_generation',
                state: 'superseded',
                text: 'Initial answer.',
            },
            {
                id: 'candidate_2',
                parentCandidateId: 'candidate_1',
                workflowStepId: 'step_2',
                sequence: 1,
                stage: 'revision',
                state: 'selected',
                text: 'Final answer.',
            },
        ],
    };
    assert.equal(
        GetResponseVersionsApiResponseSchema.safeParse(payload).success,
        true
    );
    assert.equal(
        GetResponseVersionsApiResponseSchema.safeParse({
            message: 'Trace is stale',
            ...payload,
        }).success,
        true
    );
    assert.equal(
        GetResponseVersionsApiResponseSchema.safeParse({
            ...payload,
            candidates: [{ ...payload.candidates[0], state: 'unknown' }],
        }).success,
        false
    );
});

test('schema validator outputs stay assignable to shared response contract types', () => {
    const reflectValidator = createSchemaResponseValidator(
        PostChatResponseSchema
    );
    const traceValidator = createSchemaResponseValidator(
        GetTraceApiResponseSchema
    );

    const typedReflectValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PostChatResponse> = reflectValidator;
    const typedTraceValidator: (
        data: unknown
    ) => ApiResponseValidationResult<GetTraceResponse | GetTraceStaleResponse> =
        traceValidator;

    assert.equal(typeof typedReflectValidator, 'function');
    assert.equal(typeof typedTraceValidator, 'function');
});

test('createSchemaResponseValidator returns normalized validation results', () => {
    const validateTraceResponse = createSchemaResponseValidator(
        GetTraceApiResponseSchema
    );

    const success = validateTraceResponse(baseMetadata);
    assert.equal(success.success, true);

    const failure = validateTraceResponse({ invalid: true });
    assert.equal(failure.success, false);
    if (!failure.success) {
        assert.match(failure.error, /body|responseId|metadata|provenance/i);
    }
});

test('ApiErrorResponseSchema enforces strict known error envelope fields', () => {
    assert.equal(
        ApiErrorResponseSchema.safeParse({ error: 'Bad request' }).success,
        true
    );

    assert.equal(
        ApiErrorResponseSchema.safeParse({
            error: 'Bad request',
            unknown: 'unexpected-field',
        }).success,
        false
    );
});

test('admin settings schemas validate contract payloads', () => {
    assert.equal(
        GetAdminSettingsSchemaResponseSchema.safeParse({
            ok: true,
            schemaVersion: 1,
            settingsDocumentVersion: 1,
            fields: [
                {
                    envKey: 'WEB_API_RATE_LIMIT_IP',
                    section: 'rate-limits',
                    path: ['rate-limits', 'web-api-rate-limit-ip'],
                    kind: 'integer',
                    description: 'Public web API rate limit per IP.',
                    defaultValue: 3,
                },
            ],
        }).success,
        true
    );

    assert.equal(
        PostAdminSettingsValidateRequestSchema.safeParse('version: 1\n')
            .success,
        true
    );

    assert.equal(
        PostSetupSessionRequestSchema.safeParse({
            code: 'fn_setup_example',
        }).success,
        true
    );

    assert.equal(
        PostSetupSessionResponseSchema.safeParse({
            ok: true,
            expiresAt: new Date().toISOString(),
            csrfToken: 'csrf_token',
        }).success,
        true
    );

    assert.equal(
        PostAdminSettingsValidateResponseSchema.safeParse({
            ok: true,
            valid: true,
            normalizedSummary: {
                version: 1,
                settingsKeysCount: 2,
                discordBotsCount: 0,
            },
            warnings: [],
            restartRequired: true,
        }).success,
        true
    );

    assert.equal(
        AdminSettingsValidationErrorSchema.safeParse({
            message: 'Invalid version.',
            pointer: 'version',
            category: 'invalid_version',
        }).success,
        true
    );

    assert.equal(
        AdminSettingsValidationFailureResponseSchema.safeParse({
            error: 'Invalid settings YAML',
            validationErrors: [
                {
                    message: 'Invalid version.',
                    pointer: 'version',
                    category: 'invalid_version',
                },
            ],
        }).success,
        true
    );

    assert.equal(
        PutAdminSettingsYamlResponseSchema.safeParse({
            ok: true,
            etag: '"etag-value"',
            restartRequired: true,
            applied: false,
        }).success,
        true
    );
});

test('admin settings schema validators stay assignable to shared contract types', () => {
    const schemaValidator = createSchemaResponseValidator(
        GetAdminSettingsSchemaResponseSchema
    );
    const putValidator = createSchemaResponseValidator(
        PutAdminSettingsYamlResponseSchema
    );

    const typedSchemaValidator: (
        data: unknown
    ) => ApiResponseValidationResult<GetAdminSettingsSchemaResponse> =
        schemaValidator;
    const typedPutValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PutAdminSettingsYamlResponse> =
        putValidator;

    assert.equal(typeof typedSchemaValidator, 'function');
    assert.equal(typeof typedPutValidator, 'function');
});

test('incident schemas accept valid request and response payloads', () => {
    const { auditEvents, ...incidentSummary } = baseIncidentDetail.incident;

    assert.equal(
        PostIncidentReportRequestSchema.safeParse({
            reporterUserId: '123456789012345678',
            guildId: '234567890123456789',
            channelId: '345678901234567890',
            messageId: '456789012345678901',
            jumpUrl: 'https://discord.com/channels/1/2/3',
            responseId: 'response_123',
            chainHash: 'hash_abc',
            modelVersion: 'gpt-5-mini',
            tags: ['safety', 'review'],
            description: 'Needs review',
            contact: 'contact@example.com',
            consentedAt: new Date().toISOString(),
        }).success,
        true
    );

    assert.equal(
        PostIncidentReportResponseSchema.safeParse({
            ...baseIncidentDetail,
            remediation: { state: 'pending' },
        }).success,
        true
    );

    assert.equal(
        GetIncidentsResponseSchema.safeParse({
            incidents: [incidentSummary],
        }).success,
        true
    );

    assert.equal(
        GetIncidentResponseSchema.safeParse(baseIncidentDetail).success,
        true
    );
});

test('incident mutating request schemas enforce strict payload rules', () => {
    assert.equal(
        PostIncidentStatusRequestSchema.safeParse({
            status: 'under_review',
            actorUserId: '123456789012345678',
            notes: 'taking a look',
        }).success,
        true
    );

    assert.equal(
        PostIncidentNotesRequestSchema.safeParse({
            actorUserId: '123456789012345678',
            notes: 'internal note',
        }).success,
        true
    );

    assert.equal(
        PostIncidentRemediationRequestSchema.safeParse({
            actorUserId: '123456789012345678',
            state: 'applied',
            notes: 'warning banner applied',
        }).success,
        true
    );

    assert.equal(
        PostIncidentRemediationRequestSchema.safeParse({
            state: 'pending',
        }).success,
        false
    );
});

test('incident schema validators stay assignable to shared contract types', () => {
    const incidentReportValidator = createSchemaResponseValidator(
        PostIncidentReportResponseSchema
    );
    const incidentsValidator = createSchemaResponseValidator(
        GetIncidentsResponseSchema
    );
    const incidentValidator = createSchemaResponseValidator(
        GetIncidentResponseSchema
    );

    const typedReportValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PostIncidentReportResponse> =
        incidentReportValidator;
    const typedIncidentsValidator: (
        data: unknown
    ) => ApiResponseValidationResult<GetIncidentsResponse> = incidentsValidator;
    const typedIncidentValidator: (
        data: unknown
    ) => ApiResponseValidationResult<GetIncidentResponse> = incidentValidator;

    assert.equal(typeof typedReportValidator, 'function');
    assert.equal(typeof typedIncidentsValidator, 'function');
    assert.equal(typeof typedIncidentValidator, 'function');
});

test('internal text task schemas enforce a narrow task union', () => {
    assert.equal(
        PostInternalNewsTaskRequestSchema.safeParse({
            task: 'news',
            query: 'latest ai policy',
            category: 'tech',
            maxResults: 3,
            reasoningEffort: 'xhigh',
            verbosity: 'medium',
            channelContext: {
                channelId: '123',
                guildId: '456',
                userId: '789',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalTextRequestSchema.safeParse({
            task: 'news',
            query: 'latest ai policy',
            category: 'tech',
            maxResults: 3,
            reasoningEffort: 'max',
            verbosity: 'medium',
            channelContext: {
                channelId: '123',
                guildId: '456',
                userId: '789',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalImageDescriptionTaskRequestSchema.safeParse({
            task: 'image_description',
            imageUrl: 'https://example.com/screenshot.png',
            context: 'User asked what changed in this screenshot.',
            channelContext: {
                channelId: '123',
                guildId: '456',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalTextRequestSchema.safeParse({
            task: 'image_description',
            imageUrl: 'https://example.com/screenshot.png',
        }).success,
        true
    );

    assert.equal(
        PostInternalNewsTaskRequestSchema.safeParse({
            task: 'news',
            maxResults: 6,
        }).success,
        false
    );

    assert.equal(
        PostInternalImageDescriptionTaskRequestSchema.safeParse({
            task: 'image_description',
            imageUrl: 'not-a-url',
        }).success,
        false
    );

    assert.equal(
        PostInternalTextRequestSchema.safeParse({
            task: 'basic',
            prompt: 'hello',
        }).success,
        false
    );

    assert.equal(
        PostInternalNewsTaskResponseSchema.safeParse({
            task: 'news',
            result: {
                news: [
                    {
                        title: 'Policy update',
                        summary: 'A short summary',
                        url: 'https://example.com/news',
                        source: 'Example News',
                        timestamp: new Date().toISOString(),
                    },
                ],
                summary: 'One headline matters today.',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalNewsTaskResponseSchema.safeParse({
            task: 'news',
            result: {
                news: [
                    {
                        title: 'Policy update',
                        summary: 'A short summary',
                        url: 'https://example.com/news',
                        source: 'Example News',
                    },
                ],
                summary: 'One headline matters today.',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalImageDescriptionTaskResponseSchema.safeParse({
            task: 'image_description',
            result: {
                description: '{"summary":"Screenshot of a policy update"}',
                model: 'gpt-4o-mini',
                usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                },
                costs: {
                    input: 0.0000015,
                    output: 0.000003,
                    total: 0.0000045,
                },
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalTextResponseSchema.safeParse({
            task: 'news',
            result: {
                news: [
                    {
                        title: 'Policy update',
                        summary: 'A short summary',
                        url: 'https://example.com/news',
                        source: 'Example News',
                        timestamp: new Date().toISOString(),
                    },
                ],
                summary: 'One headline matters today.',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalTextResponseSchema.safeParse({
            task: 'news',
            result: {
                news: [
                    {
                        title: 'Policy update',
                        summary: 'A short summary',
                        url: 'https://example.com/news',
                        source: 'Example News',
                    },
                ],
                summary: 'One headline matters today.',
            },
        }).success,
        true
    );

    assert.equal(
        PostInternalTextResponseSchema.safeParse({
            task: 'image_description',
            result: {
                description: '{"summary":"Screenshot of a policy update"}',
                model: 'gpt-4o-mini',
                usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                },
                costs: {
                    input: 0.0000015,
                    output: 0.000003,
                    total: 0.0000045,
                },
            },
        }).success,
        true
    );
});

test('internal text schema validator stays assignable to shared contract types', () => {
    const validator = createSchemaResponseValidator(
        PostInternalNewsTaskResponseSchema
    );
    const endpointValidator = createSchemaResponseValidator(
        PostInternalTextResponseSchema
    );
    const typedValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PostInternalNewsTaskResponse> = validator;
    const typedEndpointValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PostInternalTextResponse> =
        endpointValidator;

    assert.equal(typeof typedValidator, 'function');
    assert.equal(typeof typedEndpointValidator, 'function');
});

test('internal image task schemas enforce a narrow generate-only task union', () => {
    const requestPayload = {
        task: 'generate',
        prompt: 'draw a reflective skyline',
        textModel: 'gpt-5-mini',
        imageModel: 'gpt-image-1-mini',
        size: '1024x1024',
        quality: 'medium',
        background: 'auto',
        style: 'vivid',
        allowPromptAdjustment: true,
        outputFormat: 'png',
        outputCompression: 100,
        user: {
            username: 'Jordan',
            nickname: 'Jordan',
            guildName: 'Footnote Lab',
        },
        followUpResponseId: 'resp_prev_123',
        channelContext: {
            channelId: '123',
            guildId: '456',
        },
        stream: true,
    } as const;

    assert.equal(
        PostInternalImageGenerateRequestSchema.safeParse(requestPayload)
            .success,
        true
    );
    assert.equal(
        PostInternalImageRequestSchema.safeParse(requestPayload).success,
        true
    );

    assert.equal(
        PostInternalImageGenerateRequestSchema.safeParse({
            ...requestPayload,
            prompt: 'x'.repeat(8001),
        }).success,
        false
    );
    assert.equal(
        PostInternalImageGenerateRequestSchema.safeParse({
            ...requestPayload,
            style: 'x'.repeat(101),
        }).success,
        false
    );
    assert.equal(
        PostInternalImageGenerateRequestSchema.safeParse({
            ...requestPayload,
            outputCompression: 0,
        }).success,
        true
    );
    assert.equal(
        PostInternalImageGenerateRequestSchema.safeParse({
            ...requestPayload,
            outputCompression: 101,
        }).success,
        false
    );
    assert.equal(
        PostInternalImageRequestSchema.safeParse({
            task: 'render',
            prompt: 'hello',
        }).success,
        false
    );

    const responsePayload = {
        task: 'generate',
        result: {
            responseId: 'resp_123',
            textModel: 'gpt-5-mini',
            imageModel: 'gpt-image-1-mini',
            revisedPrompt: 'draw a reflective skyline at dusk',
            finalStyle: 'vivid',
            annotations: {
                title: 'Reflective Skyline',
                description: 'A city scene at dusk.',
                note: 'The skyline emphasizes calm light.',
                adjustedPrompt: 'draw a reflective skyline at dusk',
            },
            finalImageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
            outputFormat: 'png',
            outputCompression: 0,
            usage: {
                inputTokens: 42,
                outputTokens: 18,
                totalTokens: 60,
                imageCount: 0,
                partialImageCount: 0,
            },
            costs: {
                text: 0.000046,
                image: 0.011,
                total: 0.011046,
                perImage: 0.011,
            },
            generationTimeMs: 2100,
        },
    } as const;

    assert.equal(
        PostInternalImageGenerateResponseSchema.safeParse(responsePayload)
            .success,
        true
    );
    assert.equal(
        PostInternalImageResponseSchema.safeParse(responsePayload).success,
        true
    );
    assert.equal(
        InternalImageStreamEventSchema.safeParse({
            type: 'partial_image',
            index: 0,
            base64: 'aGVsbG8=',
        }).success,
        true
    );
    assert.equal(
        InternalImageStreamEventSchema.safeParse({
            type: 'result',
            task: 'generate',
            result: responsePayload.result,
        }).success,
        true
    );
    assert.equal(
        InternalImageStreamEventSchema.safeParse({
            type: 'error',
            error: 'Failed to execute internal image task',
        }).success,
        true
    );
});

test('internal image schema enums stay aligned with the shared model registry', () => {
    const requestTextOptions =
        PostInternalImageGenerateRequestSchema.shape.textModel.options;
    const requestImageOptions =
        PostInternalImageGenerateRequestSchema.shape.imageModel.options;
    const responseTextOptions =
        PostInternalImageGenerateResponseSchema.shape.result.shape.textModel
            .options;
    const responseImageOptions =
        PostInternalImageGenerateResponseSchema.shape.result.shape.imageModel
            .options;

    assert.deepEqual(requestTextOptions, [...internalImageTextModels]);
    assert.deepEqual(requestImageOptions, [...internalImageRenderModels]);
    assert.deepEqual(responseTextOptions, [...internalImageTextModels]);
    assert.deepEqual(responseImageOptions, [...internalImageRenderModels]);
});

test('openapi internal image enums stay aligned with the shared model registry', () => {
    const normalizedOpenApiSource = openApiSource.replace(/\s+/g, ' ');
    const buildEnumPattern = (values: readonly string[]) =>
        `enum:\\s*\\[\\s*${values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(',\\s*')}\\s*,?\\s*\\]`;

    const textEnumMatches = normalizedOpenApiSource.match(
        new RegExp(buildEnumPattern(internalImageTextModels), 'g')
    );
    const imageEnumMatches = normalizedOpenApiSource.match(
        new RegExp(buildEnumPattern(internalImageRenderModels), 'g')
    );

    assert.ok((textEnumMatches?.length ?? 0) >= 2);
    assert.ok((imageEnumMatches?.length ?? 0) >= 2);
});

test('internal image schema validator stays assignable to shared contract types', () => {
    const validator = createSchemaResponseValidator(
        PostInternalImageGenerateResponseSchema
    );
    const endpointValidator = createSchemaResponseValidator(
        PostInternalImageResponseSchema
    );
    const typedValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PostInternalImageGenerateResponse> =
        validator;
    const typedEndpointValidator: (
        data: unknown
    ) => ApiResponseValidationResult<PostInternalImageResponse> =
        endpointValidator;

    assert.equal(typeof typedValidator, 'function');
    assert.equal(typeof typedEndpointValidator, 'function');
});
