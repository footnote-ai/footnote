/**
 * @description: Checks the execution report using a representative workflow record.
 * @footnote-scope: test
 * @footnote-module: ExecutionReportBrowserCheck
 * @footnote-risk: low - Mocked API responses isolate presentation from stored execution data.
 * @footnote-ethics: high - Coverage checks both private-field omission and denied access handling.
 */
import { expect, test } from '@playwright/test';

const report = {
    responseId: 'response-report-1',
    workflow: {
        runId: 'run-1',
        runStatus: 'degraded',
        startedAt: '2026-10-01T10:00:00.000Z',
        finishedAt: '2026-10-01T10:00:02.000Z',
        durationMs: 2000,
        workflowId: 'reviewed',
        workflowName: 'Reviewed response',
        status: 'degraded',
        terminationReason: 'goal_satisfied',
        stepCount: 3,
        maxSteps: 6,
        maxDurationMs: 60000,
        limitStop: {
            stoppedByLimit: false,
            terminationReason: 'goal_satisfied',
        },
        results: [
            {
                resultId: 'result-1',
                name: 'final-answer',
                status: 'produced',
                producedByStepId: 'write',
                producedByAttempt: 2,
            },
        ],
        steps: [
            {
                stepId: 'plan',
                attempt: 1,
                stepKind: 'plan',
                startedAt: '2026-10-01T10:00:00.000Z',
                finishedAt: '2026-10-01T10:00:00.100Z',
                durationMs: 100,
                outcome: {
                    status: 'executed',
                    summary: 'PRIVATE_SUMMARY_MUST_NOT_RENDER',
                },
                cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 },
                attempts: [
                    {
                        attempt: 1,
                        status: 'succeeded',
                        startedAt: '2026-10-01T10:00:00.000Z',
                        finishedAt: '2026-10-01T10:00:00.100Z',
                        durationMs: 100,
                        actualProvider: 'openai',
                        actualModel: 'gpt-test',
                        requestedProvider: 'openrouter',
                        requestedModel: 'route/test',
                        usage: {
                            promptTokens: 12,
                            completionTokens: 4,
                            totalTokens: 16,
                        },
                        cost: {
                            inputCostUsd: 0,
                            outputCostUsd: 0,
                            totalCostUsd: 0,
                            costCompleteness: 'complete',
                        },
                        routingAttempts: [
                            {
                                index: 0,
                                profileId: 'fallback-profile',
                                requestedProvider: 'openrouter',
                                actualProvider: 'openai',
                                actualModel: 'gpt-test',
                                status: 'succeeded',
                                durationMs: 100,
                                chooseOneUsed: true,
                                chooseOneSelectedIndex: 0,
                            },
                        ],
                        trustGraphTargets: [
                            {
                                targetId: 'docs',
                                flow: 'document-rag',
                                collection: 'help',
                                outcome: 'executed',
                                measurements: {
                                    provenance: 'footnote_measured',
                                    requestDurationMs: 37,
                                    returnedSourceCount: 3,
                                    retainedSourceCount: 2,
                                },
                                bounds: {
                                    provenance: 'derived',
                                    sourcesTruncated: true,
                                },
                            },
                        ],
                    },
                ],
            },
            {
                stepId: 'write',
                attempt: 2,
                stepKind: 'generate',
                startedAt: '2026-10-01T10:00:00.100Z',
                finishedAt: '2026-10-01T10:00:02.000Z',
                durationMs: 1900,
                resultRefs: [{ resultId: 'result-1', name: 'final-answer' }],
                outcome: {
                    status: 'executed',
                    summary: 'PRIVATE_ANSWER_MUST_NOT_RENDER',
                },
                cost: {
                    inputCostUsd: 0.1,
                    outputCostUsd: 0.2,
                    totalCostUsd: 0.3,
                    costCompleteness: 'partial',
                },
                attempts: [
                    {
                        attempt: 1,
                        status: 'failed',
                        startedAt: '2026-10-01T10:00:00.100Z',
                        finishedAt: '2026-10-01T10:00:00.200Z',
                        durationMs: 100,
                        reasonCode: 'provider_timeout',
                    },
                    {
                        attempt: 2,
                        status: 'succeeded',
                        startedAt: '2026-10-01T10:00:00.200Z',
                        finishedAt: '2026-10-01T10:00:02.000Z',
                        durationMs: 1800,
                        actualProvider: 'ollama',
                        actualModel: 'qwen-local',
                        cost: {
                            inputCostUsd: 0,
                            outputCostUsd: 0,
                            totalCostUsd: 0,
                            costCompleteness: 'unknown',
                        },
                    },
                ],
            },
            {
                stepId: 'review',
                attempt: 1,
                stepKind: 'assess',
                startedAt: '2026-10-01T10:00:02.000Z',
                finishedAt: '2026-10-01T10:00:02.000Z',
                durationMs: 0,
                outcome: {
                    status: 'skipped',
                    summary: 'PRIVATE_SIGNAL_MUST_NOT_RENDER',
                },
            },
        ],
    },
};

