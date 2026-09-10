/**
 * @description: Covers capability-selected typed model output paths and conservative Result admission.
 * @footnote-scope: test
 * @footnote-module: TypedModelOutputTests
 * @footnote-risk: low - Focused seam coverage for typed output classification.
 * @footnote-ethics: high - Tests ensure refusals and incomplete output cannot become workflow decisions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GenerationResult } from '@footnote/agent-runtime';
import {
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
                toolCapabilities: { 'generation.structured_output': false },
            },
        }),
        'json_compatibility'
    );
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'ollama',
            capabilities: {
                canUseSearch: false,
                toolCapabilities: { 'generation.structured_output': false },
            },
            jsonModeSupport: 'supported',
        }),
        'json_compatibility'
    );
    assert.equal(
        resolveTypedModelOutputPath({
            provider: 'ollama',
            capabilities: { canUseSearch: false },
        }),
        'parser_compatibility'
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

test('accepts only a parser-validated typed result', () => {
    const validation = validateTypedModelOutput({
        result: result(),
        parse,
    });
    assert.deepEqual(validation, { valid: true, value: { ok: true } });
});
