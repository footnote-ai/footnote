/**
 * @description: Checks the compact embed route, its authentic prepared response, and iframe sizing.
 * @footnote-scope: test
 * @footnote-module: EmbedOutputCheck
 * @footnote-risk: low - Browser coverage exercises the public route and resize contract without changing runtime state.
 * @footnote-ethics: medium - It guards truthful captured metadata and visible provenance in the portable embed.
 */
import { expect, test } from '@playwright/test';
import {
    configureRuntime,
    latestEmbedHeight,
    mountSizedEmbed,
    mountUnmanagedEmbed,
    readEmbedHeights,
    response,
} from './chat-test-helpers';

const exampleQuestion =
    'Can you walk me through how to trace why Footnote gave an answer? Please link to two relevant documentation pages.';

test('standalone embed presents the first homepage answer, full footer, and project links', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await configureRuntime(page);
    await page.goto('/embed');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const main = page.locator('main#main-content');
    const example = page.locator('.public-embed__example');
    const footnote = example.getByRole('region', {
        name: 'Response provenance and controls',
    });

    await expect(page.locator('.public-header__mark')).toContainText(
        'Footnote'
    );
    await expect(
        page.getByRole('heading', { name: 'AI that shows its work.' })
    ).toBeVisible();
    await expect(
        page.getByText(
            'See how an answer was made, set your own rules, and run Footnote your way.',
            { exact: true }
        )
    ).toBeVisible();
    await expect(example.getByText('Recorded example')).toHaveCount(0);
    await expect(
        example.getByText(exampleQuestion, { exact: true })
    ).toBeVisible();
    await expect(example.locator('.public-message--assistant')).toContainText(
        'Footnote is built around inspectability, so there are two natural places to look: provenance and observability.'
    );
    await expect(footnote).toHaveAttribute(
        'data-response-id',
        'prepared-landing-inspect-an-answer'
    );
    for (const summary of ['Evidence', 'Sensitivity', 'Licensing']) {
        await expect(footnote).toContainText(summary);
    }

    await footnote
        .getByRole('button', { name: 'Sources', exact: true })
        .click();
    const sources = footnote.getByRole('region', { name: 'Sources' });
    await expect(sources).toBeVisible();
    await expect(
        sources.getByRole('link', {
            name: 'Provenance | footnote-ai/footnote',
        })
    ).toHaveAttribute(
        'href',
        'https://deepwiki.com/footnote-ai/footnote/2.3-provenance'
    );
    await footnote
        .getByRole('button', { name: 'Close Sources drawer' })
        .click();
    await footnote
        .getByRole('button', { name: 'Controls', exact: true })
        .click();
    await expect(
        footnote.getByRole('region', { name: 'Controls' })
    ).toBeVisible();
    await expect(
        footnote.getByRole('button', {
            name: 'Trace',
            exact: true,
        })
    ).toBeDisabled();
    await expect(
        footnote.getByRole('button', {
            name: 'Report',
            exact: true,
        })
    ).toBeDisabled();

    await expect(page.locator('.public-header')).toBeVisible();
    await expect(page.locator('.public-footer')).toHaveCount(0);
    await expect(page.getByText('Ask Footnote', { exact: true })).toHaveCount(
        0
    );
    await expect(page.getByPlaceholder('Ask a question…')).toBeVisible();
    await expect(page.locator('.public-embed__live')).toHaveCSS(
        'border-top-width',
        '0px'
    );
    await expect(page.getByPlaceholder('Ask a question…')).toHaveCSS(
        'border-radius',
        '999px'
    );
    await expect(page.getByLabel('Ask a question')).toBeVisible();
    await expect(
        page.locator('.interaction').getByText(exampleQuestion)
    ).toHaveCount(0);
    const links = page.getByRole('navigation', { name: 'Footnote links' });
    for (const [name, href] of [
        ['Open Footnote', '/'],
        ['Docs', '/wiki/'],
        ['GitHub', 'https://github.com/footnote-ai/footnote'],
    ]) {
        const link = links.getByRole('link', { name, exact: true });
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('target', '_blank');
    }

    const sectionOrder = await main.evaluate((element) =>
        [
            '.public-embed__intro',
            '.public-embed__example',
            '.public-embed__live',
            '.public-embed__links',
        ].map((selector) => {
            const section = element.querySelector<HTMLElement>(selector);
            if (!section) throw new Error('Missing embed section: ' + selector);
            return section.getBoundingClientRect().top;
        })
    );
    expect(sectionOrder[0]).toBeLessThan(sectionOrder[1]);
    expect(sectionOrder[1]).toBeLessThan(sectionOrder[2]);
    expect(sectionOrder[2]).toBeLessThan(sectionOrder[3]);

    await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: testInfo.outputPath('embed-standalone-desktop.png'),
    });
});