test('shows the run, steps, attempts, and recorded results', async ({
    page,
}) => {
    await page.route('**/api/admin/executions/response-report-1', (route) =>
        route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(report),
        })
    );

    await page.goto('/admin/executions/response-report-1');

    await expect(
        page.getByRole('heading', { name: 'Execution report' })
    ).toBeVisible();
    await expect(page.getByText('Record freshness')).toHaveCount(0);
    await expect(page.getByText('2000 ms')).toBeVisible();
    await expect(
        page.getByText('openai / gpt-test', { exact: true })
    ).toBeVisible();
    await expect(
        page.getByText('Input 12 · Output 4 · Total 16', { exact: true })
    ).toBeVisible();
    await expect(
        page.getByText(/Cached input|Cache write|Reasoning/u)
    ).toHaveCount(0);
    await expect(
        page.getByText('$0.000000 · complete', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('$0.000000 · unknown')).toBeVisible();
    await expect(page.getByText('$0.300000 · partial')).toBeVisible();
    await expect(page.getByText('Completeness unavailable')).toBeVisible();
    await expect(page.getByText('provider_timeout')).toBeVisible();
    await page.getByText('Routing attempts (1)').click();
    await expect(
        page.locator('details').filter({ hasText: 'Routing attempts' })
    ).toContainText('fallback-profile');
    await page.getByText('TrustGraph targets (1)').click();
    await expect(
        page.locator('details').filter({ hasText: 'TrustGraph targets' })
    ).toContainText('3 returned, 2 retained');
    await expect(
        page.locator('details').filter({ hasText: 'TrustGraph targets' })
    ).toContainText('Request time: 37 ms');
    await expect(page.getByText('final-answer: produced')).toBeVisible();

    const stepHeadings = await page
        .locator('.execution-report__step h3')
        .allTextContents();
    expect(stepHeadings).toEqual([
        'plan · executed',
        'generate · executed',
        'assess · skipped',
    ]);
    await expect(
        page.getByText(/PRIVATE_(SUMMARY|ANSWER|SIGNAL)_MUST_NOT_RENDER/u)
    ).toHaveCount(0);
});

test('shows a completed run with successful attempt details', async ({
    page,
}) => {
    const completedReport = {
        responseId: 'response-complete-1',
        workflow: {
            runId: 'run-complete-1',
            runStatus: 'completed',
            workflowId: 'reviewed',
            workflowName: 'Reviewed response',
            status: 'completed',
            startedAt: '2026-10-01T10:00:00.000Z',
            finishedAt: '2026-10-01T10:00:01.000Z',
            durationMs: 1000,
            stepCount: 1,
            maxSteps: 6,
            maxDurationMs: 60000,
            terminationReason: 'goal_satisfied',
            steps: [
                {
                    stepId: 'generate',
                    attempt: 1,
                    stepKind: 'generate',
                    startedAt: '2026-10-01T10:00:00.000Z',
                    finishedAt: '2026-10-01T10:00:01.000Z',
                    durationMs: 1000,
                    resultRefs: [
                        { resultId: 'result-complete', name: 'answer' },
                    ],
                    outcome: { status: 'executed', summary: 'PRIVATE_SUMMARY' },
                    attempts: [
                        {
                            attempt: 1,
                            status: 'succeeded',
                            startedAt: '2026-10-01T10:00:00.000Z',
                            finishedAt: '2026-10-01T10:00:01.000Z',
                            durationMs: 1000,
                            actualProvider: 'openai',
                            actualModel: 'gpt-test',
                            usage: {
                                promptTokens: 18,
                                cachedInputTokens: 5,
                                cacheWriteTokens: 2,
                                completionTokens: 7,
                                reasoningTokens: 3,
                                totalTokens: 30,
                            },
                            cost: {
                                inputCostUsd: 0.01,
                                outputCostUsd: 0.02,
                                totalCostUsd: 0.03,
                                costCompleteness: 'complete',
                            },
                        },
                    ],
                },
            ],
            results: [
                {
                    resultId: 'result-complete',
                    name: 'answer',
                    status: 'produced',
                    producedByStepId: 'generate',
                    producedByAttempt: 1,
                },
            ],
        },
    };

    await page.route('**/api/admin/executions/response-complete-1', (route) =>
        route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(completedReport),
        })
    );

    await page.goto('/admin/executions/response-complete-1');

    await expect(page.getByText('completed', { exact: true })).toBeVisible();
    await expect(page.getByText('generate · executed')).toBeVisible();
    await expect(
        page.getByText('openai / gpt-test', { exact: true })
    ).toBeVisible();
    await expect(
        page.getByText(
            'Input 18 · Cached input 5 · Cache write 2 · Output 7 · Reasoning 3 · Total 30',
            { exact: true }
        )
    ).toBeVisible();
    await expect(page.getByText('$0.030000 · complete')).toBeVisible();
    await expect(page.getByText('answer: produced')).toBeVisible();
    await expect(page.getByText('PRIVATE_SUMMARY')).toHaveCount(0);
});

test('shows backend access denial without rendering a record', async ({
    page,
}) => {
    await page.route('**/api/admin/executions/forbidden', (route) =>
        route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Admin access required' }),
        })
    );

    await page.goto('/admin/executions/forbidden');

    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toContainText(
        'Admin access is required to view this execution report.'
    );
    await expect(page.getByText('PRIVATE_ANSWER_MUST_NOT_RENDER')).toHaveCount(
        0
    );
});
