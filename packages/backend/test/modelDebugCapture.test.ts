/**
 * @description: Verifies that opted-in model debug text is redacted before storage and explicitly bounded.
 * @footnote-scope: test
 * @footnote-module: ModelDebugCaptureTest
 * @footnote-risk: medium - Regression coverage protects sensitive model debug text from unsafe persistence.
 * @footnote-ethics: high - Secret redaction and truncation protect private context in operator debugging.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    boundAndRedactDebugText,
    createModelDebugCapturingRuntime,
    isModelDebugCaptureEnabled,
    reuseResponseCandidateOutputs,
    withModelDebugAttempt,
    withModelDebugCaptureSession,
} from '../src/services/modelDebugCapture.js';

test('model debug text redacts credential-shaped fields before storing', () => {
    const result = boundAndRedactDebugText(
        'Authorization: Bearer abc123\napi_key="secret-value"\ntoken=session-token\n' +
            'https://operator:uri-password@example.com/private\n' +
            'postgres://operator:db-password@db.example/db\n' +
            'mongodb+srv://user:mongo-password@cluster.example/db\nnormal text'
    );

    assert.equal(result.redacted, true);
    assert.equal(result.truncated, false);
    assert.equal(result.text.includes('abc123'), false);
    assert.equal(result.text.includes('secret-value'), false);
    assert.equal(result.text.includes('session-token'), false);
    assert.equal(result.text.includes('uri-password'), false);
    assert.equal(result.text.includes('db-password'), false);
    assert.equal(result.text.includes('mongo-password'), false);
    assert.match(result.text, /normal text/u);
});

test('model debug text redacts every cookie in a header', () => {
    const result = boundAndRedactDebugText(
        'Cookie: session=first-secret; auth=second-secret; refresh=third-secret\nSet-Cookie: access=fourth-secret; HttpOnly'
    );

    assert.equal(result.text, 'Cookie: [REDACTED]\nSet-Cookie: [REDACTED]');
    assert.equal(result.redacted, true);
});

test('model debug text redacts cookies inside serialized message content', () => {
    const nestedMessage = JSON.stringify({
        role: 'user',
        content: JSON.stringify({
            Cookie: 'session=first-secret; auth=second-secret',
        }),
    });
    const result = boundAndRedactDebugText(JSON.stringify([nestedMessage]));

    assert.doesNotMatch(result.text, /first-secret|second-secret/);
    assert.match(result.text, /Cookie.*REDACTED/);
});

test('model debug text fails closed on escaped quotes in serialized cookie values', () => {
    const nestedMessage = JSON.stringify({
        role: 'user',
        content: JSON.stringify({
            Cookie: 'first\\"secret; auth=second-secret',
        }),
    });
    const result = boundAndRedactDebugText(JSON.stringify([nestedMessage]));

    assert.doesNotMatch(result.text, /secret|auth=/);
    assert.equal(result.redacted, true);
});

test('model debug text reports truncation after redaction', () => {
    const result = boundAndRedactDebugText('x'.repeat(20_000));

    assert.equal(result.text.length, 16_384);
    assert.equal(result.truncated, true);
    assert.equal(result.redacted, false);
});

test('captures exact runtime messages and output under canonical Attempt identity', async () => {
    const records: import('../src/services/modelDebugCapture.js').ModelDebugCaptureRecord[] =
        [];
    const runtime = createModelDebugCapturingRuntime({
        kind: 'test-runtime',
        async generate() {
            return { text: 'model output' };
        },
    });

    await withModelDebugCaptureSession(
        { runId: 'run-1', records, omittedInvocationCount: 0 },
        () =>
            withModelDebugAttempt({ stepId: 'generate', attempt: 2 }, () =>
                runtime.generate({
                    messages: [
                        { role: 'system', content: 'instructions' },
                        { role: 'user', content: 'question' },
                    ],
                })
            )
    );

    assert.deepEqual(records, [
        {
            runId: 'run-1',
            stepId: 'generate',
            attempt: 2,
            invocation: 0,
            inputText:
                '[{"role":"system","content":"instructions"},{"role":"user","content":"question"}]',
            inputTruncated: false,
            inputRedacted: false,
            outputText: 'model output',
            outputTruncated: false,
            outputRedacted: false,
        },
    ]);
});

test('model debug capture is disabled unless the backend opt-in is exactly true', () => {
    const previous = process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
    try {
        delete process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
        assert.equal(isModelDebugCaptureEnabled(), false);
        process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = 'yes';
        assert.equal(isModelDebugCaptureEnabled(), false);
        process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = 'true';
        assert.equal(isModelDebugCaptureEnabled(), true);
    } finally {
        if (previous === undefined) {
            delete process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO;
        } else {
            process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO = previous;
        }
    }
});

test('does not capture outside an opted-in workflow Attempt', async () => {
    const records: import('../src/services/modelDebugCapture.js').ModelDebugCaptureRecord[] =
        [];
    const runtime = createModelDebugCapturingRuntime({
        kind: 'test-runtime',
        async generate() {
            return { text: 'output without capture context' };
        },
    });

    await withModelDebugAttempt({ stepId: 'generate', attempt: 1 }, () =>
        runtime.generate({
            messages: [{ role: 'user', content: 'private input' }],
        })
    );

    assert.deepEqual(records, []);
});

test('reuses a matching response candidate instead of storing its output again', () => {
    const captures: import('../src/storage/traces/sqliteTraceStore.js').ModelDebugCaptureRecord[] =
        [
            {
                runId: 'run-1',
                stepId: 'generate',
                attempt: 1,
                invocation: 0,
                inputText: 'input',
                inputTruncated: false,
                inputRedacted: false,
                outputText: 'the answer',
                outputTruncated: false,
                outputRedacted: false,
            },
        ];
    const candidates = [
        {
            id: 'candidate-1',
            workflowStepId: 'generate',
            sequence: 0,
            stage: 'initial_generation' as const,
            state: 'selected' as const,
            text: 'the answer',
        },
    ];

    assert.deepEqual(reuseResponseCandidateOutputs(captures, candidates), [
        {
            runId: 'run-1',
            stepId: 'generate',
            attempt: 1,
            invocation: 0,
            inputText: 'input',
            inputTruncated: false,
            inputRedacted: false,
            outputTruncated: false,
            outputRedacted: false,
            outputCandidateId: 'candidate-1',
        },
    ]);
});
