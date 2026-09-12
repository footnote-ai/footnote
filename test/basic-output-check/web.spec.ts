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

test('public homepage explains prepared and live paths', async ({
    page,
}, testInfo) => {
    await page.goto('/');

    await expect(page.locator('h1#homepage-title')).toBeVisible();
    await expect(
        page.getByText(
            'We care more about giving you answers that are easy to check.'
        )
    ).toBeVisible();
    const introSentences = page.locator('.public-home__intro-sentence');
    await expect(introSentences).toHaveCount(2);
    const firstSentenceBox = await introSentences.nth(0).boundingBox();
    const secondSentenceBox = await introSentences.nth(1).boundingBox();
    expect(firstSentenceBox).not.toBeNull();
    expect(secondSentenceBox).not.toBeNull();
    if (!firstSentenceBox || !secondSentenceBox) {
        throw new Error('Intro sentence geometry was not available.');
    }
    expect(firstSentenceBox.height).toBe(secondSentenceBox.height);
    expect(secondSentenceBox.y).toBeGreaterThan(firstSentenceBox.y);
    await expect(page.locator('.public-home__prepared')).toContainText(
        'This is a prepared example —'
    );

    for (const concept of ['origins', 'uncertainty', 'steps', 'limits']) {
        await expect(
            page.locator(`[data-concept=\"${concept}\"] .public-home__concept`)
        ).toBeVisible();
    }

    const origins = page.locator('[data-concept=\"origins\"]');
    const originsCard = origins.locator('.public-home__concept');
    await originsCard.hover();
    await expect(origins.locator('[role=\"region\"]')).toBeVisible();
    await expect(origins).toHaveAttribute('data-active', 'true');
    await expect(origins.locator('button')).toHaveCount(0);
    await originsCard.click();
    await expect(origins).toHaveAttribute('data-active', 'true');
    await expect(origins.locator('[role=\"region\"]')).toContainText(
        'provenance'
    );
    await page.waitForTimeout(250);
    const originsBox = await origins
        .locator('.public-home__concept-body')
        .boundingBox();
    const originsDetailBox = await origins
        .locator('[role=\"region\"]')
        .boundingBox();
    expect(originsBox).not.toBeNull();
    expect(originsDetailBox).not.toBeNull();
    if (!originsBox || !originsDetailBox) {
        throw new Error('Origins panel geometry was not available.');
    }
    expect(originsDetailBox).toEqual(originsBox);
    await expect(origins.locator('a')).toHaveAttribute(
        'href',
        '/wiki/architecture/canonical-response-footnote/'
    );
    await expect(origins.locator('a')).toHaveAttribute('target', '_blank');
    await originsCard.focus();
    await expect(origins).toHaveAttribute('data-active', 'true');
    await originsCard.evaluate((element) => element.blur());
    await originsCard.hover();
    await expect(
        page.getByRole('link', { name: 'Ask a question' }).first()
    ).toHaveAttribute('href', '/chat');
    await expect(page.getByRole('link', { name: 'How it works' })).toHaveCount(
        0
    );
    await expect(
        page.getByRole('heading', { name: 'Run it yourself' })
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'Setup guide' })
    ).toHaveAttribute('href', '/wiki/getting-started/');
    await expect(
        page.getByRole('link', { name: 'Privacy and control' })
    ).toHaveAttribute('href', '/wiki/philosophy/');

    await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: testInfo.outputPath('public-home-prepared.png'),
    });
});

test('public homepage remains usable at mobile width', async ({ page }) => {
    const context = await page
        .context()
        .browser()
        ?.newContext({
            baseURL: 'http://output-check.localhost:4173',
            hasTouch: true,
            isMobile: true,
            viewport: { width: 390, height: 844 },
        });
    if (!context) {
        throw new Error('A browser context was not available.');
    }
    const mobilePage = await context.newPage();

    try {
        await mobilePage.goto('/');

        await expect(mobilePage.locator('h1#homepage-title')).toBeVisible();
        await expect(
            mobilePage.getByRole('link', { name: 'Ask a question' }).first()
        ).toBeVisible();
        const mobileConcepts = [
            { id: 'origins', technicalTerm: 'provenance' },
            { id: 'uncertainty', technicalTerm: 'uncertainty' },
            { id: 'steps', technicalTerm: 'workflow' },
            { id: 'limits', technicalTerm: 'limitations' },
        ] as const;
        for (const concept of mobileConcepts) {
            const card = mobilePage.locator(`[data-concept=\"${concept.id}\"]`);
            await card.locator('.public-home__concept').click();
            const region = card.locator('[role=\"region\"]');
            const technicalLink = region.locator('a');
            await expect(region).toBeVisible();
            await expect(region).toHaveAttribute('aria-hidden', 'false');
            await expect(technicalLink).toContainText(concept.technicalTerm);
            await technicalLink.scrollIntoViewIfNeeded();
            await expect(technicalLink).toBeVisible();
            const linkFitsRegion = await technicalLink.evaluate((element) => {
                const regionElement = element.closest('[role="region"]');
                if (!regionElement) {
                    return false;
                }
                const linkRect = element.getBoundingClientRect();
                const regionRect = regionElement.getBoundingClientRect();
                return (
                    linkRect.height > 0 &&
                    linkRect.top >= regionRect.top &&
                    linkRect.bottom <= regionRect.bottom
                );
            });
            expect(linkFitsRegion).toBe(true);
            await expect
                .poll(() =>
                    region.evaluate(
                        (element) =>
                            element.scrollHeight <= element.clientHeight
                    )
                )
                .toBe(true);
        }
        await expect
            .poll(() =>
                mobilePage.evaluate(() => document.documentElement.scrollWidth)
            )
            .toBeLessThanOrEqual(390);
    } finally {
        await context.close();
    }
});

test('public homepage keeps hover reveal at narrow desktop width', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const origins = page.locator('[data-concept="origins"]');
    const originsCard = origins.locator('.public-home__concept');
    await originsCard.hover();
    await expect(origins).toHaveAttribute('data-active', 'true');
    await expect(origins.locator('[role="region"]')).toBeVisible();
});