test('iframe resizes with disclosures and live answers on a narrow viewport', async ({
    page,
}, testInfo) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('footnote-theme-preference', 'dark');
    });
    await configureRuntime(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/chat', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(
                response(
                    Array.from(
                        { length: 8 },
                        (_, index) =>
                            `The embedded answer paragraph ${index + 1} stays available as the frame resizes.`
                    ).join('\n\n')
                )
            ),
        });
    });
    const embed = await mountSizedEmbed(page);

    await expect(
        embed.getByRole('heading', { name: 'AI that shows its work.' })
    ).toBeVisible();
    await expect(embed.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => readEmbedHeights(page)).not.toHaveLength(0);
    const initialHeight = await latestEmbedHeight(page);

    await embed.getByRole('button', { name: 'Sources', exact: true }).click();
    await expect(embed.getByRole('region', { name: 'Sources' })).toBeVisible();
    await expect
        .poll(() => latestEmbedHeight(page))
        .toBeGreaterThan(initialHeight);
    const expandedHeight = await latestEmbedHeight(page);

    await embed.getByRole('button', { name: 'Close Sources drawer' }).click();
    await expect(
        embed.getByRole('region', { name: 'Sources' })
    ).not.toBeVisible();
    await expect
        .poll(async () => (await readEmbedHeights(page)).at(-1) ?? 0)
        .toBeLessThan(expandedHeight);
    const collapsedHeight = (await readEmbedHeights(page)).at(-1) ?? 0;

    const input = embed.getByLabel('Ask a question');
    await input.fill('Can you explain that in more detail?');
    await embed.getByRole('button', { name: 'Submit question' }).click();
    await expect(
        embed.getByText('The embedded answer paragraph 8 stays available')
    ).toBeVisible();
    await expect
        .poll(async () => (await readEmbedHeights(page)).at(-1) ?? 0)
        .toBeGreaterThan(collapsedHeight);
    const answerHeight = await latestEmbedHeight(page);

    await embed.getByRole('button', { name: 'New chat' }).click();
    await expect(embed.locator('.interaction-turn')).toHaveCount(0);
    await expect
        .poll(async () => (await readEmbedHeights(page)).at(-1) ?? 0)
        .toBeLessThan(answerHeight);

    const layout = await embed.locator('body').evaluate((body) => {
        const answer = document.querySelector<HTMLElement>(
            '.public-message--assistant'
        );
        const main = document.querySelector<HTMLElement>('main#main-content');
        const home = document.querySelector<HTMLElement>('.public-home');
        if (!answer || !main || !home) {
            throw new Error('Missing complete embed content.');
        }
        return {
            bodyHeight: body.scrollHeight,
            bodyWidth: body.scrollWidth,
            clientHeight: body.clientHeight,
            clientWidth: body.clientWidth,
            mainBottom: main.getBoundingClientRect().bottom,
            answerOverflow: getComputedStyle(answer).overflowY,
            themeColor: getComputedStyle(home).backgroundColor,
        };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.bodyHeight).toBeLessThanOrEqual(layout.clientHeight + 4);
    expect(layout.mainBottom).toBeLessThanOrEqual(layout.clientHeight + 1);
    expect(layout.answerOverflow).toBe('visible');
    expect(layout.themeColor).not.toBe('rgb(255, 255, 255)');
    await expect(embed.getByLabel('Ask a question')).toBeVisible();

    const iframeHeight = await page
        .locator('#footnote-chat-frame')
        .evaluate((frame) => frame.getBoundingClientRect().height);
    const reportedHeight = (await readEmbedHeights(page)).at(-1) ?? 0;
    expect(iframeHeight).toBeGreaterThanOrEqual(reportedHeight);
    await page.locator('#footnote-chat-frame').screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('embed-iframe-mobile-dark.png'),
    });
});

