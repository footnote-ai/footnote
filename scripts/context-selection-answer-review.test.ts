/**
 * @description: Tests the blinded answer-review adapter without provider calls.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionAnswerReviewTests
 * @footnote-risk: low - Mocked review results verify the experiment boundary without live spend.
 * @footnote-ethics: low - Tests use the synthetic benchmark corpus only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBenchmarkCorpus } from './context-selection-benchmark.js';
import {
    aggregateReviewRecords,
    buildBlindedAnswers,
    buildReviewRequest,
    parseContextAnswerReview,
    type ContextAnswerReviewRecord,
} from './context-selection-answer-review.js';

test('blinds answer labels without putting method names in the prompt', () => {
    const answers = buildBlindedAnswers('case-1', [
        { method: 'current_window', text: 'Answer one.' },
        { method: 'bm25_graph_expansion', text: 'Answer two.' },
        { method: 'hosted_zero_shot', text: 'Answer three.' },
    ]);
    const request = buildReviewRequest(buildBenchmarkCorpus()[0]!, answers);
    const prompt = request.messages[1]?.content ?? '';

    assert.deepEqual(
        buildBlindedAnswers('case-1', [
            { method: 'current_window', text: 'Answer one.' },
            { method: 'bm25_graph_expansion', text: 'Answer two.' },
            { method: 'hosted_zero_shot', text: 'Answer three.' },
        ]),
        answers
    );
    assert.doesNotMatch(prompt, /current_window|bm25_graph|hosted_zero/u);
    assert.match(prompt, /"label":"[ABC]"/u);
});

test('parses a complete bounded review and rejects duplicate labels', () => {
    const result = {
        answers: [
            {
                label: 'A',
                required_fact_coverage: 1,
                reference_resolution: 'correct',
                unsupported_claim_count: 0,
                distractor_contamination: false,
                sufficient: true,
                rationale: 'Contains the required fact.',
                evidence: ['The answer names the required fact.'],
            },
            {
                label: 'B',
                required_fact_coverage: 0.5,
                reference_resolution: 'uncertain',
                unsupported_claim_count: 1,
                distractor_contamination: true,
                sufficient: false,
                rationale: 'The answer is incomplete.',
                evidence: [],
            },
        ],
    };

    assert.equal(parseContextAnswerReview(result, ['A', 'B']).length, 2);
    assert.throws(
        () =>
            parseContextAnswerReview(
                { answers: [result.answers[0], { ...result.answers[0] }] },
                ['A', 'B']
            ),
        /omitted or repeated/u
    );
    assert.throws(
        () =>
            parseContextAnswerReview(
                {
                    answers: [
                        {
                            ...result.answers[0],
                            required_fact_coverage: 2,
                        },
                        result.answers[1],
                    ],
                },
                ['A', 'B']
            ),
        /bounded rubric/u
    );
});

test('aggregates sufficient-answer rates without a combined winner score', () => {
    const record = (
        method: string,
        sufficient: boolean
    ): ContextAnswerReviewRecord => ({
        schemaVersion: 1,
        rubricVersion: 'context-answer-review-v1',
        caseId: 'context-selection-001',
        category: 'trigger_only',
        reviewer: {
            profile: 'comparison-reviewer',
            provider: 'openrouter',
            model: 'test/reviewer',
            reasoningEffort: null,
        },
        answers: [
            {
                method,
                label: 'A',
                chatStatus: 'completed',
                responseText: 'answer',
                deterministicSupport: null,
                evaluation: {
                    label: 'A',
                    requiredFactCoverage: sufficient ? 1 : 0,
                    referenceResolution: 'not_applicable',
                    unsupportedClaimCount: 0,
                    distractorContamination: false,
                    sufficient,
                    rationale: '',
                    evidence: [],
                },
            },
        ],
        review: null,
    });

    assert.deepEqual(
        aggregateReviewRecords([
            record('current_window', true),
            record('current_window', false),
        ]),
        [{ method: 'current_window', answerCount: 2, sufficientRate: 0.5 }]
    );
});
