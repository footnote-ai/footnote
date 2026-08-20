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

test('project context config defaults to disabled with safe bounded limits', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections({}, (message) =>
        warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.enabled, false);
    assert.equal(projectContext.repository, 'footnote-ai/footnote');
    assert.equal(projectContext.embeddingProvider, 'openai');
    assert.equal(projectContext.embeddingModel, 'text-embedding-3-small');
    assert.equal(projectContext.maxChunkBytes, 2000);
    assert.equal(projectContext.maxChunks, 200);
    assert.equal(projectContext.topKPerCategory, 5);
});

test('project context config parses explicit values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_PROJECT_DOCS_ENABLED: 'true',
            CHAT_CONTEXT_PROJECT_DOCS_REPOSITORY: 'acme/footnote',
            CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_PROVIDER: 'openai',
            CHAT_CONTEXT_PROJECT_DOCS_EMBEDDING_MODEL: 'text-embedding-3-large',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES: '4000',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS: '500',
            CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY: '3',
        },
        (message) => warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.enabled, true);
    assert.equal(projectContext.repository, 'acme/footnote');
    assert.equal(projectContext.embeddingModel, 'text-embedding-3-large');
    assert.equal(projectContext.maxChunkBytes, 4000);
    assert.equal(projectContext.maxChunks, 500);
    assert.equal(projectContext.topKPerCategory, 3);
});

test('project context config falls back on invalid integer values', () => {
    const warnings: string[] = [];
    const { chatWorkflow } = buildServiceSections(
        {
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNK_BYTES: 'not-a-number',
            CHAT_CONTEXT_PROJECT_DOCS_MAX_CHUNKS: '-5',
            CHAT_CONTEXT_PROJECT_DOCS_TOP_K_PER_CATEGORY: 'abc',
        },
        (message) => warnings.push(message)
    );

    const projectContext = chatWorkflow.contextIntegrations.projectDocs;
    assert.equal(projectContext.maxChunkBytes, 2000);
    assert.equal(projectContext.maxChunks, 200);
    assert.equal(projectContext.topKPerCategory, 5);
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
