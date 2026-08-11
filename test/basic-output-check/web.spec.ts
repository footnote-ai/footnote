/**
 * @description: Checks one completed public web chat interaction against fixed backend data.
 * @footnote-scope: test
 * @footnote-module: BasicWebOutputCheck
 * @footnote-risk: low - The test intercepts requests and does not contact a live backend.
 * @footnote-ethics: medium - It protects visible provenance and trace access in a user-facing answer.
 */
import { expect, test } from '@playwright/test';
import outputCase from './fixtures/ordinary-text-answer.json';

test('shows one ordinary answer with its provenance', async ({
    page,
}, testInfo) => {
    let configRequestCount = 0;

    await page.route('**/config.json', async (route) => {
        configRequestCount += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
    await page.route('**/api/chat', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(outputCase.response),
        });
    });

    await page.goto('/chat');
    const questionInput = page.getByLabel('Ask a question');
    await questionInput.fill(outputCase.question);
    await expect.poll(() => configRequestCount).toBe(1);

    const chatRequestPromise = page.waitForRequest('**/api/chat');
    await page.getByRole('button', { name: 'Submit question' }).click();
    const chatRequest = await chatRequestPromise;

    expect(chatRequest.postDataJSON()).toEqual({
        surface: 'web',
        trigger: { kind: 'submit' },
        latestUserInput: outputCase.question,
        conversation: [{ role: 'user', content: outputCase.question }],
        capabilities: {
            canReact: false,
            canGenerateImages: false,
            canUseTts: false,
        },
        surfaceContext: { requestHost: 'output-check.localhost:4173' },
    });

    await expect(page.getByText(outputCase.response.message)).toBeVisible();
    await expect(
        page.getByRole('complementary', {
            name: 'Response provenance and metadata',
        })
    ).toContainText('Reasoning - Retrieved');
    await expect(page.getByLabel('Source: example.org')).toHaveAttribute(
        'href',
        outputCase.response.metadata.citations[0].url
    );
    await expect(
        page.getByLabel('View full trace for this response')
    ).toHaveAttribute(
        'href',
        `/api/traces/${outputCase.response.metadata.responseId}`
    );
    await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: testInfo.outputPath('ordinary-text-answer.png'),
    });
});
