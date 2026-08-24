/**
 * @description: Verifies web-search context-step execution behavior across provider fallback and fail-open semantics.
 * @footnote-scope: test
 * @footnote-module: WebSearchContextStepExecutorTests
 * @footnote-risk: medium - Regressions can silently misclassify search execution and grounding sources.
 * @footnote-ethics: medium - Search metadata quality affects transparency and reviewability.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearchContextStepExecutor } from '../src/services/contextIntegrations/webSearch/index.js';

const createBaseInput = () => ({
    workflowId: 'wf_test',
    workflowName: 'test',
    attempt: 1,
    request: {
        integrationName: 'web_search',
        requested: true,
        eligible: true,
        input: {
            query: 'latest OpenAI policy update',
            intent: 'current_facts',
            contextSize: 'low',
            topicHints: ['policy'],
        },
    },
});

test('web search executor returns executed with normalized citations from searxng', async () => {
    const originalFetch = globalThis.fetch;
    let observedUrl = '';
    globalThis.fetch = async (url) => {
        observedUrl = String(url);
        return {
            ok: true,
            json: async () => ({
                results: [
                    {
                        title: 'OpenAI policy update',
                        url: 'https://example.com/policy',
                        content: 'Policy summary',
                    },
                ],
            }),
        } as Response;
    };
    try {
        const executor = createWebSearchContextStepExecutor({
            enabled: true,
            providerPriority: ['searxng', 'brave'],
            searxngBaseUrl: 'https://searxng.example/custom/base',
            braveApiKey: null,
            serpApiKey: null,
            serpApiEngine: null,
            serpApiGl: null,
            serpApiHl: null,
            providerTimeoutMs: 1000,
            maxResults: 4,
        });
        const result = await executor(createBaseInput());
        if (result.outcome !== 'executed') {
            assert.fail(`Expected executed outcome, got ${result.outcome}`);
        }
        assert.equal(result.executionContext.status, 'executed');
        assert.equal(result.sources?.[0]?.url, 'https://example.com/policy');
        assert.ok(
            result.contextMessages?.some((line) =>
                (typeof line === 'string' ? line : line.content).includes(
                    'OpenAI'
                )
            )
        );
        assert.ok(observedUrl.includes('/custom/base/search'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('repo_explainer admits only structurally scoped repository results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        ({
            ok: true,
            json: async () => ({
                results: [
                    {
                        title: 'Footnote repository',
                        url: 'https://github.com/footnote-ai/footnote/pull/528',
                        content: 'The repository pull request.',
                    },
                    {
                        title: 'Markdown footnotes on Stack Overflow',
                        url: 'https://stackoverflow.com/questions/footnotes',
                        content: 'Unrelated Markdown syntax.',
                    },
                    {
                        title: 'Footnote DeepWiki',
                        url: 'https://deepwiki.com/footnote-ai/footnote',
                        content: 'Repository explanation.',
                    },
                    {
                        title: 'Footnote mention on an unknown site',
                        url: 'https://example.com/footnote',
                        content:
                            'Mentions footnote-ai/footnote without repository structure.',
                    },
                ],
            }),
        }) as Response;
    try {
        const executor = createWebSearchContextStepExecutor({
            enabled: true,
            providerPriority: ['searxng'],
            searxngBaseUrl: 'https://searxng.example',
            braveApiKey: null,
            serpApiKey: null,
            serpApiEngine: null,
            serpApiGl: null,
            serpApiHl: null,
            providerTimeoutMs: 1000,
            maxResults: 6,
        });
        const base = createBaseInput();
        const result = await executor({
            ...base,
            request: {
                ...base.request,
                input: {
                    ...base.request.input,
                    query: 'Footnote PR #528',
                    intent: 'repo_explainer',
                    repositoryScope: { repository: 'footnote-ai/footnote' },
                },
            },
        });
        if (result.outcome !== 'executed') {
            assert.fail(`Expected executed outcome, got ${result.outcome}`);
        }
        assert.deepEqual(
            result.sources?.map((source) => source.url),
            [
                'https://github.com/footnote-ai/footnote/pull/528',
                'https://deepwiki.com/footnote-ai/footnote',
            ]
        );
        const contextText = result.contextMessages
            ?.map((message) =>
                typeof message === 'string' ? message : message.content
            )
            .join('\n');
        assert.equal(contextText?.includes('Stack Overflow'), false);
        const payload = result.integrationContext?.payload as {
            repositoryScope?: {
                admittedCount: number;
                outOfScopeCount: number;
                uncertainCount: number;
            };
        };
        assert.deepEqual(payload.repositoryScope, {
            repository: 'footnote-ai/footnote',
            admittedCount: 2,
            outOfScopeCount: 1,
            uncertainCount: 1,
            decisions: [
                {
                    url: 'https://github.com/footnote-ai/footnote/pull/528',
                    admission: 'in_scope',
                    reason: 'canonical_github_repository',
                },
                {
                    url: 'https://stackoverflow.com/questions/footnotes',
                    admission: 'out_of_scope',
                    reason: 'no_repository_scope_signal',
                },
                {
                    url: 'https://deepwiki.com/footnote-ai/footnote',
                    admission: 'in_scope',
                    reason: 'canonical_project_surface',
                },
                {
                    url: 'https://example.com/footnote',
                    admission: 'uncertain',
                    reason: 'repository_mentioned_without_structural_identity',
                },
            ],
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('repo_explainer continues provider fallback until a scoped record is found', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
        callCount += 1;
        if (callCount === 1) {
            return {
                ok: true,
                json: async () => ({
                    results: [
                        {
                            title: 'Generic footnote syntax',
                            url: 'https://example.com/markdown-footnotes',
                            content: 'Unrelated result.',
                        },
                    ],
                }),
            } as Response;
        }
        return {
            ok: true,
            json: async () => ({
                web: {
                    results: [
                        {
                            title: 'Footnote repository',
                            url: 'https://github.com/footnote-ai/footnote',
                            description: 'Scoped fallback result.',
                        },
                    ],
                },
            }),
        } as Response;
    };
    try {
        const executor = createWebSearchContextStepExecutor({
            enabled: true,
            providerPriority: ['searxng', 'brave'],
            searxngBaseUrl: 'https://searxng.example',
            braveApiKey: 'brave-token',
            serpApiKey: null,
            serpApiEngine: null,
            serpApiGl: null,
            serpApiHl: null,
            providerTimeoutMs: 1000,
            maxResults: 4,
        });
        const base = createBaseInput();
        const result = await executor({
            ...base,
            request: {
                ...base.request,
                input: {
                    ...base.request.input,
                    intent: 'repo_explainer',
                    repositoryScope: { repository: 'footnote-ai/footnote' },
                },
            },
        });
        assert.equal(result.outcome, 'executed');
        assert.deepEqual(
            result.sources?.map((source) => source.url),
            ['https://github.com/footnote-ai/footnote']
        );
        assert.equal(callCount, 2);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('web search executor falls back to brave when searxng fails', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
        callCount += 1;
        if (callCount === 1) {
            throw new Error('network fail');
        }
        return {
            ok: true,
            json: async () => ({
                web: {
                    results: [
                        {
                            title: 'Brave result',
                            url: 'https://brave.example/result',
                            description: 'Brave fallback worked',
                        },
                    ],
                },
            }),
        } as Response;
    };
    try {
        const executor = createWebSearchContextStepExecutor({
            enabled: true,
            providerPriority: ['searxng', 'brave'],
            searxngBaseUrl: 'https://searxng.example',
            braveApiKey: 'brave-token',
            serpApiKey: null,
            serpApiEngine: null,
            serpApiGl: null,
            serpApiHl: null,
            providerTimeoutMs: 1000,
            maxResults: 4,
        });
        const result = await executor(createBaseInput());
        if (result.outcome !== 'executed') {
            assert.fail(`Expected executed outcome, got ${result.outcome}`);
        }
        assert.equal(result.executionContext.status, 'executed');
        assert.equal(result.sources?.[0]?.url, 'https://brave.example/result');
        const payload = result.integrationContext?.payload as
            | {
                  attempts?: Array<{ provider: string; status: string }>;
              }
            | undefined;
        assert.equal(payload?.attempts?.[0]?.provider, 'searxng');
        assert.equal(payload?.attempts?.[0]?.status, 'failed');
        assert.equal(payload?.attempts?.[1]?.provider, 'brave');
        assert.equal(payload?.attempts?.[1]?.status, 'executed_with_results');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('web search executor returns skipped/tool_not_used when providers return empty results', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        ({
            ok: true,
            json: async () => ({
                results: [],
            }),
        }) as Response;
    try {
        const executor = createWebSearchContextStepExecutor({
            enabled: true,
            providerPriority: ['searxng'],
            searxngBaseUrl: 'https://searxng.example',
            braveApiKey: null,
            serpApiKey: null,
            serpApiEngine: null,
            serpApiGl: null,
            serpApiHl: null,
            providerTimeoutMs: 1000,
            maxResults: 4,
        });
        const result = await executor(createBaseInput());
        assert.equal(result.outcome, 'skipped');
        assert.equal(result.executionContext.status, 'skipped');
        assert.equal(result.executionContext.reasonCode, 'tool_not_used');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('web search executor returns skipped/tool_unavailable when all providers are skipped', async () => {
    const executor = createWebSearchContextStepExecutor({
        enabled: true,
        providerPriority: ['searxng', 'brave'],
        searxngBaseUrl: null,
        braveApiKey: null,
        serpApiKey: null,
        serpApiEngine: null,
        serpApiGl: null,
        serpApiHl: null,
        providerTimeoutMs: 1000,
        maxResults: 4,
    });
    const result = await executor(createBaseInput());
    assert.equal(result.outcome, 'skipped');
    assert.equal(result.executionContext.status, 'skipped');
    assert.equal(result.executionContext.reasonCode, 'tool_unavailable');
});

test('web search executor falls back to serpapi when searxng and brave are unavailable', async () => {
    const originalFetch = globalThis.fetch;
    let observedUrl = '';
    globalThis.fetch = async (url) => {
        observedUrl = String(url);
        return {
            ok: true,
            json: async () => ({
                organic_results: [
                    {
                        title: 'SerpAPI result',
                        link: 'https://serpapi.example/result',
                        snippet: 'SerpAPI fallback worked',
                    },
                ],
            }),
        } as Response;
    };
    try {
        const executor = createWebSearchContextStepExecutor({
            enabled: true,
            providerPriority: ['searxng', 'brave', 'serpapi'],
            searxngBaseUrl: null,
            braveApiKey: null,
            serpApiKey: 'serp-token',
            serpApiEngine: 'google',
            serpApiGl: 'us',
            serpApiHl: 'en',
            providerTimeoutMs: 1000,
            maxResults: 4,
        });
        const result = await executor(createBaseInput());
        if (result.outcome !== 'executed') {
            assert.fail(`Expected executed outcome, got ${result.outcome}`);
        }
        assert.equal(result.executionContext.status, 'executed');
        assert.equal(
            result.sources?.[0]?.url,
            'https://serpapi.example/result'
        );
        const payload = result.integrationContext?.payload as
            | {
                  attempts?: Array<{ provider: string; status: string }>;
              }
            | undefined;
        assert.equal(payload?.attempts?.[0]?.provider, 'searxng');
        assert.equal(payload?.attempts?.[0]?.status, 'skipped');
        assert.equal(payload?.attempts?.[1]?.provider, 'brave');
        assert.equal(payload?.attempts?.[1]?.status, 'skipped');
        assert.equal(payload?.attempts?.[2]?.provider, 'serpapi');
        assert.equal(payload?.attempts?.[2]?.status, 'executed_with_results');
        assert.ok(observedUrl.includes('engine=google'));
        assert.ok(observedUrl.includes('gl=us'));
        assert.ok(observedUrl.includes('hl=en'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('web search executor returns skipped/tool_unavailable when only serpapi is prioritized without key', async () => {
    const executor = createWebSearchContextStepExecutor({
        enabled: true,
        providerPriority: ['serpapi'],
        searxngBaseUrl: null,
        braveApiKey: null,
        serpApiKey: null,
        serpApiEngine: null,
        serpApiGl: null,
        serpApiHl: null,
        providerTimeoutMs: 1000,
        maxResults: 4,
    });
    const result = await executor(createBaseInput());
    assert.equal(result.outcome, 'skipped');
    assert.equal(result.executionContext.status, 'skipped');
    assert.equal(result.executionContext.reasonCode, 'tool_unavailable');
    const payload = result.integrationContext?.payload as
        | {
              attempts?: Array<{ provider: string; status: string }>;
          }
        | undefined;
    assert.equal(payload?.attempts?.[0]?.provider, 'serpapi');
    assert.equal(payload?.attempts?.[0]?.status, 'skipped');
});
