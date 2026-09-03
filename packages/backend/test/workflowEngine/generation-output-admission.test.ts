/**
 * @description: Verifies provider-neutral mechanical admission for normalized generation results.
 * @footnote-scope: test
 * @footnote-module: GenerationOutputAdmissionTests
 * @footnote-risk: high - Admission regressions can surface unusable model output as an answer.
 * @footnote-ethics: high - Mechanical rejection protects users without replacing answer quality with opaque judgment.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenerationResult } from '@footnote/agent-runtime';
import {
    admitGenerationResult,
    attachGenerationAttemptEvidence,
    normalizeGenerationResultEvidence,
    toGenerationRoutingAttemptSignals,
} from '../../src/services/generationOutputAdmission.js';

const result = (text: string): GenerationResult => ({
    text,
    model: 'test-model',
});

test('rejects empty and known incomplete generation results with exact reasons', () => {
    assert.deepEqual(admitGenerationResult(result('   ')), {
        admitted: false,
        reasonCode: 'generation_empty_output',
    });
    assert.deepEqual(
        admitGenerationResult(result('\u2003\u200B\u2060\u00AD')),
        {
            admitted: false,
            reasonCode: 'generation_empty_output',
        }
    );
    assert.deepEqual(
        admitGenerationResult({
            ...result('partial answer'),
            completion: {
                status: 'incomplete',
                reason: 'max_output_tokens',
                visibleTextLength: 14,
            },
        }),
        {
            admitted: false,
            reasonCode: 'generation_incomplete_before_output',
        }
    );
    assert.deepEqual(
        admitGenerationResult({
            ...result(''),
            completion: {
                status: 'failed',
                reason: 'provider_error',
                visibleTextLength: 0,
            },
        }),
        {
            admitted: false,
            reasonCode: 'generation_failed_output',
        }
    );
});

test('accepts unusual but mechanically valid generation text', () => {
    const validTexts = [
        '```ts\nconst answer = true;\n```',
        '{"answer":"ok","items":[1,2,3]}',
        'こんにちは — مرحبًا — Привет',
        '| key | value |\n| --- | --- |\n| x | !!! |',
        '+++ ??? ... \\ \\ = =',
        '\u200B visible text',
    ];

    for (const text of validTexts) {
        assert.deepEqual(admitGenerationResult(result(text)), {
            admitted: true,
        });
    }
});

test('retains valid evidence and omits malformed provider facts', () => {
    const normalized = normalizeGenerationResultEvidence({
        ...result('valid answer'),
        finishReason: 'stop',
        completion: {
            status: 'completed',
            reason: 'normal',
            visibleTextLength: 12,
        },
        usage: {
            promptTokens: 10,
            completionTokens: 4,
            totalTokens: 14,
            reasoningTokens: Number.POSITIVE_INFINITY,
        },
    });
    assert.equal(normalized.finishReason, 'stop');
    assert.deepEqual(normalized.completion, {
        status: 'completed',
        reason: 'normal',
        visibleTextLength: 12,
    });
    assert.deepEqual(normalized.usage, {
        promptTokens: 10,
        completionTokens: 4,
        totalTokens: 14,
    });

    const attempts = attachGenerationAttemptEvidence(
        [
            {
                index: 0,
                step: 'generate',
                profileId: 'first-profile',
                status: 'failed_transient_advanced',
                reasonCode: 'generation_empty_output',
                chooseOneUsed: false,
            },
        ],
        new Map([
            [
                0,
                {
                    ...result(''),
                    finishReason: 'x'.repeat(101),
                    completion: {
                        status: 'completed',
                        visibleTextLength: Number.NaN,
                    },
                    usage: {
                        promptTokens: -1,
                        completionTokens: 3,
                    },
                },
            ],
        ])
    );
    assert.equal(attempts[0]?.finishReason, undefined);
    assert.equal(attempts[0]?.completion, undefined);
    assert.deepEqual(attempts[0]?.usage, { completionTokens: 3 });
    assert.deepEqual(toGenerationRoutingAttemptSignals(attempts), [
        {
            index: 0,
            profileId: 'first-profile',
            status: 'failed_transient_advanced',
            reasonCode: 'generation_empty_output',
            usage: { completionTokens: 3 },
            chooseOneUsed: false,
        },
    ]);
});
