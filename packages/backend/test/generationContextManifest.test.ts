/**
 * @description: Verifies the generation-facing source manifest preserves authoritative context status.
 * @footnote-scope: test
 * @footnote-module: GenerationContextManifestTests
 * @footnote-risk: high - Incorrect source state can make a model claim that unavailable evidence was checked.
 * @footnote-ethics: high - Accurate evidence boundaries are required for honest human-facing answers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContextStepResult } from '@footnote/contracts/policy';
import type { ConversationContextEnvelope } from '../src/services/conversationContextService.js';
import {
    buildGenerationContextManifest,
    renderGenerationContextManifest,
} from '../src/services/workflowEngine/contextManifest.js';

const contextEnvelope: ConversationContextEnvelope = {
    participants: [],
    turns: [
        {
            turnId: 'turn-1',
            role: 'user',
            speakerId: 'user-1',
            speakerLabel: 'Jordan',
            visibility: 'model_visible',
            authority: 'conversation',
        },
    ],
    diagnostics: {
        surface: 'web',
        totalInputMessages: 1,
        projectedMessageCount: 1,
        trimmedMessageCount: 0,
        sanitizedTimestampCount: 0,
        projectedSpeakerLabelCount: 0,
    },
};

const projectContextResult = (
    status: 'current' | 'partial' | 'stale',
    hasEvidence: boolean
): ContextStepResult => ({
    outcome: 'executed',
    executionContext: {
        toolName: 'project_context',
        status: 'executed',
    },
    ...(hasEvidence && {
        evidence: {
            content: ['UNTRUSTED PROJECT CONTEXT: excerpt'],
        },
    }),
    integrationContext: {
        kind: 'project_context',
        version: 'v1',
        payload: {
            metadata: {
                status,
                returnedCounts: hasEvidence ? { current_state: 1 } : {},
            },
        },
    },
});

test('buildGenerationContextManifest preserves conversation, prompt, and retrieval states', () => {
    const manifest = buildGenerationContextManifest({
        contextEnvelope,
        contextStepRequests: [
            {
                integrationName: 'project_context',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'github_context',
                requested: true,
                eligible: true,
            },
        ],
        contextStepResults: [
            projectContextResult('partial', true),
            {
                outcome: 'skipped',
                executionContext: {
                    toolName: 'github_context',
                    status: 'skipped',
                    reasonCode: 'tool_unavailable',
                },
            },
        ],
    });

    assert.deepEqual(
        manifest.entries.map(({ source, status, requested }) => ({
            source,
            status,
            requested,
        })),
        [
            { source: 'conversation', status: 'available', requested: true },
            { source: 'prompt', status: 'available', requested: true },
            {
                source: 'project_context',
                status: 'partial',
                requested: true,
            },
            {
                source: 'github_context',
                status: 'unavailable',
                requested: true,
            },
        ]
    );
    assert.equal(manifest.entries[2]?.scope, 'approved project documents');
    assert.equal(
        manifest.entries[3]?.scope,
        'bounded GitHub repository metadata'
    );
});

test('renderGenerationContextManifest states that absent retrieval is not absent conversation evidence', () => {
    const rendered = renderGenerationContextManifest({
        version: 'v1',
        entries: [
            {
                source: 'conversation',
                authority: 'conversation',
                requested: true,
                status: 'available',
                scope: 'direct conversation messages',
            },
            {
                source: 'github_context',
                authority: 'advisory',
                requested: true,
                status: 'empty',
                scope: 'bounded GitHub repository metadata',
            },
        ],
    });

    assert.match(rendered, /conversation.*available/iu);
    assert.match(rendered, /github_context.*empty/iu);
    assert.match(rendered, /not evidence that a name was absent/iu);
    assert.match(rendered, /source files were inspected/iu);
});

test('buildGenerationContextManifest distinguishes retrieved, empty, failed, skipped, and not-requested sources', () => {
    const manifest = buildGenerationContextManifest({
        contextEnvelope,
        contextStepRequests: [
            {
                integrationName: 'github_context',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'project_context',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'web_search',
                requested: true,
                eligible: true,
            },
            {
                integrationName: 'weather_forecast',
                requested: true,
                eligible: true,
            },
        ],
        contextStepResults: [
            {
                outcome: 'executed',
                executionContext: {
                    toolName: 'github_context',
                    status: 'executed',
                },
                evidence: {
                    content: ['UNTRUSTED GITHUB CONTEXT: record'],
                },
                integrationContext: {
                    kind: 'github_context',
                    version: 'v1',
                    payload: { metadata: { status: 'current' } },
                },
            },
            projectContextResult('current', false),
            {
                outcome: 'failed',
                executionContext: {
                    toolName: 'web_search',
                    status: 'failed',
                    reasonCode: 'tool_execution_error',
                },
            },
            {
                outcome: 'skipped',
                executionContext: {
                    toolName: 'weather_forecast',
                    status: 'skipped',
                    reasonCode: 'tool_not_used',
                },
            },
        ],
    });

    assert.deepEqual(
        manifest.entries
            .slice(2)
            .map(({ source, status }) => ({ source, status })),
        [
            { source: 'github_context', status: 'retrieved' },
            { source: 'project_context', status: 'empty' },
            { source: 'web_search', status: 'failed' },
            { source: 'weather_forecast', status: 'skipped' },
        ]
    );

    const notRequested = buildGenerationContextManifest({
        contextEnvelope,
        contextStepRequests: [],
        contextStepResults: [
            {
                outcome: 'skipped',
                executionContext: {
                    toolName: 'github_context',
                    status: 'skipped',
                    reasonCode: 'tool_not_requested',
                },
            },
        ],
    });
    assert.equal(notRequested.entries[2]?.status, 'not_requested');
});

test('buildGenerationContextManifest reports requested web search without claiming results', () => {
    const manifest = buildGenerationContextManifest({
        contextEnvelope,
        contextStepRequests: [],
        contextStepResults: [],
        webSearchRequested: true,
        webSearchAvailable: true,
    });
    const webSearch = manifest.entries.find(
        (entry) => entry.source === 'web_search'
    );
    assert.deepEqual(
        {
            requested: webSearch?.requested,
            status: webSearch?.status,
        },
        { requested: true, status: 'requested' }
    );
});
