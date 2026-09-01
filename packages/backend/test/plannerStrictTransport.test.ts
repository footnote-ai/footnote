/**
 * @description: Covers planner strict transport outcomes and null-to-canonical normalization.
 * @footnote-scope: test
 * @footnote-module: PlannerStrictTransportTests
 * @footnote-risk: medium - Missing outcome coverage can hide provider failures behind generic fallbacks.
 * @footnote-ethics: high - Explicit failure attribution prevents incomplete policy facts from being mistaken for planner decisions.
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
    createChatPlanner,
    ChatPlannerStructuredOutputError,
} from '../src/services/chatPlanner.js';
import {
    projectPlannerSchemaForStrictOutput,
    removePlannerTransportNulls,
} from '../src/services/plannerSchemaAdapter.js';
import { chatPlannerDecisionParametersSchema } from '../src/services/chatPlannerOutputContract.js';
import type { PostChatRequest } from '@footnote/contracts/web';

const request: PostChatRequest = {
    surface: 'web',
    trigger: { kind: 'submit' },
    latestUserInput: 'Say hello.',
    conversation: [{ role: 'user', content: 'Say hello.' }],
    capabilities: {
        canReact: false,
        canGenerateImages: false,
        canUseTts: false,
    },
};

const invocation = {
    owner: 'workflow' as const,
    workflowName: 'chat_orchestration',
    stepKind: 'plan' as const,
    purpose: 'chat_orchestrator_action_selection' as const,
};

const validDecision = {
    action: 'message',
    modality: 'text',
    requestedCapabilityProfile: 'balanced-general',
    safetyTier: 'Low',
    reasoning: 'A normal message is sufficient.',
    trustGraphTargetIds: [],
    generation: {
        verbosity: 'low',
        temperament: {
            tightness: 3,
            rationale: 3,
            attribution: 3,
            caution: 3,
            extent: 3,
        },
    },
};

test('strict planner transport maps nullable fields before canonical normalization', async () => {
    const planner = createChatPlanner({
        executePlannerStructured: async () => ({
            decision: removePlannerTransportNulls({
                ...validDecision,
                reaction: null,
                generation: { ...validDecision.generation, search: null },
            }),
        }),
    });
    const result = await planner.planChat(request, invocation);
    assert.equal(result.execution.status, 'executed');
    assert.equal(result.execution.structuredOutputOutcome, 'strict_success');
});

test('strict planner failures retain typed fail-open outcomes', async () => {
    const outcomes = [
        'unsupported_route',
        'refusal',
        'incomplete',
        'no_output',
        'schema_rejected',
        'parse_failure',
        'runtime_failure',
    ] as const;
    for (const outcome of outcomes) {
        const planner = createChatPlanner({
            executePlannerStructured: async () => {
                throw new ChatPlannerStructuredOutputError(
                    outcome,
                    `synthetic ${outcome}`
                );
            },
        });
        const result = await planner.planChat(request, invocation);
        assert.equal(result.execution.status, 'failed', outcome);
        assert.equal(result.execution.structuredOutputOutcome, outcome);
    }
});

test('strict planner keeps text JSON as a bounded compatibility fallback', async () => {
    const planner = createChatPlanner({
        allowTextJsonCompatibilityFallback: true,
        executePlannerStructured: async () => {
            throw new ChatPlannerStructuredOutputError(
                'schema_rejected',
                'synthetic schema rejection'
            );
        },
        executePlanner: async () => ({
            text: JSON.stringify(validDecision),
            model: 'compatibility-model',
        }),
    });

    const result = await planner.planChat(request, invocation);
    assert.equal(result.execution.status, 'executed');
    assert.equal(
        result.execution.structuredOutputOutcome,
        'text_json_compatibility'
    );
});

test('structured schema requires nullable transport properties without changing canonical schema', () => {
    const strictSchema = projectPlannerSchemaForStrictOutput(
        chatPlannerDecisionParametersSchema
    );
    assert.deepEqual(
        strictSchema.required,
        Object.keys(strictSchema.properties as object)
    );
    const generation = (
        strictSchema.properties as Record<string, Record<string, unknown>>
    ).generation;
    assert.deepEqual(generation.type, ['object', 'null']);
    assert.deepEqual(
        chatPlannerDecisionParametersSchema.required,
        [
            'action',
            'modality',
            'safetyTier',
            'reasoning',
            'trustGraphTargetIds',
            'generation',
        ],
        'canonical schema remains independently owned'
    );
});
