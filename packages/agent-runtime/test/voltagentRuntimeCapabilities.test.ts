/**
 * @description: Verifies VoltAgent runtime capability facts and provider intersections.
 * @footnote-scope: test
 * @footnote-module: VoltAgentRuntimeCapabilityTests
 * @footnote-risk: medium - Adapter support must not be conflated with model declarations.
 * @footnote-ethics: medium - Accurate capability facts prevent misleading provider-control claims.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveEffectiveVoltAgentCapabilities,
    resolveVoltAgentRuntimeCapabilityFacts,
} from '../src/voltagentRuntime.js';

test('VoltAgent runtime facts distinguish unsupported adapter controls', () => {
    const facts = resolveVoltAgentRuntimeCapabilityFacts('ollama');

    assert.equal(facts.reasoningEfforts.low, 'unsupported');
    assert.equal(facts.verbosity.medium, 'unsupported');
    assert.equal(facts.structuredOutput, 'unsupported');
    assert.equal(facts.jsonMode, 'unsupported');
    assert.equal(facts.outputLimit, 'supported');
});

test('VoltAgent runtime facts keep JSON mode distinct from native schema support', () => {
    const facts = resolveVoltAgentRuntimeCapabilityFacts('openai');

    assert.equal(facts.structuredOutput, 'supported');
    assert.equal(facts.jsonMode, 'supported');
});

test('effective VoltAgent capabilities retain model/runtime disagreement', () => {
    const facts = resolveEffectiveVoltAgentCapabilities({
        provider: 'ollama',
        capabilities: {
            canUseSearch: true,
            supportedReasoningEfforts: ['low'],
            toolCapabilities: { 'generation.structured_output': true },
        },
    });

    assert.equal(facts.reasoningEfforts.low, 'unsupported');
    assert.equal(facts.structuredOutput, 'unsupported');
    assert.equal(facts.jsonMode, 'unsupported');
    assert.equal(facts.nativeSearch, 'unsupported');
});
