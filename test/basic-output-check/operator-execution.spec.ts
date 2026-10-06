/**
 * @description: Checks the operator execution report against fixed bounded backend projections.
 * @footnote-scope: test
 * @footnote-module: OperatorExecutionReportBrowserCheck
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

test('renders the bounded Run, ordered Steps, Attempts, and outcome facts', async ({
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
    await expect(
        page.getByText('Unavailable from this projection')
    ).toBeVisible();
    await expect(page.getByText('2000 ms')).toBeVisible();
    await expect(
        page.getByText('openai / gpt-test', { exact: true })
    ).toBeVisible();
    await expect(
        page.getByText(
            'promptTokens: 12 · completionTokens: 4 · totalTokens: 16'
        )
    ).toBeVisible();
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
    ).toContainText('3 returned / 2 retained');
    await expect(
        page.locator('details').filter({ hasText: 'TrustGraph targets' })
    ).toContainText('Footnote request boundary 37 ms');
    await expect(page.getByText('final-answer: produced')).toBeVisible();

    const stepHeadings = await page
        .locator('.operator-execution__step h3')
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

test('shows backend access denial without rendering a record', async ({
    page,
}) => {
    await page.route('**/api/admin/executions/forbidden', (route) =>
        route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Operator access required' }),
        })
    );

    await page.goto('/admin/executions/forbidden');

    await expect(
        page.getByText(
            'Operator access is required to view this execution record.'
        )
    ).toBeVisible();
    await expect(page.getByText('PRIVATE_ANSWER_MUST_NOT_RENDER')).toHaveCount(
        0
    );
});
