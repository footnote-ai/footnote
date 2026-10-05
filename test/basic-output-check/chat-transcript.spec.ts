/**
 * @description: Verifies successful chat turns remain stacked with response-local provenance in Chromium.
 * @footnote-scope: test
 * @footnote-module: ChatTranscriptBrowserCheck
 * @footnote-risk: low - The test intercepts chat requests and uses fixed responses.
 * @footnote-ethics: medium - It protects the association between assistant output and its recorded sources.
 */

import { expect, test } from '@playwright/test';
import { expectTurnSource, responseWithCitation } from './chat-test-helpers';

test('keeps each successful exchange and its provenance after a follow-up', async ({
    page,
}, testInfo) => {
    let responseNumber = 0;
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
    await page.route('**/api/chat', async (route) => {
        responseNumber += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(
                responseWithCitation(
                    `Answer for turn ${responseNumber}.`,
                    `transcript-response-${responseNumber}`,
                    `Source for turn ${responseNumber}`,
                    `https://example.org/source-${responseNumber}`,
                    `Evidence for turn ${responseNumber}.`
                )
            ),
        });
    });

    await page.goto('/chat');
    const input = page.getByLabel('Ask a question');
    await input.fill('First question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.locator('.interaction-turn')).toHaveCount(1);

    await input.fill('Follow-up question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.locator('.interaction-turn')).toHaveCount(2);

    const firstTurn = page.locator('.interaction-turn').nth(0);
    const secondTurn = page.locator('.interaction-turn').nth(1);
    await expect(firstTurn.locator('.public-message--person')).toHaveText(
        'First question'
    );
    await expect(firstTurn.locator('.public-message--assistant')).toContainText(
        'Answer for turn 1.'
    );
    await expect(secondTurn.locator('.public-message--person')).toHaveText(
        'Follow-up question'
    );
    await expect(
        secondTurn.locator('.public-message--assistant')
    ).toContainText('Answer for turn 2.');

    const firstFootnote = await expectTurnSource(
        firstTurn,
        'transcript-response-1',
        'Source for turn 1',
        'https://example.org/source-1',
        'Source for turn 2'
    );
    const secondFootnote = await expectTurnSource(
        secondTurn,
        'transcript-response-2',
        'Source for turn 2',
        'https://example.org/source-2',
        'Source for turn 1'
    );
    await expect(firstTurn.locator('.public-message--assistant')).toContainText(
        'Answer for turn 1.'
    );

    await firstFootnote
        .getByRole('button', { name: 'Trace', exact: true })
        .click();
    const firstTrace = firstFootnote.getByRole('region', { name: 'Trace' });
    await expect(firstTrace).toContainText(
        'Trace availability is not confirmed by the chat response.'
    );
    await expect(
        firstTrace.getByRole('link', { name: 'Open full Trace' })
    ).toHaveAttribute('href', '/traces/transcript-response-1');

    await secondFootnote
        .getByRole('button', { name: 'Trace', exact: true })
        .click();
    const secondTrace = secondFootnote.getByRole('region', { name: 'Trace' });
    await expect(secondTrace).toContainText(
        'Trace availability is not confirmed by the chat response.'
    );
    await expect(
        secondTrace.getByRole('link', { name: 'Open full Trace' })
    ).toHaveAttribute('href', '/traces/transcript-response-2');
    await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: testInfo.outputPath('chat-transcript.png'),
    });
});

test('keeps a failed request outside assistant markdown', async ({ page }) => {
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
    await page.route('**/api/chat', async (route) => {
        await route.abort('failed');
    });

    await page.goto('/chat');
    const prompt = 'Please explain the failed request.';
    await page.getByLabel('Ask a question').fill(prompt);
    await page.getByRole('button', { name: 'Submit question' }).click();

    const turn = page.locator('.interaction-turn');
    await expect(turn).toHaveCount(1);
    await expect(turn.locator('.public-message--person')).toHaveText(prompt);
    await expect(page.getByRole('status')).toContainText(
        'Unable to connect to the server.'
    );
    await expect(page.getByRole('status')).toHaveAttribute(
        'data-request-state',
        'network'
    );
    await expect(turn.locator('.interaction-request-state')).toHaveText(
        'No assistant response was added.'
    );
    await expect(turn.locator('.public-message--assistant')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
        'I was unable to generate a response - please try again later.'
    );
});
