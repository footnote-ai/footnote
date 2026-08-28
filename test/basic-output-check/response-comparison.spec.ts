/**
 * @description: Checks the response-comparison report's blind review flow in a real browser.
 * @footnote-scope: test
 * @footnote-module: ResponseComparisonReportSmokeTest
 * @footnote-risk: medium - A broken report can expose metadata or lose reviewer evidence.
 * @footnote-ethics: high - Blind review helps keep model expectations from biasing human judgment.
 */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import {
    buildReportHtml,
    type ResponseComparisonReport,
} from '../../scripts/lib/response-comparison.js';

const report: ResponseComparisonReport = {
    schemaVersion: 1,
    reportId: 'browser-smoke',
    createdAt: new Date(0).toISOString(),
    command: 'test',
    configPath: 'test.yaml',
    configHash: 'hash',
    dependencies: {},
    config: {
        version: 1,
        name: 'browser smoke',
        models: [{ profile: 'writer' }],
        settings: ['default'],
        repeats: 1,
        cases: [
            {
                id: 'case',
                persona: 'footnote',
                expressionStrength: 'balanced',
                messages: [
                    {
                        role: 'system',
                        content: 'Keep the supplied facts and limits.',
                    },
                    { role: 'user', content: 'Say hello.' },
                ],
                requirements: [
                    {
                        id: 'hello',
                        kind: 'facts',
                        statement: 'Keep the greeting.',
                    },
                ],
            },
        ],
        review: {
            mustKeep: ['facts'],
            rate: ['naturalness'],
            blind: true,
        },
    },
    attempts: [
        {
            attemptId: 'attempt-1',
            comparisonId: 'attempt-1',
            model: { profile: 'writer' },
            setting: 'default',
            caseId: 'case',
            repeat: 1,
            status: 'completed',
            source: {
                messages: [
                    {
                        role: 'system',
                        content: 'Keep the supplied facts and limits.',
                    },
                    { role: 'user', content: 'Say hello.' },
                ],
                persona: 'footnote',
                resolvedGuidance: 'Plain and direct.',
                expressionGuidance: 'Balanced expression.',
                expressionStrength: 'balanced',
                guidanceHash: 'guidance-hash',
                requirements: [
                    {
                        id: 'hello',
                        kind: 'facts',
                        statement: 'Keep the greeting.',
                    },
                ],
                reviewRequirements: [
                    {
                        id: 'hello',
                        kind: 'facts',
                        statement: 'Keep the greeting.',
                    },
                ],
            },
            output: { text: 'Hello.' },
            operations: { latencyMs: 10, costUsd: 0.01 },
        },
    ],
    humanReviews: [],
    blindnessEvents: [],
};

test('keeps review blind, saves judgments, reveals metadata, and exports reviewed evidence', async ({
    page,
}) => {
    await page.route('**/response-comparison-smoke.html', async (route) => {
        await route.fulfill({
            contentType: 'text/html',
            body: buildReportHtml(report),
        });
    });

    await page.goto('/response-comparison-smoke.html');
    await expect(
        page.locator('[data-role="comparison-summary"]')
    ).toBeVisible();
    await expect(page.locator('[data-role="blind-review"]')).toBeVisible();
    await expect(page.locator('[data-role="operational-details"]')).toHaveCount(
        0
    );
    await expect(page.getByText('Model support')).toHaveCount(0);
    await expect(
        page.getByText('Keep the supplied facts and limits.')
    ).toBeVisible();

    const review = page.locator('form[data-role="human-review"]').first();
    await review.locator('select').first().selectOption('5');
    await review.locator('textarea').fill('Keep the greeting.');
    await page.getByPlaceholder('Optional').fill('Reviewer');
    await page.reload();

    await expect(review.locator('select').first()).toHaveValue('5');
    await expect(review.locator('textarea')).toHaveValue('Keep the greeting.');
    await expect(page.getByPlaceholder('Optional')).toHaveValue('Reviewer');
    const saved = await page.evaluate(() =>
        localStorage.getItem('response-comparison:browser-smoke')
    );
    expect(saved).toContain('Keep the greeting.');

    await page.getByRole('button', { name: 'Reveal metadata' }).click();
    await expect(
        page.locator('[data-role="operational-details"]')
    ).toBeVisible();
    await expect(page.locator('[data-role="blind-review"]')).toHaveCount(0);
    await expect(page.getByText('Model support')).toBeVisible();
    const state = await page.evaluate(() =>
        localStorage.getItem('response-comparison:browser-smoke')
    );
    expect(state).toMatch(/"action":"revealed"/u);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download reviewed HTML' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('-reviewed-');
    const downloadPath = await download.path();
    if (downloadPath === null)
        throw new Error('Reviewed report was not downloaded.');
    const reviewedHtml = fs.readFileSync(downloadPath, 'utf8');
    expect(reviewedHtml).toContain('"parentReportId":"browser-smoke"');
    expect(reviewedHtml).toContain('"action":"exported"');
});
