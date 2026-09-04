/**
 * @description: Verifies serializable model and runtime capability facts remain truthful.
 * @footnote-scope: test
 * @footnote-module: ModelCapabilityFactsTests
 * @footnote-risk: medium - Incorrect support intersections can send unsupported controls to providers.
 * @footnote-ethics: medium - Truthful capability reporting prevents misleading execution claims.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    intersectModelCapabilityFacts,
    resolveModelProfileCapabilityFacts,
    type ModelCapabilityFacts,
} from '../src/model-capabilities.js';

test('profile capability facts retain unknown when profile metadata is absent', () => {
    const facts = resolveModelProfileCapabilityFacts({
        canUseSearch: false,
    });

    assert.equal(facts.nativeSearch, 'unsupported');
    assert.equal(facts.structuredOutput, 'unknown');
    assert.equal(facts.reasoningEfforts.low, 'unknown');
    assert.equal(facts.verbosity.medium, 'unknown');
    assert.equal(facts.temperature, 'unknown');
    assert.equal(facts.outputLimit, 'unknown');
});

test('profile capability facts distinguish declared supported and unsupported controls', () => {
    const facts = resolveModelProfileCapabilityFacts({
        canUseSearch: true,
        supportedReasoningEfforts: ['none', 'low'],
        supportedVerbosity: ['low'],
        supportedSamplingControls: ['temperature'],
        toolCapabilities: { 'generation.structured_output': true },
    });

    assert.equal(facts.nativeSearch, 'supported');
    assert.equal(facts.reasoningEfforts.low, 'supported');
    assert.equal(facts.reasoningEfforts.high, 'unsupported');
    assert.equal(facts.verbosity.low, 'supported');
    assert.equal(facts.verbosity.high, 'unsupported');
    assert.equal(facts.temperature, 'supported');
    assert.equal(facts.topP, 'unsupported');
    assert.equal(facts.structuredOutput, 'supported');
});

test('effective capability facts preserve provider and runtime disagreement', () => {
    const model: ModelCapabilityFacts = {
        reasoningEfforts: {
            none: 'supported',
            low: 'supported',
            medium: 'unknown',
            high: 'unknown',
            xhigh: 'unknown',
            max: 'unknown',
        },
        verbosity: { low: 'unknown', medium: 'unknown', high: 'unknown' },
        temperature: 'supported',
        topP: 'unknown',
        outputLimit: 'supported',
        structuredOutput: 'supported',
        nativeSearch: 'supported',
    };
    const runtime: ModelCapabilityFacts = {
        reasoningEfforts: {
            none: 'supported',
            low: 'supported',
            medium: 'supported',
            high: 'supported',
            xhigh: 'supported',
            max: 'supported',
        },
        verbosity: {
            low: 'unsupported',
            medium: 'unsupported',
            high: 'unsupported',
        },
        temperature: 'supported',
        topP: 'supported',
        outputLimit: 'supported',
        structuredOutput: 'unsupported',
        nativeSearch: 'supported',
    };

    const effective = intersectModelCapabilityFacts({ model, runtime });

    assert.equal(effective.reasoningEfforts.low, 'supported');
    assert.equal(effective.reasoningEfforts.medium, 'unknown');
    assert.equal(effective.verbosity.low, 'unsupported');
    assert.equal(effective.temperature, 'supported');
    assert.equal(effective.topP, 'unknown');
    assert.equal(effective.structuredOutput, 'unsupported');
    assert.equal(effective.nativeSearch, 'supported');
});
