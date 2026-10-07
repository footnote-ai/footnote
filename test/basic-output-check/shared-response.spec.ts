/**
 * @description: Smoke-tests the standalone published response route with an allowlisted API projection.
 * @footnote-scope: test
 * @footnote-module: SharedResponsePageBrowserSmoke
 * @footnote-risk: low - The browser test uses a fixed, intercepted public response.
 * @footnote-ethics: medium - It guards the anonymous page against exposing trace fields.
 */
import { expect, test } from '@playwright/test';

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
