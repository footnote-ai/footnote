/**
 * @description: Covers capability-selected typed model output paths and conservative Result admission.
 * @footnote-scope: test
 * @footnote-module: TypedModelOutputTests
 * @footnote-risk: low - Focused seam coverage for typed output classification.
 * @footnote-ethics: high - Tests ensure refusals and incomplete output cannot become workflow decisions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GenerationRuntimeError,
    type GenerationResult,
} from '@footnote/agent-runtime';
import {
    isTypedOutputTransportUnavailable,
    resolveTypedModelOutputPath,
    validateTypedModelOutput,
} from '../src/services/typedModelOutput.js';

const result = (
    overrides: Partial<GenerationResult> = {}
): GenerationResult => ({
    text: '{"ok":true}',
    ...overrides,
});

const parse = (text: string) =>
    text === '{"ok":true}'
        ? { valid: true as const, value: { ok: true } }
        : { valid: false as const, failure: 'schema_invalid' as const };

test('selects native schema when provider and model facts support it', () => {
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'openai',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: { 'generation.structured_output': true },
            },
        }),
        'native_schema'
    );
});

test('selects JSON compatibility before parser compatibility when declared', () => {
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'openai',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: {
                    'generation.structured_output': false,
                    'generation.json_mode': true,
                },
            },
        }),
        'json_compatibility'
    );
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'ollama',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: {
                    'generation.structured_output': false,
                    'generation.json_mode': true,
                },
            },
        }),
        'json_compatibility'
    );
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'ollama',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: {
                    'generation.structured_output': false,
                    'generation.json_mode': false,
                },
            },
        }),
        'parser_compatibility'
    );
});

test('honors the effective JSON-mode selector instead of profile metadata', () => {
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'ollama',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: {
                    'generation.structured_output': false,
                    'generation.json_mode': true,
                },
            },
            jsonModeSupport: 'unknown',
        }),
        'parser_compatibility'
    );
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'ollama',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: {
                    'generation.structured_output': false,
                    'generation.json_mode': false,
                },
            },
            jsonModeSupport: 'supported',
        }),
        'json_compatibility'
    );
});

test('honors effective structured and JSON capability facts together', () => {
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'openai',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: {
                    'generation.structured_output': true,
                    'generation.json_mode': true,
                },
            },
            capabilityFacts: {
                structuredOutput: 'unsupported',
                jsonMode: 'supported',
            },
        }),
        'json_compatibility'
    );
});

test('rejects empty, malformed, refusal, and incomplete typed output', () => {
    const cases: Array<[string, GenerationResult, string]> = [
        ['empty', result({ text: '  ' }), 'empty'],
        ['malformed', result({ text: 'not json' }), 'schema_invalid'],
        ['refusal', result({ finishReason: 'refusal' }), 'refusal'],
        [
            'incomplete',
            result({
                completion: { status: 'incomplete', visibleTextLength: 3 },
            }),
            'incomplete',
        ],
    ];
    for (const [name, candidate, failure] of cases) {
        const validation = validateTypedModelOutput({
            result: candidate,
            parse,
        });
        assert.equal(validation.valid, false, name);
        if (!validation.valid) assert.equal(validation.failure, failure, name);
    }
});

test('classifies parser exceptions as malformed output', () => {
    const validation = validateTypedModelOutput({
        result: result(),
        parse: () => {
            throw new SyntaxError('invalid JSON');
        },
    });
    assert.deepEqual(validation, { valid: false, failure: 'malformed' });
});

test('accepts only a parser-validated typed result', () => {
    const validation = validateTypedModelOutput({
        result: result(),
        parse,
    });
    assert.deepEqual(validation, { valid: true, value: { ok: true } });
});

test('only retries native transport when runtime marks it unavailable', () => {
    assert.equal(
        isTypedOutputTransportUnavailable(
            new GenerationRuntimeError('schema rejected', {
                classification: 'structured_output_unavailable',
            })
        ),
        true
    );
    assert.equal(
        isTypedOutputTransportUnavailable(new Error('schema rejected')),
        false
    );
    assert.equal(
        isTypedOutputTransportUnavailable(
            new GenerationRuntimeError('upstream timeout', {
                classification: 'transient',
            })
        ),
        false
    );
});
