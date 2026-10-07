/**
 * @description: Smoke-tests the standalone published response route with an allowlisted API projection.
 * @footnote-scope: test
 * @footnote-module: SharedResponsePageBrowserSmoke
 * @footnote-risk: low - The browser test uses a fixed, intercepted public response.
 * @footnote-ethics: medium - It guards the anonymous page against exposing trace fields.
 */
import { expect, test, type Page } from '@playwright/test';
import { configureRuntime, response } from './chat-test-helpers';

const preparePublishedTurn = async (
    page: Page,
    revokeStatus: 404 | 410
): Promise<void> => {
    const publicId = 'B'.repeat(43);
    await configureRuntime(page);
    await page.route('**/api/chat', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                ...response('A published answer.'),
                publicationToken: 'A'.repeat(43),
            }),
        });
    });
    await page.route('**/api/public-responses', async (route) => {
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                publicId,
                publishedAt: '2026-10-07T12:00:00.000Z',
                expiresAt: '2026-10-14T12:00:00.000Z',
            }),
        });
    });
    await page.route(`**/api/public-responses/${publicId}`, async (route) => {
        await route.fulfill({
            status: revokeStatus,
            contentType: 'application/json',
            body: JSON.stringify({
                error: 'This published response is no longer available.',
            }),
        });
    });

    await page.goto('/chat');
    await page.getByLabel('Ask a question').fill('Publish this answer?');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await page.getByRole('button', { name: 'Publish this answer' }).click();
};

test('renders the public response projection without trace metadata', async ({
    page,
}) => {
    await page.route('**/api/public-responses/public-id', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                answer: 'The published answer.',
                provenance: 'Retrieved',
                limitations: [
                    'Source links were omitted because saved citations are not classified as public.',
                ],
                publishedAt: '2026-10-07T12:00:00.000Z',
                expiresAt: '2026-10-14T12:00:00.000Z',
            }),
        });
    });

    await page.goto('/share/public-id');

    await expect(
        page.getByRole('heading', { name: 'Published answer' })
    ).toBeVisible();
    await expect(page.getByText('The published answer.')).toBeVisible();
    await expect(page.getByText('Recorded as retrieved.')).toBeVisible();
    await expect(
        page.getByText(
            'Source links were omitted because saved citations are not classified as public.'
        )
    ).toBeVisible();
    await expect(
        page.locator('.shared-response-page').getByRole('link')
    ).toHaveCount(0);
});

test('reports an unavailable publication after unpublish is attempted', async ({
    page,
}) => {
    await preparePublishedTurn(page, 410);
    await page.getByRole('button', { name: 'Unpublish' }).click();

    await expect(
        page
            .getByRole('status')
            .filter({ hasText: 'This public link is no longer available.' })
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'View public page' })
    ).toHaveCount(0);
});

test('does not treat an ambiguous 404 as confirmation of unpublishing', async ({
    page,
}) => {
    await preparePublishedTurn(page, 404);
    await page.getByRole('button', { name: 'Unpublish' }).click();

    await expect(
        page.getByText(
            'The response could not be unpublished. Please try again.'
        )
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'View public page' })
    ).toBeVisible();
});
