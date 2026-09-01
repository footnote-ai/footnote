/**
 * @description: Verifies /chat slash command request forwarding and action handling.
 * @footnote-scope: test
 * @footnote-module: ChatCommandTests
 * @footnote-risk: low - These tests only cover command-level wiring.
 * @footnote-ethics: medium - Ensures model/profile selector inputs are forwarded as requested.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type {
    PostChatRequest,
    PostChatResponse,
} from '@footnote/contracts/web';
import { botApi } from '../src/api/botApi.js';
import chatCommand from '../src/commands/chat.js';
import { runtimeConfig } from '../src/config.js';

type BasicOutputFixture = {
    question: string;
    response: Extract<PostChatResponse, { action: 'message' }>;
};

const basicOutputFixture = JSON.parse(
    readFileSync(
        new URL(
            '../../../test/basic-output-check/fixtures/ordinary-text-answer.json',
            import.meta.url
        ),
        'utf8'
    )
) as BasicOutputFixture;

const createInteraction = (overrides: {
    prompt?: string;
    modeId?: string | null;
    maxReviewCycles?: number | null;
    plannerProfileId?: string | null;
    generateProfileId?: string | null;
    assessProfileId?: string | null;
    traceTightness?: number | null;
    traceRationale?: number | null;
    traceAttribution?: number | null;
    traceCaution?: number | null;
    traceExtent?: number | null;
    id?: string;
}) => {
    const editReplyPayloads: unknown[] = [];
    const deferReplyPayloads: unknown[] = [];

    return {
        interaction: {
            id: overrides.id ?? 'interaction-1',
            channelId: 'channel-123',
            guildId: 'guild-456',
            user: {
                id: 'user-789',
            },
            options: {
                getString: (name: string, required?: boolean) => {
                    if (name === 'prompt') {
                        if (required && !overrides.prompt) {
                            throw new Error('required prompt missing');
                        }
                        return overrides.prompt ?? null;
                    }
                    if (name === 'mode') {
                        return overrides.modeId ?? null;
                    }
                    if (name === 'planner_profile_id') {
                        return overrides.plannerProfileId ?? null;
                    }
                    if (name === 'generate_profile_id') {
                        return overrides.generateProfileId ?? null;
                    }
                    if (name === 'assess_profile_id') {
                        return overrides.assessProfileId ?? null;
                    }
                    return null;
                },
                getInteger: (name: string) => {
                    if (name === 'max_review_cycles') {
                        return overrides.maxReviewCycles ?? null;
                    }
                    if (name === 'trace_tightness') {
                        return overrides.traceTightness ?? null;
                    }
                    if (name === 'trace_rationale') {
                        return overrides.traceRationale ?? null;
                    }
                    if (name === 'trace_attribution') {
                        return overrides.traceAttribution ?? null;
                    }
                    if (name === 'trace_caution') {
                        return overrides.traceCaution ?? null;
                    }
                    if (name === 'trace_extent') {
                        return overrides.traceExtent ?? null;
                    }
                    return null;
                },
            },
            deferReply: async (payload?: unknown) => {
                deferReplyPayloads.push(payload);
            },
            editReply: async (payload: unknown) => {
                editReplyPayloads.push(payload);
            },
        },
        editReplyPayloads,
        deferReplyPayloads,
    };
};

test('/chat forwards prompt/workflow options and renders message action', async () => {
    const originalChatViaApi = botApi.chatViaApi;
    const originalPostTraceCardFromTrace = botApi.postTraceCardFromTrace;
    const seenRequests: unknown[] = [];
    botApi.chatViaApi = (async (request) => {
        seenRequests.push(request);
        return {
            action: 'message',
            message: 'Model-switched response',
            modality: 'text',
            metadata: {
                responseId: 'resp_123',
                provenance: 'Inferred',
                safetyTier: 'Low',
                tradeoffCount: 0,
                chainHash: 'hash_123',
                licenseContext: 'MIT + HL3',
                modelVersion: 'gpt-5-mini',
                staleAfter: new Date(Date.now() + 60000).toISOString(),
                citations: [],
                execution: [
                    {
                        kind: 'tool',
                        toolName: 'web_search',
                        status: 'skipped',
                        reasonCode: 'search_not_supported_by_selected_profile',
                    },
                ],
            },
        };
    }) as typeof botApi.chatViaApi;
    botApi.postTraceCardFromTrace = (async (request, _options) => ({
        responseId: request.responseId,
        pngBase64: Buffer.from('trace-card').toString('base64'),
    })) as typeof botApi.postTraceCardFromTrace;

    const { interaction, editReplyPayloads, deferReplyPayloads } =
        createInteraction({
            prompt: 'Compare model output.',
            modeId: 'grounded',
            maxReviewCycles: 4,
            traceTightness: 4,
            traceRationale: 2,
            traceAttribution: 5,
            traceCaution: 3,
            traceExtent: 1,
        });

    try {
        await chatCommand.execute(interaction as never);
        assert.equal(deferReplyPayloads.length, 1);
        assert.equal(editReplyPayloads.length, 1);
        assert.deepEqual(seenRequests, [
            {
                surface: 'discord',
                botPersonaId: 'footnote',
                assistantIdentity: {
                    displayName: 'Footnote',
                    mentionAliases: [],
                },
                modeId: 'grounded',
                maxReviewCycles: 4,
                traceTarget: {
                    tightness: 4,
                    rationale: 2,
                    attribution: 5,
                    caution: 3,
                    extent: 1,
                },
                trigger: {
                    kind: 'submit',
                    messageId: 'interaction-1',
                },
                latestUserInput: 'Compare model output.',
                conversation: [
                    {
                        role: 'user',
                        content: 'Compare model output.',
                    },
                ],
                capabilities: {
                    canReact: true,
                    canGenerateImages: true,
                    canUseTts: true,
                },
                surfaceContext: {
                    channelId: 'channel-123',
                    guildId: 'guild-456',
                    userId: 'user-789',
                },
            },
        ]);
        const payload = editReplyPayloads[0] as {
            content?: string;
            components?: unknown[];
            files?: unknown[];
        };
        assert.match(
            String(payload.content),
            /^> mode: grounded\n> max_review_cycles: 4\n> trace_tightness: 4\n> trace_rationale: 2\n> trace_attribution: 5\n> trace_caution: 3\n> trace_extent: 1\n\n⚠️ search unavailable for selected model\n\nModel-switched response$/
        );
        assert.equal(Array.isArray(payload.components), true);
        assert.equal(payload.components?.length, 1);
        assert.equal(Array.isArray(payload.files), true);
        assert.equal(payload.files?.length, 1);
    } finally {
        botApi.chatViaApi = originalChatViaApi;
        botApi.postTraceCardFromTrace = originalPostTraceCardFromTrace;
    }
});

test('/chat carries configured expression strength as a profile preference', async () => {
    const originalChatViaApi = botApi.chatViaApi;
    const originalProfile = runtimeConfig.profile;
    const runtimeConfigMutable = runtimeConfig as unknown as {
        profile: typeof originalProfile;
    };
    runtimeConfigMutable.profile = {
        ...originalProfile,
        personaExpressionStrength: 'strong',
    };
    let seenRequest: PostChatRequest | undefined;
    botApi.chatViaApi = (async (request) => {
        seenRequest = request;
        return { action: 'ignore', metadata: null };
    }) as typeof botApi.chatViaApi;

    const { interaction } = createInteraction({
        prompt: 'Use the configured persona.',
    });

    try {
        await chatCommand.execute(interaction as never);
        assert.equal(seenRequest?.personaExpressionProfileStrength, 'strong');
        assert.equal(seenRequest?.personaExpressionStrength, undefined);
    } finally {
        botApi.chatViaApi = originalChatViaApi;
        runtimeConfigMutable.profile = originalProfile;
    }
});

test('/chat renders the shared basic output fixture', async () => {
    const originalChatViaApi = botApi.chatViaApi;
    const originalPostTraceCardFromTrace = botApi.postTraceCardFromTrace;
    const seenRequests: unknown[] = [];
    const seenTraceCardRequests: unknown[] = [];
    botApi.chatViaApi = (async (request) => {
        seenRequests.push(request);
        return basicOutputFixture.response;
    }) as typeof botApi.chatViaApi;
    botApi.postTraceCardFromTrace = (async (request, _options) => {
        seenTraceCardRequests.push(request);
        return {
            responseId: request.responseId,
            pngBase64: Buffer.from('trace-card').toString('base64'),
        };
    }) as typeof botApi.postTraceCardFromTrace;

    const { interaction, editReplyPayloads, deferReplyPayloads } =
        createInteraction({
            prompt: basicOutputFixture.question,
        });

    try {
        await chatCommand.execute(interaction as never);
        assert.equal(deferReplyPayloads.length, 1);
        assert.equal(editReplyPayloads.length, 1);
        assert.deepEqual(seenRequests, [
            {
                surface: 'discord',
                botPersonaId: 'footnote',
                assistantIdentity: {
                    displayName: 'Footnote',
                    mentionAliases: [],
                },
                trigger: {
                    kind: 'submit',
                    messageId: 'interaction-1',
                },
                latestUserInput: basicOutputFixture.question,
                conversation: [
                    {
                        role: 'user',
                        content: basicOutputFixture.question,
                    },
                ],
                capabilities: {
                    canReact: true,
                    canGenerateImages: true,
                    canUseTts: true,
                },
                surfaceContext: {
                    channelId: 'channel-123',
                    guildId: 'guild-456',
                    userId: 'user-789',
                },
            },
        ]);

        const payload = editReplyPayloads[0] as {
            content?: string;
            components?: unknown[];
            files?: Array<{ attachment?: unknown; name?: string }>;
        };
        assert.equal(payload.content, basicOutputFixture.response.message);
        assert.deepEqual(seenTraceCardRequests, [
            { responseId: basicOutputFixture.response.metadata.responseId },
        ]);

        const serializedComponents = JSON.parse(
            JSON.stringify(payload.components)
        ) as Array<{
            components?: Array<{ custom_id?: string }>;
        }>;
        assert.deepEqual(
            serializedComponents.flatMap(
                (row) => row.components?.map((button) => button.custom_id) ?? []
            ),
            [
                `details:${basicOutputFixture.response.metadata.responseId}`,
                `report_issue:${basicOutputFixture.response.metadata.responseId}`,
            ]
        );
        assert.deepEqual(
            payload.files?.map((file) => file.name),
            ['trace-card.png']
        );
        assert.equal(Buffer.isBuffer(payload.files?.[0]?.attachment), true);
    } finally {
        botApi.chatViaApi = originalChatViaApi;
        botApi.postTraceCardFromTrace = originalPostTraceCardFromTrace;
    }
});

test('/chat handles non-message actions gracefully', async () => {
    const originalChatViaApi = botApi.chatViaApi;
    botApi.chatViaApi = (async () => {
        return {
            action: 'react',
            reaction: '👍',
            metadata: null,
        };
    }) as typeof botApi.chatViaApi;

    const { interaction, editReplyPayloads } = createInteraction({
        prompt: 'React to this.',
    });

    try {
        await chatCommand.execute(interaction as never);
        assert.equal(editReplyPayloads.length, 1);
        assert.match(
            String((editReplyPayloads[0] as { content?: string }).content),
            /^Backend selected reaction mode \(👍\). \/chat currently returns text only\.$/i
        );
    } finally {
        botApi.chatViaApi = originalChatViaApi;
    }
});

test('/chat forwards optional step profile overrides', async () => {
    const originalChatViaApi = botApi.chatViaApi;
    const seenRequests: unknown[] = [];
    botApi.chatViaApi = (async (request) => {
        seenRequests.push(request);
        return {
            action: 'ignore',
            metadata: null,
        };
    }) as typeof botApi.chatViaApi;

    const { interaction } = createInteraction({
        prompt: 'Use a specific profile chain.',
        plannerProfileId: 'openai-text-fast',
        generateProfileId: 'openai-text-medium',
        assessProfileId: 'ollama-text-gptoss',
    });

    try {
        await chatCommand.execute(interaction as never);
        assert.equal(seenRequests.length, 1);
        assert.deepEqual(
            (seenRequests[0] as { plannerProfileId?: string }).plannerProfileId,
            'openai-text-fast'
        );
        assert.deepEqual(
            (seenRequests[0] as { generateProfileId?: string })
                .generateProfileId,
            'openai-text-medium'
        );
        assert.deepEqual(
            (seenRequests[0] as { assessProfileId?: string }).assessProfileId,
            'ollama-text-gptoss'
        );
    } finally {
        botApi.chatViaApi = originalChatViaApi;
    }
});
