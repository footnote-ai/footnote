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
    readEmbedHeights,
} from './chat-test-helpers';

const exampleQuestion =
    'Why does ice float in water? Please explain it simply in about 70 words.';

test('standalone embed presents the recorded answer, full footer, and project links', async ({
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

    await expect(page.getByText('Footnote', { exact: true })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'AI that shows its work.' })
    ).toBeVisible();
    await expect(
        page.getByText("You shouldn't have to take its word for it.", {
            exact: true,
        })
    ).toBeVisible();
    await expect(example.getByText('Recorded example')).toBeVisible();
    await expect(
        example.getByText(exampleQuestion, { exact: true })
    ).toBeVisible();
    await expect(example.locator('.public-message--assistant')).toContainText(
        'Ice floats because it is less dense than liquid water.'
    );
    await expect(footnote).toHaveAttribute('data-response-id', 'JUC6855x');
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
            name: 'Why Does Ice Float? | Ice and the Density of Water',
        })
    ).toHaveAttribute(
        'href',
        'https://www.thoughtco.com/why-does-ice-float-604304'
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
            name: /Trace Unavailable for this response/,
        })
    ).toBeDisabled();
    await expect(
        footnote.getByRole('button', {
            name: /Report Reporting is not available/,
        })
    ).toBeDisabled();

    await expect(page.locator('.public-header, .public-footer')).toHaveCount(0);
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

test('iframe embed honors dark theme and grows with its mobile disclosure content', async ({
    page,
}, testInfo) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('footnote-theme-preference', 'dark');
    });
    await configureRuntime(page);
    await page.setViewportSize({ width: 390, height: 844 });
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
