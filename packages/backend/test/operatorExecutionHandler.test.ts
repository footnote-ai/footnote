/**
 * @description: Verifies operator execution reads require live administrator account sessions.
 * @footnote-scope: test
 * @footnote-module: OperatorExecutionHandlerTests
 * @footnote-risk: high - Exercises the backend authorization boundary for private execution records.
 * @footnote-ethics: high - Prevents unauthorized access to operational execution details.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildExternalIdentityKey } from '@footnote/contracts';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { ACCOUNT_SESSION_COOKIE_NAME } from '../src/http/authCookies.js';
import { createOperatorExecutionHandler } from '../src/handlers/operatorExecution.js';
import { createAccountAuthService } from '../src/services/accountAuth.js';
import type { OidcAccountClient } from '../src/services/oidcClient.js';
import { createInMemoryAccountStore } from '../src/storage/accounts/sqliteAccountStore.js';
import { SqliteTraceStore } from '../src/storage/traces/sqliteTraceStore.js';

test('operator execution reads deny missing, expired, and ordinary account sessions', async (t) => {
    let now = 1_000;
    const provider: OidcAccountClient = {
        startAuthorization: async () => ({
            authorizationUrl: 'https://identity.example/authorize',
            state: 'state',
            nonce: 'nonce',
            codeVerifier: 'verifier',
        }),
        exchangeCallback: async ({ callbackQuery }) => ({
            issuer: 'https://identity.example/',
            subject:
                new URLSearchParams(callbackQuery).get('code') ?? 'ordinary',
            displayName: 'Test account',
        }),
    };
    const accountAuthService = createAccountAuthService({
        provider,
        accountStore: createInMemoryAccountStore(),
        administratorIdentityKeys: new Set([
            buildExternalIdentityKey('https://identity.example/', 'operator'),
        ]),
        now: () => now,
        sessionTtlMs: 10,
        randomToken: (() => {
            let index = 0;
            return () => `token-${++index}`;
        })(),
    });
    const createSession = async (subject: string) => {
        const login = await accountAuthService.startLogin();
        assert.equal(login.ok, true);
        if (!login.ok) throw new Error('Login did not start');
        const result = await accountAuthService.completeLogin(
            login.transactionId,
            `code=${subject}&state=state`
        );
        assert.equal(result.ok, true);
        if (!result.ok) throw new Error('Login did not complete');
        return result.session;
    };
    const operator = await createSession('operator');
    const ordinary = await createSession('ordinary');
    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'operator-execution-')
    );
    const traceStore = new SqliteTraceStore({
        dbPath: path.join(tempRoot, 'provenance.db'),
    });
    const trace: ResponseMetadata = {
        responseId: 'response-private-1',
        provenance: 'Inferred',
        safetyTier: 'Low',
        tradeoffCount: 0,
        chainHash: 'hash',
        licenseContext: 'MIT',
        modelVersion: 'model',
        staleAfter: new Date(now + 60_000).toISOString(),
        citations: [],
        trace_target: {},
        trace_final: {},
        workflow: {
            runId: 'run-1',
            sessionCorrelationId: 'realtime-session-private',
            workflowId: 'workflow-1',
            workflowName: 'chat_orchestration',
            runStatus: 'completed',
            status: 'completed',
            terminationReason: 'goal_satisfied',
            stepCount: 1,
            maxSteps: 4,
            maxDurationMs: 10_000,
            results: [
                {
                    resultId: 'result-1',
                    name: 'answer',
                    status: 'produced',
                    producedByStepId: 'step-1',
                    producedByAttempt: 1,
                },
            ],
            steps: [
                {
                    stepId: 'step-1',
                    attempt: 1,
                    stepKind: 'generate',
                    startedAt: new Date(now).toISOString(),
                    finishedAt: new Date(now).toISOString(),
                    durationMs: 0,
                    attempts: [
                        {
                            attempt: 1,
                            status: 'succeeded',
                            startedAt: new Date(now).toISOString(),
                            finishedAt: new Date(now).toISOString(),
                            durationMs: 0,
                        },
                    ],
                    inputRefs: [{ name: 'private-input' }],
                    resultRefs: [{ resultId: 'result-1', name: 'answer' }],
                    outcome: {
                        status: 'executed',
                        summary: 'generated',
                        artifacts: ['private artifact body'],
                        signals: {
                            action: 'message',
                            privateSignal: 'private signal value',
                        },
                    },
                },
            ],
        },
    };
    await traceStore.upsert(trace, [
        {
            id: 'candidate-1',
            workflowStepId: 'step-1',
            sequence: 0,
            stage: 'initial_generation',
            state: 'selected',
            text: 'candidate output body api_key=candidate-secret-value',
        },
    ]);
    await traceStore.storeModelDebugCaptures(trace.responseId, [
        {
            runId: 'run-1',
            stepId: 'step-1',
            attempt: 1,
            invocation: 0,
            inputText: 'private model input',
            inputTruncated: false,
            inputRedacted: true,
            outputCandidateId: 'candidate-1',
            outputRedacted: false,
        },
        {
            runId: 'run-1',
            stepId: 'step-1',
            attempt: 1,
            invocation: 1,
            inputText: 'long bounded input',
            inputTruncated: true,
            inputRedacted: false,
            outputUnavailable: true,
        },
    ]);
    const canonicalTrace = await traceStore.retrieve(trace.responseId);
    assert.deepEqual(canonicalTrace?.workflow, trace.workflow);
    assert.equal(canonicalTrace?.workflow?.results?.length, 1);
    assert.equal(canonicalTrace?.workflow?.steps[0]?.attempts?.length, 1);

    const displayTrace = await traceStore.retrieveForDisplay(trace.responseId);
    assert.ok(displayTrace);
    const displayWorkflow = displayTrace?.workflow;
    assert.ok(displayWorkflow);
    assert.equal(displayWorkflow.sessionCorrelationId, undefined);
    assert.deepEqual(displayWorkflow.results, trace.workflow?.results);
    assert.equal(displayWorkflow.steps[0]?.attempts?.length, 1);
    assert.deepEqual(displayWorkflow.steps[0]?.inputRefs, [
        { name: 'private-input' },
    ]);
    assert.deepEqual(displayWorkflow.steps[0]?.resultRefs, [
        { resultId: 'result-1', name: 'answer' },
    ]);
    assert.equal('modelDebugCaptures' in displayTrace, false);
    assert.doesNotMatch(
        JSON.stringify(displayTrace),
        /private model input|candidate-secret-value|long bounded input/u
    );
    assert.deepEqual(displayWorkflow.steps[0]?.outcome.artifacts, [
        '[redacted:21 chars]',
    ]);
    assert.deepEqual(displayWorkflow.steps[0]?.outcome.signals, {
        action: 'message',
    });
    const logs: Array<Record<string, unknown>> = [];
    const handler = createOperatorExecutionHandler({
        accountAuthService,
        traceStore,
        logRequest: () => undefined,
        handlerLogger: {
            info: (_message, fields) => logs.push(fields ?? {}),
            warn: (_message, fields) => logs.push(fields ?? {}),
        },
    });
    const server = http.createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind test server');
    }
    t.after(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
        traceStore.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${address.port}/api/admin/executions/response-private-1`;

    assert.equal((await fetch(url)).status, 401);
    assert.equal(
        (
            await fetch(url, {
                headers: {
                    cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${ordinary.sessionId}`,
                },
            })
        ).status,
        403
    );
    now += 11;
    assert.equal(
        (
            await fetch(url, {
                headers: {
                    cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${operator.sessionId}`,
                },
            })
        ).status,
        401
    );
    now = 1_005;
    const currentOperator = await createSession('operator');
    const response = await fetch(url, {
        headers: {
            cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${currentOperator.sessionId}`,
        },
    });
    assert.equal(response.status, 200);
    const operatorPayload = await response.json();
    assert.deepEqual(operatorPayload, {
        responseId: trace.responseId,
        workflow: trace.workflow,
        modelDebugCaptures: [
            {
                runId: 'run-1',
                stepId: 'step-1',
                attempt: 1,
                invocation: 0,
                inputText: 'private model input',
                inputTruncated: false,
                inputRedacted: true,
                outputCandidateId: 'candidate-1',
                outputRedacted: true,
                outputTruncated: false,
                outputText: 'candidate output body api_key=[REDACTED]',
            },
            {
                runId: 'run-1',
                stepId: 'step-1',
                attempt: 1,
                invocation: 1,
                inputText: 'long bounded input',
                inputTruncated: true,
                inputRedacted: false,
                outputUnavailable: true,
            },
        ],
    });
    assert.equal(
        (operatorPayload as { workflow: ResponseMetadata['workflow'] }).workflow
            ?.steps[0]?.attempts?.length,
        1
    );
    assert.equal(
        (operatorPayload as { workflow: ResponseMetadata['workflow'] }).workflow
            ?.results?.length,
        1
    );
    const missing = await fetch(
        `http://127.0.0.1:${address.port}/api/admin/executions/missing`,
        {
            headers: {
                cookie: `${ACCOUNT_SESSION_COOKIE_NAME}=${currentOperator.sessionId}`,
            },
        }
    );
    assert.equal(missing.status, 404);
    assert.equal(
        logs.some((entry) => 'workflow' in entry),
        false
    );
    assert.doesNotMatch(
        JSON.stringify(logs),
        /private model input|candidate-secret-value|long bounded input/u
    );
});
