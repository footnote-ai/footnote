/**
 * @description: Checks transcript scrolling and bounded announcements in Chromium.
 * @footnote-scope: test
 * @footnote-module: ChatAccessibilityBrowserCheck
 * @footnote-risk: low - The test controls chat responses and uses a local browser.
 * @footnote-ethics: medium - It protects keyboard and screen-reader access to new chat content.
 */
import { expect, test } from '@playwright/test';
import ordinaryAnswer from './fixtures/ordinary-text-answer.json';

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const configureRuntime = async (page: import('@playwright/test').Page) => {
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
};

const response = (message: string) => ({
    ...ordinaryAnswer.response,
    message,
});

test('follows new transcript content at the end and offers a jump when scrolled up', async ({
    page,
}) => {
    await configureRuntime(page);
    let requestCount = 0;
    const secondResponse = deferred();
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        if (requestCount === 2) {
            await secondResponse.promise;
        }
        const message =
            requestCount === 1
                ? Array.from(
                      { length: 24 },
                      (_, index) =>
                          `Paragraph ${index + 1} keeps the transcript long enough to scroll.`
                  ).join('\n\n')
                : 'The follow-up answer is ready.';
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                ...ordinaryAnswer.response,
                message,
            }),
        });
    });

    await page.goto('/chat');
    const input = page.getByLabel('Ask a question');
    await input.fill('First question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    const transcriptEnd = page.locator('.interaction-transcript-end');
    await expect(page.locator('.public-message--assistant')).toContainText(
        'Paragraph 24'
    );
    await expect
        .poll(() =>
            transcriptEnd.evaluate((element) => {
                const bottom = element.getBoundingClientRect().bottom;
                return bottom <= window.innerHeight + 4;
            })
        )
        .toBe(true);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(50);
    await input.fill('Follow-up question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(
        page.getByRole('button', { name: 'Jump to latest' })
    ).toBeVisible();
    await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeLessThan(8);

    secondResponse.resolve();
    await expect(
        page.getByText('The follow-up answer is ready.')
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Jump to latest' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Jump to latest' }).click();
    await expect(
        page.getByRole('button', { name: 'Jump to latest' })
    ).toHaveCount(0);
    await expect
        .poll(() =>
            transcriptEnd.evaluate((element) => {
                const bottom = element.getBoundingClientRect().bottom;
                return bottom <= window.innerHeight + 4;
            })
        )
        .toBe(true);
});

test('announces only the new request state and keeps composer focus available', async ({
    page,
}) => {
    await configureRuntime(page);
    const pendingResponse = deferred();
    let requestCount = 0;
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        if (requestCount === 1) {
            await pendingResponse.promise;
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(response('A short answer.')),
            });
            return;
        }
        await route.abort('failed');
    });

    await page.goto('/chat');
    const input = page.getByLabel('Ask a question');
    await input.fill('A question');
    await input.press('Control+Enter');
    await expect(input).toBeFocused();
    await expect(page.locator('.interaction-transcript')).not.toHaveAttribute(
        'aria-live',
        /.+/
    );
    await expect(page.locator('.interaction-request-state')).toHaveAttribute(
        'role',
        'status'
    );

    pendingResponse.resolve();
    await expect(page.getByText('A short answer.')).toBeVisible();
    await expect(page.locator('.sr-only[role="status"]')).toHaveText(
        'New response received.'
    );
    await expect(
        page.locator('.interaction-transcript [role="status"]')
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await expect(page.locator('.interaction-transcript')).toHaveCount(0);

    await input.fill('A request that fails');
    await input.press('Control+Enter');
    await expect(input).toBeFocused();
    await expect(page.getByRole('status')).toHaveText(
        'Unable to connect to the server. Please check your connection and try again.'
    );
});

test('embed height follows long responses and provenance drawers without horizontal overflow', async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await configureRuntime(page);
    const longAnswer = Array.from(
        { length: 18 },
        (_, index) =>
            `Response paragraph ${index + 1} adds readable content to the embedded transcript.`
    ).join('\n\n');
    await page.route('**/api/chat', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(response(longAnswer)),
        });
    });

    await page.goto('/');
    await page.evaluate(() => {
        const parent = window as Window & { __footnoteEmbedHeights?: number[] };
        parent.__footnoteEmbedHeights = [];
        window.addEventListener('message', (event: MessageEvent) => {
            const data = event.data as { type?: string; height?: number };
            if (data.type !== 'footnote-embed-height' || !data.height) {
                return;
            }
            parent.__footnoteEmbedHeights?.push(data.height);
            const frame = document.getElementById(
                'footnote-chat-frame'
            ) as HTMLIFrameElement | null;
            if (frame) {
                frame.style.height = `${data.height}px`;
            }
        });
        const frame = document.createElement('iframe');
        frame.id = 'footnote-chat-frame';
        frame.title = 'Footnote chat';
        frame.src = '/embed';
        frame.style.width = '100%';
        frame.style.height = '300px';
        document.body.append(frame);
    });

    const embed = page.frameLocator('#footnote-chat-frame');
    await expect(embed.getByLabel('Ask a question')).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (
                        window as Window & {
                            __footnoteEmbedHeights?: number[];
                        }
                    ).__footnoteEmbedHeights?.length ?? 0
            )
        )
        .toBeGreaterThan(0);
    const initialHeight = await page.evaluate(() => {
        const heights =
            (window as Window & { __footnoteEmbedHeights?: number[] })
                .__footnoteEmbedHeights ?? [];
        return Math.max(...heights);
    });

    await embed.getByLabel('Ask a question').fill('Explain the embed height.');
    await embed.getByRole('button', { name: 'Submit question' }).click();
    await expect(embed.getByText('Response paragraph 18')).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const heights =
                    (window as Window & { __footnoteEmbedHeights?: number[] })
                        .__footnoteEmbedHeights ?? [];
                return Math.max(...heights);
            })
        )
        .toBeGreaterThan(initialHeight);

    const responseHeight = await page.evaluate(() => {
        const heights =
            (window as Window & { __footnoteEmbedHeights?: number[] })
                .__footnoteEmbedHeights ?? [];
        return Math.max(...heights);
    });
    await embed.getByRole('button', { name: 'Sources', exact: true }).click();
    await expect(embed.getByRole('region', { name: 'Sources' })).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => {
                const heights =
                    (window as Window & { __footnoteEmbedHeights?: number[] })
                        .__footnoteEmbedHeights ?? [];
                return Math.max(...heights);
            })
        )
        .toBeGreaterThan(responseHeight);

    const embedWidthState = await embed.locator('body').evaluate((body) => ({
        bodyWidth: body.scrollWidth,
        viewportWidth: window.innerWidth,
        nestedFrames: document.querySelectorAll('iframe').length,
    }));
    expect(embedWidthState.bodyWidth).toBeLessThanOrEqual(
        embedWidthState.viewportWidth
    );
    expect(embedWidthState.nestedFrames).toBe(0);
});
