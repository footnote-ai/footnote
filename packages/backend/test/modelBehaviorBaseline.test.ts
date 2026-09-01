/**
 * @description: Protects the small sanitized workload corpus used for later model and prompt comparisons.
 * @footnote-scope: test
 * @footnote-module: ModelBehaviorBaselineTests
 * @footnote-risk: medium - Corpus drift can make later comparisons non-repeatable or incomplete.
 * @footnote-ethics: medium - Stable evaluation cases support accountable model-behavior decisions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type BaselineKind = 'generation' | 'planner' | 'structured_planner' | 'review';

type BaselineMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
};

type BaselineCase = {
    id: string;
    kind: BaselineKind;
    description: string;
    messages?: BaselineMessage[];
    draft?: string;
    reviewContext?: string;
    request: {
        maxOutputTokens: number;
        reasoningEffort: string;
        verbosity: string;
    };
    checks: {
        deterministic: string[];
        objective: string[];
        qualitative: string[];
    };
};

type CheckCategory = keyof BaselineCase['checks'];

const allowedCheckIdentifiers: Record<CheckCategory, ReadonlySet<string>> = {
    deterministic: new Set([
        'text_output',
        'planner_schema_valid',
        'trace_complete',
        'structured_output_valid',
        'planner_contract_valid',
        'review_decision_schema_valid',
        'revision_instruction_bounded',
        'review_fail_open_preserved',
    ]),
    objective: new Set([
        'retrieval_forbidden',
        'action_message',
        'retrieval_not_requested',
        'retrieval_requested',
        'current_state_intent',
        'modality_text',
        'review_decision_finalize',
        'review_decision_revise',
    ]),
    qualitative: new Set([
        'clear_tradeoff_explanation',
        'request_intent_preserved',
        'retrieval_scope_is_bounded',
        'decision_is_minimal',
        'no_unnecessary_revision',
        'revision_instruction_is_actionable',
    ]),
};

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
);

const rawCorpus: unknown = JSON.parse(
    fs.readFileSync(
        path.join(
            repoRoot,
            'packages/backend/test/fixtures/modelBehaviorBaseline.json'
        ),
        'utf8'
    )
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const readRequiredString = (
    record: Record<string, unknown>,
    key: string
): string => {
    const value = record[key];
    if (typeof value !== 'string') {
        assert.fail(`${key} must be a string`);
    }
    assert.ok(value.trim().length > 0, `${key} must not be empty`);
    return value;
};

const readStringArray = (
    record: Record<string, unknown>,
    key: string,
    category: CheckCategory
): string[] => {
    const value = record[key];
    if (!Array.isArray(value)) {
        assert.fail(`${key} must be an array`);
    }
    assert.ok(
        value.length > 0,
        `${key} must contain at least one evaluation check`
    );
    return value.map((entry) => {
        if (typeof entry !== 'string') {
            assert.fail(`${key} entries must be strings`);
        }
        assert.ok(entry.trim().length > 0, `${key} entries must not be empty`);
        assert.ok(
            allowedCheckIdentifiers[category].has(entry),
            `${key} contains unsupported version 1 check identifier: ${entry}`
        );
        return entry;
    });
};

const readMessages = (value: unknown): BaselineMessage[] => {
    if (!Array.isArray(value)) {
        assert.fail('messages must be an array');
    }
    assert.ok(value.length > 0, 'messages must not be empty');
    return value.map((entry) => {
        assert.ok(isRecord(entry), 'message entries must be objects');
        const role = readRequiredString(entry, 'role');
        assert.ok(
            role === 'system' || role === 'user' || role === 'assistant',
            `unsupported message role: ${role}`
        );
        return {
            role,
            content: readRequiredString(entry, 'content'),
        };
    });
};

const readCase = (value: unknown): BaselineCase => {
    assert.ok(isRecord(value), 'baseline cases must be objects');
    const kind = readRequiredString(value, 'kind');
    assert.ok(
        kind === 'generation' ||
            kind === 'planner' ||
            kind === 'structured_planner' ||
            kind === 'review',
        `unsupported baseline kind: ${kind}`
    );
    const request = value.request;
    assert.ok(isRecord(request), 'request must be an object');
    const maxOutputTokens = request.maxOutputTokens;
    if (typeof maxOutputTokens !== 'number') {
        assert.fail('maxOutputTokens must be a number');
    }
    assert.ok(maxOutputTokens > 0, 'maxOutputTokens must be positive');
    const checks = value.checks;
    assert.ok(isRecord(checks), 'checks must be an object');
    const baselineCase: BaselineCase = {
        id: readRequiredString(value, 'id'),
        kind,
        description: readRequiredString(value, 'description'),
        request: {
            maxOutputTokens,
            reasoningEffort: readRequiredString(request, 'reasoningEffort'),
            verbosity: readRequiredString(request, 'verbosity'),
        },
        checks: {
            deterministic: readStringArray(
                checks,
                'deterministic',
                'deterministic'
            ),
            objective: readStringArray(checks, 'objective', 'objective'),
            qualitative: readStringArray(checks, 'qualitative', 'qualitative'),
        },
    };

    if (kind !== 'review' || value.messages !== undefined) {
        baselineCase.messages = readMessages(value.messages);
    }
    if (kind === 'review' || value.draft !== undefined) {
        baselineCase.draft = readRequiredString(value, 'draft');
    }
    if (kind === 'review' || value.reviewContext !== undefined) {
        baselineCase.reviewContext = readRequiredString(value, 'reviewContext');
    }

    return baselineCase;
};

const readCorpus = (value: unknown): BaselineCase[] => {
    assert.ok(isRecord(value), 'baseline corpus must be an object');
    assert.equal(value.version, 1, 'baseline corpus version must be 1');
    const rawCases = value.cases;
    assert.ok(
        Array.isArray(rawCases),
        'baseline corpus cases must be an array'
    );
    return rawCases.map(readCase);
};

const corpus = readCorpus(rawCorpus);

test('model behavior baseline contains seven isolated workload cases', () => {
    assert.equal(corpus.length, 7);
    assert.deepEqual(
        corpus.map((evaluationCase) => evaluationCase.id),
        [
            'direct_generation_no_retrieval',
            'planner_ordinary_message',
            'planner_retrieval_request',
            'structured_planner_schema',
            'planner_difficult_routing',
            'review_finalize_good_draft',
            'review_revise_defective_draft',
        ]
    );
    assert.equal(
        new Set(corpus.map((evaluationCase) => evaluationCase.id)).size,
        corpus.length
    );
});

test('model behavior baseline separates deterministic, objective, and qualitative checks', () => {
    for (const evaluationCase of corpus) {
        assert.ok(evaluationCase.checks.deterministic.length > 0);
        assert.ok(evaluationCase.checks.objective.length > 0);
        assert.ok(evaluationCase.checks.qualitative.length > 0);
        assert.ok(
            evaluationCase.messages !== undefined ||
                evaluationCase.kind === 'review',
            `${evaluationCase.id} needs messages unless it is a review case`
        );
    }
});

test('model behavior baseline isolates the intended first-pass failure modes', () => {
    const direct = corpus[0];
    const ordinaryPlanner = corpus[1];
    const retrievalPlanner = corpus[2];
    const structuredPlanner = corpus[3];
    const difficultPlanner = corpus[4];
    const finalizeReview = corpus[5];
    const reviseReview = corpus[6];

    assert.ok(direct?.checks.objective.includes('retrieval_forbidden'));
    assert.ok(ordinaryPlanner?.checks.objective.includes('action_message'));
    assert.ok(
        retrievalPlanner?.checks.objective.includes('retrieval_requested')
    );
    assert.ok(
        structuredPlanner?.checks.deterministic.includes(
            'structured_output_valid'
        )
    );
    assert.ok(
        difficultPlanner?.checks.objective.includes('current_state_intent')
    );
    assert.ok(
        finalizeReview?.checks.objective.includes('review_decision_finalize')
    );
    assert.ok(
        reviseReview?.checks.objective.includes('review_decision_revise')
    );
    assert.ok(finalizeReview?.draft);
    assert.ok(reviseReview?.draft);
});

test('model behavior baseline rejects unknown checks and incomplete case inputs', () => {
    assert.throws(
        () =>
            readStringArray(
                { objective: ['retrieval_reqeusted'] },
                'objective',
                'objective'
            ),
        /unsupported version 1 check identifier/
    );

    const request: Record<string, unknown> = {
        maxOutputTokens: 100,
        reasoningEffort: 'low',
        verbosity: 'low',
    };
    const checks: Record<string, unknown> = {
        deterministic: ['text_output'],
        objective: ['action_message'],
        qualitative: ['clear_tradeoff_explanation'],
    };

    assert.throws(
        () =>
            readCase({
                id: 'missing_messages',
                kind: 'generation',
                description: 'Missing messages.',
                request,
                checks,
            }),
        /messages must be an array/
    );
    assert.throws(
        () =>
            readCase({
                id: 'missing_review_context',
                kind: 'review',
                description: 'Missing review context.',
                draft: 'Draft.',
                request,
                checks,
            }),
        /reviewContext must be a string/
    );
});