test('narrow iframe remains scrollable when its parent cannot receive resize messages', async ({
    page,
}, testInfo) => {
    await configureRuntime(page);
    await page.setViewportSize({ width: 360, height: 760 });
    const embed = await mountUnmanagedEmbed(page, 620);
    const frame = page.locator('#footnote-chat-frame');

    await expect(
        embed.getByRole('heading', { name: 'AI that shows its work.' })
    ).toBeVisible();
    await expect(embed.getByLabel('Ask a question')).toBeVisible();

    const initialLayout = await embed.locator('body').evaluate((body) => ({
        referrer: document.referrer,
        viewportHeight: window.innerHeight,
        contentHeight: Math.max(
            body.scrollHeight,
            document.documentElement.scrollHeight
        ),
        overflow: getComputedStyle(document.documentElement).overflowY,
    }));
    expect(initialLayout.referrer).toBe('');
    expect(initialLayout.contentHeight).toBeGreaterThan(
        initialLayout.viewportHeight
    );
    expect(initialLayout.overflow).not.toBe('hidden');

    await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('embed-mobile-fallback-top.png'),
    });

    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();
    if (!frameBox) throw new Error('Missing iframe bounds.');
    await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + 80);
    const scrollYBefore = await embed
        .locator('body')
        .evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 520);
    await expect
        .poll(() => embed.locator('body').evaluate(() => window.scrollY))
        .toBeGreaterThan(scrollYBefore);

    const footnote = embed.getByRole('region', {
        name: 'Response provenance and controls',
    });
    const sourcesButton = footnote.getByRole('button', {
        name: 'Sources',
        exact: true,
    });
    await sourcesButton.scrollIntoViewIfNeeded();
    await sourcesButton.click();
    const sources = footnote.getByRole('region', { name: 'Sources' });
    await expect(sources).toBeVisible();
    const sourceLinks = sources.getByRole('link');
    await expect(sourceLinks.first()).toBeVisible();
    await sourceLinks.last().scrollIntoViewIfNeeded();
    const lastSourceBox = await sourceLinks.last().boundingBox();
    expect(lastSourceBox).not.toBeNull();
    if (!lastSourceBox) throw new Error('Missing final source bounds.');
    expect(lastSourceBox.y).toBeGreaterThanOrEqual(0);
    expect(lastSourceBox.y + lastSourceBox.height).toBeLessThanOrEqual(
        initialLayout.viewportHeight + 1
    );

    const liveChat = embed.locator('.public-embed__live');
    await liveChat.scrollIntoViewIfNeeded();
    const liveChatBox = await liveChat.boundingBox();
    expect(liveChatBox).not.toBeNull();
    if (!liveChatBox) throw new Error('Missing live chat bounds.');
    expect(liveChatBox.y).toBeLessThan(initialLayout.viewportHeight);
    await expect(embed.getByLabel('Ask a question')).toBeVisible();
    const chatInputBox = await embed.getByLabel('Ask a question').boundingBox();
    expect(chatInputBox).not.toBeNull();
    if (!chatInputBox) throw new Error('Missing chat input bounds.');
    expect(chatInputBox.y).toBeLessThan(initialLayout.viewportHeight);
    expect(chatInputBox.y + chatInputBox.height).toBeGreaterThan(0);

    const links = embed.getByRole('navigation', { name: 'Footnote links' });
    await links.scrollIntoViewIfNeeded();
    const githubLink = links.getByRole('link', { name: 'GitHub', exact: true });
    await expect(githubLink).toBeVisible();
    const githubBox = await githubLink.boundingBox();
    expect(githubBox).not.toBeNull();
    if (!githubBox) throw new Error('Missing bottom link bounds.');
    expect(githubBox.y).toBeGreaterThanOrEqual(0);
    expect(githubBox.y + githubBox.height).toBeLessThanOrEqual(
        initialLayout.viewportHeight + 1
    );
    const endLayout = await embed.locator('body').evaluate((body) => ({
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        bodyHeight: body.scrollHeight,
    }));
    expect(endLayout.scrollY).toBeGreaterThan(0);
    expect(endLayout.bodyHeight).toBeGreaterThan(endLayout.viewportHeight);

    await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('embed-mobile-fallback-bottom.png'),
    });
});
