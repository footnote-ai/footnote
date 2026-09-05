/**
 * @description: Verifies the trusted agent chat client preserves the canonical request and complete response contract.
 * @footnote-scope: test
 * @footnote-module: AgentChatClientTests
 * @footnote-risk: low - Missing client tests could cause agents to exercise a different request path than web or Discord.
 * @footnote-ethics: medium - Test tooling must preserve caller identity and response transparency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { PostChatRequest } from '@footnote/contracts/web';
import {
    buildPromptRequest,
    formatAgentChatStartMessage,
    parseAgentChatArguments,
    resolveAgentChatUrl,
    sendAgentChatRequest,
} from './agent-chat.js';

const fullRequest: PostChatRequest = {
    surface: 'discord',
    botPersonaId: 'footnote',
    assistantIdentity: {
        displayName: 'Footnote',
        mentionAliases: ['footnote'],
    },
    personaExpressionProfileStrength: 'balanced',
    personaExpressionStrength: 'subtle',
    modeId: 'grounded',
    maxReviewCycles: 2,
    traceTarget: {
        tightness: 3,
        rationale: 3,
        attribution: 4,
        caution: 3,
        extent: 3,
    },
    plannerProfileId: 'openrouter-deepseek-v4-flash-0731',
    generateProfileId: 'openrouter-deepseek-v4-flash-0731',
    assessProfileId: 'openrouter-deepseek-v4-flash-0731',
    trigger: {
        kind: 'direct',
        messageId: 'message-1',
        addressing: {
            participants: [
                {
                    kind: 'persona',
                    relation: 'explicit_mention',
                    personaId: 'footnote',
                    displayName: 'Footnote',
                },
            ],
            resolution: 'complete',
            assistantMentioned: true,
            replyToAssistant: false,
            otherParticipantMentioned: false,
            replyToOtherParticipant: false,
        },
    },
    latestUserInput: 'Explain the test.',
    conversation: [
        {
            role: 'user',
            content: 'Explain the test.',
            authorName: 'Jordan',
            authorId: 'user-1',
            messageId: 'message-1',
            createdAt: '2026-09-05T00:00:00.000Z',
        },
    ],
    attachments: [
        {
            kind: 'file',
            url: 'https://example.com/test.txt',
            contentType: 'text/plain',
        },
    ],
    capabilities: {
        canReact: true,
        canGenerateImages: true,
        canUseTts: true,
    },
    sessionId: 'agent-session-1',
    surfaceContext: {
        channelId: 'channel-1',
        guildId: 'guild-1',
        userId: 'user-1',
        requestHost: 'agent.test',
    },
};

test('prompt convenience mode builds a valid surface-shaped request', () => {
    const request = buildPromptRequest({
        prompt: 'Hello from an agent.',
        surface: 'web',
        triggerKind: 'submit',
        modeId: 'balanced',
    });

    assert.deepEqual(request, {
        surface: 'web',
        modeId: 'balanced',
        trigger: { kind: 'submit' },
        latestUserInput: 'Hello from an agent.',
        conversation: [{ role: 'user', content: 'Hello from an agent.' }],
        capabilities: {
            canReact: false,
            canGenerateImages: false,
            canUseTts: false,
        },
    });
});

test('request-file mode and transport preserve every request option', async () => {
    const captured = {
        url: new URL('about:blank'),
        init: {} as RequestInit,
    };
    const responseBody = {
        action: 'message',
        message: 'Complete response body.',
        modality: 'text',
        metadata: {
            responseId: 'response-1',
            chainHash: 'hash-1',
            provenance: 'Inferred',
            safetyTier: 'Low',
            citations: [],
        },
    };

    const result = await sendAgentChatRequest({
        baseUrl: 'https://backend.example',
        agentToken: 'agent-secret',
        request: fullRequest,
        fetchImpl: async (input, init) => {
            captured.url = new URL(input.toString());
            captured.init = init ?? {};
            return new Response(JSON.stringify(responseBody), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });

    assert.equal(captured.url.toString(), 'https://backend.example/api/chat');
    assert.deepEqual(captured.init.headers, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Agent-Token': 'agent-secret',
        'X-Session-Id': 'agent-session-1',
    });
    assert.deepEqual(JSON.parse(String(captured.init.body)), fullRequest);
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);
    assert.deepEqual(result.body, responseBody);
    assert.equal(captured.init.redirect, 'error');
});

test('agent chat URL requires HTTPS except for exact loopback hosts', () => {
    assert.equal(
        resolveAgentChatUrl('http://localhost:3000').toString(),
        'http://localhost:3000/api/chat'
    );
    assert.equal(
        resolveAgentChatUrl('http://127.0.0.1:3000').toString(),
        'http://127.0.0.1:3000/api/chat'
    );
    assert.equal(
        resolveAgentChatUrl('https://backend.example').toString(),
        'https://backend.example/api/chat'
    );
    assert.throws(
        () => resolveAgentChatUrl('http://backend.example'),
        /must use HTTPS/
    );
    assert.throws(
        () => resolveAgentChatUrl('http://localhost.example'),
        /must use HTTPS/
    );
});

test('argument parser requires exactly one request source', () => {
    assert.throws(
        () => parseAgentChatArguments([]),
        /exactly one of --request-file <path> or --prompt <text>/
    );
    assert.throws(
        () =>
            parseAgentChatArguments([
                '--prompt',
                'hello',
                '--request-file',
                'request.json',
            ]),
        /exactly one of --request-file <path> or --prompt <text>/
    );
});

test('start message makes the wait and retry behavior explicit', () => {
    assert.equal(
        formatAgentChatStartMessage(180_000),
        '[agent-chat] waiting for complete response; timeout=180000ms; retries=0'
    );
});
