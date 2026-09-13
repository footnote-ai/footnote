/**
 * @description: Verifies strict parsing of local Ollama admission settings.
 * @footnote-scope: test
 * @footnote-module: BackendOllamaConfigTests
 * @footnote-risk: low - Test-only coverage for bounded local runtime configuration.
 * @footnote-ethics: medium - Invalid limits must not silently weaken runtime safeguards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOllamaSection } from '../src/config/sections/ollama.js';

test('Ollama admission settings require complete integer values', () => {
    const warnings: string[] = [];
    const config = buildOllamaSection(
        {
            OLLAMA_MAX_CONCURRENT_GENERATIONS: '1e2',
            OLLAMA_MAX_QUEUED_GENERATIONS: '8requests',
        },
        (message) => warnings.push(message)
    );

    assert.equal(config.maxConcurrentGenerations, 1);
    assert.equal(config.maxQueuedGenerations, 8);
    assert.match(
        warnings.join('\n'),
        /invalid positive integer for OLLAMA_MAX_CONCURRENT_GENERATIONS/
    );
    assert.match(
        warnings.join('\n'),
        /invalid non-negative integer for OLLAMA_MAX_QUEUED_GENERATIONS/
    );
});

test('Ollama admission settings preserve positive and non-negative constraints', () => {
    const warnings: string[] = [];
    const config = buildOllamaSection(
        {
            OLLAMA_MAX_CONCURRENT_GENERATIONS: '0',
            OLLAMA_MAX_QUEUED_GENERATIONS: '-1',
        },
        (message) => warnings.push(message)
    );

    assert.equal(config.maxConcurrentGenerations, 1);
    assert.equal(config.maxQueuedGenerations, 8);
    assert.equal(warnings.length, 2);
});
