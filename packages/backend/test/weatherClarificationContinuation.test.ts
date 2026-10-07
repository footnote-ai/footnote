/**
 * @description: Characterizes how prior weather clarification messages are parsed for follow-up selection.
 * @footnote-scope: test
 * @footnote-module: WeatherClarificationContinuationTests
 * @footnote-risk: low - Focused coverage for parsing caller-supplied conversation text.
 * @footnote-ethics: medium - Incorrect parsing could direct a forecast to the wrong place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { PostChatRequest } from '@footnote/contracts/web';
import { resolveWeatherClarificationContinuation } from '../src/services/tools/weatherClarificationContinuation.js';

const requestWithPriorClarification = (
    content: string,
    latestUserInput = '2'
): PostChatRequest => ({
    surface: 'web',
    trigger: { kind: 'submit' },
    latestUserInput,
    conversation: [{ role: 'assistant', content }],
});

test('resolves numbered choices from the prior clarification message', () => {
    const result = resolveWeatherClarificationContinuation(
        requestWithPriorClarification(
            'Which location did you mean?\n\n1. Springfield, Illinois\n2. Springfield, Massachusetts\n\nPlease reply with your choice.'
        )
    );

    assert.equal(result.kind, 'resolved');
    if (result.kind === 'resolved') {
        assert.equal(result.selectedOption.id, 'option-2');
        assert.equal(result.selectedOption.label, 'Springfield, Massachusetts');
    }
});

test('does not treat blank or malformed lines as numbered choices', () => {
    const result = resolveWeatherClarificationContinuation(
        requestWithPriorClarification(
            'Which location did you mean?\n\n1.\n   \n2 not a choice\n\nPlease reply with your choice.'
        )
    );

    assert.equal(result.kind, 'none');
});

test('requires whitespace after the period before a numbered choice label', () => {
    const malformed = resolveWeatherClarificationContinuation(
        requestWithPriorClarification(
            'Which location did you mean?\n\n1.Springfield \n\nPlease reply with your choice.',
            '1'
        )
    );
    assert.equal(malformed.kind, 'none');

    const valid = resolveWeatherClarificationContinuation(
        requestWithPriorClarification(
            'Which location did you mean?\n\n1. Springfield\n\nPlease reply with your choice.',
            '1'
        )
    );

    assert.equal(valid.kind, 'resolved');
    if (valid.kind === 'resolved') {
        assert.equal(valid.selectedOption.label, 'Springfield');
    }
});

test('does not parse labels across long runs of whitespace and blank lines', () => {
    const malformedOptions = '1. \n\t \n'.repeat(10_000);
    const result = resolveWeatherClarificationContinuation(
        requestWithPriorClarification(
            `Which location did you mean?\n\n${malformedOptions}Please reply with your choice.`
        )
    );

    assert.equal(result.kind, 'none');
});
