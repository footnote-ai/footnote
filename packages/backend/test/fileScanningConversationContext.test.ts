/**
 * @description: Verifies image scan reuse, refresh, expiry, and fail-open behavior.
 * @footnote-scope: test
 * @footnote-module: FileScanningConversationContextTests
 * @footnote-risk: low - Tests cover backend image-context continuity behavior.
 * @footnote-ethics: medium - Tests guard privacy, retention, and provenance boundaries.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { PostInternalImageDescriptionTaskResponse } from '@footnote/contracts/web';
import { createFileScanningContextStepExecutor } from '../src/services/contextIntegrations/fileScanning/fileScanningContextStepExecutor.js';
import { ConversationImageContextStore } from '../src/services/contextIntegrations/fileScanning/conversationImageContextStore.js';
import { createReverseImageSearchContextStepExecutor } from '../src/services/contextIntegrations/reverseImageSearch/reverseImageSearchContextStepExecutor.js';
import type { ContextStepExecutorInput } from '../src/services/workflowCore/reviewedChatWorkflow.js';

const scope = { surface: 'web', sessionId: 'session-a', userId: 'user-a' };
const attachment = {
    kind: 'image',
    url: 'https://images.test/a',
    contentType: 'image/png',
};
const request = (
    latestUserInput: string,
    attachments: unknown[] = [attachment]
): ContextStepExecutorInput => ({
    request: {
        integrationName: 'file_scan',
        requested: true,
        eligible: true,
        input: { latestUserInput, attachments, imageContextScope: scope },
    },
    workflowId: 'workflow-a',
    workflowName: 'chat',
    attempt: 1,
});

test('reuses a bounded scan without another provider call; explicit refresh scans current bytes', async () => {
    let providerCalls = 0;
    const executor = createFileScanningContextStepExecutor({
        imageContextStore: new ConversationImageContextStore(),
        logger: { warn: () => undefined },
        imageDescriptionTaskService: {
            runImageDescriptionTask: async () => {
                providerCalls += 1;
                return {
                    task: 'image_description',
                    result: {
                        description: 'a red bicycle beside a brick wall',
                        model: 'test',
                        usage: {
                            inputTokens: 1,
                            outputTokens: 1,
                            totalTokens: 2,
                        },
                        costs: { input: 0, output: 0, total: 0 },
                    },
                } satisfies PostInternalImageDescriptionTaskResponse;
            },
        },
    });

    const first = await executor(request('Describe this image'));
    const followUp = await executor(
        request('What else is in this picture?', [])
    );
    const refreshed = await executor(
        request('Refresh and scan this image again')
    );

    assert.equal(providerCalls, 2);
    assert.ok(first.outcome === 'executed');
    assert.ok(followUp.outcome === 'executed');
    assert.equal(
        (first.integrationContext?.payload as { disposition: string })
            .disposition,
        'scanned'
    );
    assert.equal(
        (followUp.integrationContext?.payload as { disposition: string })
            .disposition,
        'reused'
    );
    assert.equal(
        (
            followUp.integrationContext?.payload as {
                metadata: { status: string };
            }
        ).metadata.status,
        'current'
    );
    assert.deepEqual(followUp.evidence, first.evidence);
    assert.equal(
        followUp.sources?.some((source) => source.url === attachment.url),
        false
    );
    assert.equal(
        (refreshed.integrationContext?.payload as { disposition: string })
            .disposition,
        'refreshed'
    );
});

test('does not guess among two images or rescan when original bytes are not attached', async () => {
    let providerCalls = 0;
    const store = new ConversationImageContextStore();
    const executor = createFileScanningContextStepExecutor({
        imageContextStore: store,
        logger: { warn: () => undefined },
        imageDescriptionTaskService: {
            runImageDescriptionTask: async () => {
                providerCalls += 1;
                return {
                    task: 'image_description',
                    result: {
                        description: 'bounded fact',
                        model: 'test',
                        usage: {
                            inputTokens: 1,
                            outputTokens: 1,
                            totalTokens: 2,
                        },
                        costs: { input: 0, output: 0, total: 0 },
                    },
                } satisfies PostInternalImageDescriptionTaskResponse;
            },
        },
    });
    await executor(request('Describe this image'));
    await executor(
        request('Describe this image', [
            { ...attachment, url: 'https://images.test/b' },
        ])
    );

    const ambiguous = await executor(request('What about that image?', []));
    const noSession = await executor({
        ...request('Describe this image'),
        request: {
            ...request('Describe this image').request,
            input: {
                latestUserInput: 'Describe this image',
                attachments: [attachment],
            },
        },
    });
    const noSessionFollowUp = await executor({
        ...request('What about this image?', []),
        request: {
            ...request('What about this image?', []).request,
            input: {
                latestUserInput: 'What about this image?',
                attachments: [],
            },
        },
    });

    assert.equal(providerCalls, 3);
    assert.equal(
        (ambiguous.integrationContext?.payload as { disposition: string })
            .disposition,
        'ambiguous'
    );
    assert.equal(
        (
            ambiguous.integrationContext?.payload as {
                metadata: { status: string };
            }
        ).metadata.status,
        'unavailable'
    );
    assert.equal(
        (noSession.integrationContext?.payload as { disposition: string })
            .disposition,
        'not_retained'
    );
    assert.equal(
        (
            noSessionFollowUp.integrationContext?.payload as {
                disposition: string;
            }
        ).disposition,
        'unavailable'
    );
});

test('reverse-search sources reuse in the same conversation without provider rescan', async () => {
    let providerCalls = 0;
    const executor = createReverseImageSearchContextStepExecutor({
        imageContextStore: new ConversationImageContextStore(),
        logger: { warn: () => undefined },
        provider: {
            search: async () => {
                providerCalls += 1;
                return {
                    providerId: 'test-search',
                    summary: 'a mountain landscape',
                    matches: [
                        { title: 'Example', url: 'https://source.test/a' },
                    ],
                };
            },
        },
    });
    const first = await executor({
        ...request('Describe this image'),
        request: {
            ...request('Describe this image').request,
            integrationName: 'reverse_image_search',
        },
    });
    const followUp = await executor({
        ...request('What about this image?', []),
        request: {
            ...request('What about this image?', []).request,
            integrationName: 'reverse_image_search',
        },
    });

    assert.equal(providerCalls, 1);
    assert.ok(first.outcome === 'executed');
    assert.ok(followUp.outcome === 'executed');
    assert.deepEqual(followUp.sources, first.sources);
    assert.equal(
        (followUp.integrationContext?.payload as { disposition: string })
            .disposition,
        'reused'
    );
});

test('failed image scanning remains fail-open and is not retained as usable context', async () => {
    let providerCalls = 0;
    const executor = createFileScanningContextStepExecutor({
        imageContextStore: new ConversationImageContextStore(),
        logger: { warn: () => undefined },
        imageDescriptionTaskService: {
            runImageDescriptionTask: async () => {
                providerCalls += 1;
                throw new Error('image URL is no longer available');
            },
        },
    });
    const failedScan = await executor(request('Describe this image'));
    const followUp = await executor(request('What about this image?', []));

    assert.equal(providerCalls, 1);
    assert.equal(failedScan.outcome, 'executed');
    assert.equal(
        (failedScan.integrationContext?.payload as { disposition: string })
            .disposition,
        'provider_failed'
    );
    assert.equal(
        (followUp.integrationContext?.payload as { disposition: string })
            .disposition,
        'unavailable'
    );
});

test('expired context is reported and never triggers a provider rescan by itself', async () => {
    let providerCalls = 0;
    const store = new ConversationImageContextStore();
    store.record({
        scope,
        imageUrl: attachment.url,
        result: {
            outcome: 'executed',
            executionContext: { toolName: 'file_scan', status: 'executed' },
            evidence: { content: ['old image fact'] },
        },
        now: Date.now() - 24 * 60 * 60 * 1000 - 1,
    });
    const executor = createFileScanningContextStepExecutor({
        imageContextStore: store,
        logger: { warn: () => undefined },
        imageDescriptionTaskService: {
            runImageDescriptionTask: async () => {
                providerCalls += 1;
                throw new Error('must not be called');
            },
        },
    });

    const result = await executor(request('What about this image?', []));

    assert.equal(providerCalls, 0);
    assert.equal(
        (result.integrationContext?.payload as { disposition: string })
            .disposition,
        'expired'
    );
});
