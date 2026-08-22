/**
 * @description: Verifies project-context config parsing and bounded index limits.
 * @footnote-scope: test
 * @footnote-module: BackendProjectContextConfigTests
 * @footnote-risk: medium - Misparsed project-context config can disable retrieval or overreach limits.
 * @footnote-ethics: high - Embedding provider/model isolation keeps project docs independently governed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceSections } from '../src/config/sections/services.js';
import { buildProjectContextWiring } from '../src/services/contextIntegrations/projectContext/wiring.js';

test('project context config defaults to disabled with safe bounded limits', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections({}, (message) =>
        warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.enabled, false);
    assert.equal(projectContext.embeddingProvider, 'openai');
    assert.equal(projectContext.embeddingModel, 'text-embedding-3-small');
    assert.equal(projectContext.maxChunkBytes, 2000);
    assert.equal(projectContext.maxChunks, 200);
    assert.equal(projectContext.topKPerCategory, 5);
    assert.equal(projectContext.maxMatches, 6);
    assert.equal(projectContext.minScore, 0.35);
    assert.equal(projectContext.embeddingTimeoutMs, 8000);
});

test('project context config parses explicit values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_PROJECT_DOCS_ENABLED: 'true',
            CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER: 'openai',
            CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_MODEL: 'text-embedding-3-large',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES: '4000',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS: '500',
            CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY: '3',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES: '4',
            CHAT_CONTEXT_PROJECT_DOCS_MIN_SCORE: '0.6',
            CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS: '9000',
        },
        (message) => warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.enabled, true);
    assert.equal(projectContext.embeddingModel, 'text-embedding-3-large');
    assert.equal(projectContext.maxChunkBytes, 4000);
    assert.equal(projectContext.maxChunks, 500);
    assert.equal(projectContext.topKPerCategory, 3);
    assert.equal(projectContext.maxMatches, 4);
    assert.equal(projectContext.minScore, 0.6);
    assert.equal(projectContext.embeddingTimeoutMs, 9000);
});

test('project context config falls back on invalid integer values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES: 'not-a-number',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS: '-5',
            CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY: 'abc',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES: 'abc',
            CHAT_CONTEXT_PROJECT_DOCS_MIN_SCORE: 'abc',
            CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS: '-1',
        },
        (message) => warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.maxChunkBytes, 2000);
    assert.equal(projectContext.maxChunks, 200);
    assert.equal(projectContext.topKPerCategory, 5);
    assert.equal(projectContext.maxMatches, 6);
    assert.equal(projectContext.minScore, 0.35);
    assert.equal(projectContext.embeddingTimeoutMs, 8000);
});

test('project context config caps resource-intensive limits', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES: '999999',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS: '999999',
            CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY: '999999',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_MATCHES: '999999',
            CHAT_CONTEXT_PROJECT_DOCS_TIMEOUT_MS: '999999',
        },
        (message) => warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.maxChunkBytes, 32 * 1024);
    assert.equal(projectContext.maxChunks, 5_000);
    assert.equal(projectContext.topKPerCategory, 50);
    assert.equal(projectContext.maxMatches, 20);
    assert.equal(projectContext.embeddingTimeoutMs, 30000);
    assert.equal(warnings.length, 5);
});

test('project context embedding provider rejects unknown values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER: 'unknown-provider',
        },
        (message) => warnings.push(message)
    );
    assert.ok(warnings.length > 0);
    assert.equal(
        chatWorkflow.contextIntegrations.projectDocs.embeddingProvider,
        'openai'
    );
});

test('project context wiring fails open when the selected provider key is absent', async () => {
    const { chatWorkflow } = buildServiceSections(
        { CHAT_CONTEXT_PROJECT_DOCS_ENABLED: 'true' },
        () => undefined
    );
    const wiring = buildProjectContextWiring({
        config: chatWorkflow.contextIntegrations.projectDocs,
        projectRoot: process.cwd(),
        openaiApiKey: null,
        openrouterApiKey: null,
    });
    assert.ok(wiring);
    const result = await wiring.embedTexts(
        ['Footnote'],
        new AbortController().signal,
        'query'
    );
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
        assert.match(result.reason, /key is not configured/);
    }
});
