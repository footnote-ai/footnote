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
        page.getByRole('region', {
            name: 'Response provenance and controls',
        })
    ).toContainText('Classification: Retrieved');
    const footnote = page.getByRole('region', {
        name: 'Response provenance and controls',
    });
    await footnote
        .getByRole('button', { name: 'Sources', exact: true })
        .click();
    const sourcesDrawer = footnote.getByRole('region', { name: 'Sources' });
    await expect(sourcesDrawer).toBeVisible();
    await expect(
        sourcesDrawer.getByRole('link', { name: 'Provenance overview' })
    ).toHaveAttribute('href', outputCase.response.metadata.citations[0].url);
    const drawerGeometry = await page.evaluate(() => {
        const footnote = document.querySelector('.canonical-response-footnote');
        const drawer = document.querySelector(
            '.canonical-response-footnote__drawer'
        );
        if (!footnote || !drawer) {
            throw new Error('Missing footnote drawer geometry');
        }
        const footnoteRect = footnote.getBoundingClientRect();
        const drawerRect = drawer.getBoundingClientRect();
        return {
            footnoteLeft: footnoteRect.left,
            footnoteRight: footnoteRect.right,
            drawerLeft: drawerRect.left,
            drawerRight: drawerRect.right,
        };
    });
    expect(
        drawerGeometry.drawerLeft - drawerGeometry.footnoteLeft
    ).toBeLessThanOrEqual(2);
    expect(
        drawerGeometry.footnoteRight - drawerGeometry.drawerRight
    ).toBeLessThanOrEqual(2);
    await footnote
        .getByRole('button', { name: 'Close Sources drawer' })
        .click();
    await expect(sourcesDrawer).toBeHidden();
    await footnote.getByRole('button', { name: 'Trace', exact: true }).click();
    const traceDrawer = footnote.getByRole('region', { name: 'Trace' });
    await expect(traceDrawer).toBeVisible();
    await expect(traceDrawer).toContainText(
        'Trace availability is not confirmed by the chat response.'
    );
    await expect(
        traceDrawer.getByRole('link', { name: 'Open full Trace' })
    ).toHaveCount(0);
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

    await expect(page.locator('h1#homepage-title')).toHaveText(
        'AI that shows its work.'
    );
    const heroLines = page.locator('.public-home__hero-title-line');
    await expect(heroLines).toHaveCount(2);
    await expect(heroLines.nth(0)).toHaveText('AI that');
    await expect(heroLines.nth(1)).toHaveText('shows its work.');
    await expect(heroLines.nth(1).locator('em')).toHaveCSS(
        'font-style',
        'italic'
    );
    await expect(
        page.getByText(
            'See how an answer was made, set your own rules, and run Footnote your way.'
        )
    ).toBeVisible();
    await expect(page.locator('.public-home__handoff-label')).toHaveCount(0);
    await expect(
        page.locator('.canonical-response-footnote').first()
    ).toBeVisible();
    await expect(page.locator('.public-home__concept-wrap')).toHaveCount(4);
    await expect(page.locator('.public-home__concept-wrap a')).toHaveCount(4);
    await expect(
        page.getByRole('link', { name: 'Ask a question' }).first()
    ).toHaveAttribute('href', '/chat');
    await expect(
        page.getByRole('heading', { name: 'Run Footnote' })
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: /Switch to (dark|light) mode/ })
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'Setup guide' })
    ).toHaveAttribute('href', '/wiki/getting-started/');
    await expect(page.locator('.public-home__context-notice')).toBeHidden();
    await expect(
        page.locator('.response-carousel__navigation--inline')
    ).toBeVisible();
    await expect(page.locator('.public-home__scenario-dot')).toHaveCount(3);
    await expect(
        page.locator(
            '.public-home .canonical-response-footnote__action button .canonical-response-footnote__action-status'
        )
    ).toHaveCount(0);
    const composition = await page.evaluate(() => {
        const getRect = (selector: string): DOMRect => {
            const element = document.querySelector(selector);
            if (!element) {
                throw new Error(`Missing geometry target: ${selector}`);
            }
            return element.getBoundingClientRect();
        };
        const shell = getRect('.public-home__chat-shell');
        const person = getRect('.public-message--person');
        const assistant = getRect('.public-message--assistant');
        const trace = getRect('.canonical-response-footnote__trace');
        const wheel = getRect('.canonical-response-footnote__wheel');
        const axisList = getRect('.canonical-response-footnote__axis-list');
        const dots = getRect(
            '.public-home__response .response-carousel__navigation--inline'
        );
        const footnote = getRect('.public-home .canonical-response-footnote');
        return {
            personTop: person.top,
            personBottom: person.bottom,
            shellCenter: shell.left + shell.width / 2,
            assistantTop: assistant.top,
            assistantBottom: assistant.bottom,
            dotsCenter: dots.left + dots.width / 2,
            dotsTop: dots.top,
            dotsBottom: dots.bottom,
            footnoteTop: footnote.top,
            footnoteBottom: footnote.bottom,
            footnoteHeight: footnote.height,
            traceWheelTopOffset: wheel.top - trace.top,
            traceWheelBottomOffset: trace.bottom - wheel.bottom,
            traceAxisListTopOffset: axisList.top - trace.top,
            traceAxisListBottomOffset: trace.bottom - axisList.bottom,
            traceAxisListGap: Number.parseFloat(
                getComputedStyle(
                    document.querySelector(
                        '.canonical-response-footnote__axis-list'
                    )!
                ).rowGap
            ),
            shellTop: shell.top,
        };
    });
    expect(composition.personTop - composition.shellTop).toBeGreaterThanOrEqual(
        18
    );
    expect(
        composition.dotsTop - composition.personBottom
    ).toBeGreaterThanOrEqual(16);
    expect(composition.dotsCenter).toBeCloseTo(composition.shellCenter, 0);
    expect(
        composition.assistantTop - composition.dotsBottom
    ).toBeGreaterThanOrEqual(16);
    expect(
        composition.footnoteTop - composition.assistantBottom
    ).toBeGreaterThanOrEqual(16);
    expect(composition.footnoteHeight).toBeGreaterThanOrEqual(240);
    expect(composition.footnoteHeight).toBeLessThan(280);
    expect(composition.traceAxisListGap).toBeLessThan(5);
    expect(
        Math.abs(
            composition.traceWheelTopOffset - composition.traceAxisListTopOffset
        )
    ).toBeLessThan(2);
    expect(
        Math.abs(
            composition.traceWheelBottomOffset -
                composition.traceAxisListBottomOffset
        )
    ).toBeLessThan(2);
    await expect(
        page.locator('.canonical-response-footnote__axis-description')
    ).toHaveText([
        'Space efficiency',
        'Reasoning level',
        'Connects to sources',
        'Care attention',
        'Breadth and coverage',
    ]);
    const summaryAlignment = await page.evaluate(() =>
        Array.from(
            document.querySelectorAll(
                '.public-home .canonical-response-footnote__summary-item'
            )
        ).map((item) => getComputedStyle(item).justifyContent)
    );
    expect(summaryAlignment).toEqual(['center', 'center', 'center']);
    const carouselOwnership = await page.evaluate(() => {
        const dots = document.querySelector('.public-home__scenario-dots');
        const assistant = document.querySelector('.public-message--assistant');
        const footnote = document.querySelector(
            '.public-home .canonical-response-footnote'
        );
        if (!dots || !assistant || !footnote) {
            throw new Error('Missing carousel ownership targets.');
        }
        return {
            dotsBeforeAssistant: Boolean(
                dots.compareDocumentPosition(assistant) &
                Node.DOCUMENT_POSITION_FOLLOWING
            ),
            dotsBeforeFootnote: Boolean(
                dots.compareDocumentPosition(footnote) &
                Node.DOCUMENT_POSITION_FOLLOWING
            ),
            dotsInsideResponse: Boolean(dots.closest('.public-home__response')),
        };
    });
    expect(carouselOwnership.dotsBeforeAssistant).toBe(true);
    expect(carouselOwnership.dotsBeforeFootnote).toBe(true);
    expect(carouselOwnership.dotsInsideResponse).toBe(true);

    const trace = page.locator('.canonical-response-footnote__trace').first();
    await expect(trace).not.toHaveAttribute('data-active-axis');
    await expect(
        trace.locator(
            '.canonical-response-footnote__axis-row[data-axis-key="tightness"]'
        )
    ).not.toHaveClass(/canonical-response-footnote__axis-row--active/);
    await expect(
        trace.locator(
            '.canonical-response-footnote__wheel-hit-area[data-axis-key="tightness"]'
        )
    ).not.toHaveClass(/canonical-response-footnote__wheel-hit-area--active/);
    const rationaleRow = trace.locator(
        '.canonical-response-footnote__axis-row[data-axis-key="rationale"]'
    );
    await rationaleRow.hover();
    await expect(trace).toHaveAttribute('data-active-axis', 'rationale');
    await expect(rationaleRow).toHaveClass(
        /canonical-response-footnote__axis-row--active/
    );
    await expect(
        trace.locator(
            '.canonical-response-footnote__connector[data-active-axis="rationale"]'
        )
    ).toBeVisible();

    const attributionRow = trace.locator(
        '.canonical-response-footnote__axis-row[data-axis-key="attribution"]'
    );
    await attributionRow.focus();
    await expect(trace).toHaveAttribute('data-active-axis', 'attribution');
    const rationaleWedge = trace.locator(
        '.canonical-response-footnote__wheel-hit-area[data-axis-key="rationale"]'
    );
    await rationaleWedge.focus();
    await expect(trace).toHaveAttribute('data-active-axis', 'rationale');

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
        await expect(
            mobilePage.locator('.public-home__concept-wrap')
        ).toHaveCount(4);
        await expect(
            mobilePage.locator('.public-home__concept-wrap a')
        ).toHaveCount(4);
        await expect
            .poll(() =>
                mobilePage.evaluate(() => document.documentElement.scrollWidth)
            )
            .toBeLessThanOrEqual(390);
    } finally {
        await context.close();
    }
});

test('public homepage keeps concept links visible at narrow desktop width', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('.public-home__concept-wrap')).toHaveCount(4);
    await expect(page.locator('.public-home__concept-wrap a')).toHaveCount(4);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(390);
});

test('public homepage keeps the canonical footnote inside the shell at 320px', async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/');

    const geometry = await page.evaluate(() => {
        const shell = document.querySelector('.public-home__chat-shell');
        const footnote = document.querySelector(
            '.public-home .canonical-response-footnote'
        );
        if (!shell || !footnote) {
            throw new Error(
                'Homepage chat shell or footnote was not rendered.'
            );
        }
        const shellRect = shell.getBoundingClientRect();
        const footnoteRect = footnote.getBoundingClientRect();
        return {
            shellLeft: shellRect.left,
            shellRight: shellRect.right,
            footnoteLeft: footnoteRect.left,
            footnoteRight: footnoteRect.right,
            footnoteScrollWidth: footnote.scrollWidth,
            footnoteClientWidth: footnote.clientWidth,
        };
    });

    expect(geometry.footnoteLeft).toBeGreaterThanOrEqual(geometry.shellLeft);
    expect(geometry.footnoteRight).toBeLessThanOrEqual(geometry.shellRight);
    expect(geometry.footnoteScrollWidth).toBeLessThanOrEqual(
        geometry.footnoteClientWidth
    );
});

test('public homepage preserves response and concept composition across widths', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 1536 });
    await page.goto('/');

    const desktopGeometry = await page.evaluate(() => {
        const getRect = (selector: string): DOMRect => {
            const element = document.querySelector(selector);
            if (!element) {
                throw new Error(`Missing geometry target: ${selector}`);
            }
            return element.getBoundingClientRect();
        };
        const shell = getRect('.public-home__chat-shell');
        const footnote = getRect('.public-home .canonical-response-footnote');
        const assistant = getRect('.public-message--assistant');
        const handoff = getRect('.public-home__chat-handoff');
        const shellElement = document.querySelector('.public-home__chat-shell');
        if (!shellElement) {
            throw new Error('Missing chat shell for computed padding.');
        }
        const shellStyle = getComputedStyle(shellElement);
        const shellPadding =
            parseFloat(shellStyle.paddingLeft) +
            parseFloat(shellStyle.paddingRight) +
            parseFloat(shellStyle.borderLeftWidth) +
            parseFloat(shellStyle.borderRightWidth);
        const concepts = [
            ...document.querySelectorAll<HTMLElement>(
                '.public-home__concept-wrap:not(.public-home__concept-wrap--open-about-our-choices)'
            ),
        ].map((element) => element.getBoundingClientRect());
        const conceptMetrics = [
            ...document.querySelectorAll<HTMLElement>(
                '.public-home__concept-wrap:not(.public-home__concept-wrap--open-about-our-choices) .public-home__concept'
            ),
        ].map((element) => {
            const art = element.querySelector<HTMLElement>(
                '.public-home__concept-art'
            );
            const artSvg = element.querySelector<SVGElement>(
                '.public-home__concept-art svg'
            );
            const heading = element.querySelector<HTMLElement>('h3');
            const paragraph = element.querySelector<HTMLElement>('p');
            if (!art || !artSvg || !heading || !paragraph) {
                throw new Error('Missing concept alignment targets.');
            }
            const cardStyle = getComputedStyle(element);
            const artRect = art.getBoundingClientRect();
            const headingRect = heading.getBoundingClientRect();
            const paragraphRect = paragraph.getBoundingClientRect();
            return {
                artHeight: artRect.height,
                artVisualHeight: artSvg.getBoundingClientRect().height,
                paddingTop: parseFloat(cardStyle.paddingTop),
                paddingBottom: parseFloat(cardStyle.paddingBottom),
                headingTop: headingRect.top,
                paragraphTop: paragraphRect.top,
            };
        });
        const footnoteStyle = getComputedStyle(
            document.querySelector('.canonical-response-footnote') as Element
        );
        const connector = document.querySelector(
            '.canonical-response-footnote__connector'
        );
        return {
            shellInnerWidth: shell.width - shellPadding,
            footnoteWidth: footnote.width,
            footnoteHeight: footnote.height,
            assistantWidth: assistant.width,
            handoffWidth: handoff.width,
            summaryHeight: getRect('.canonical-response-footnote__summary')
                .height,
            traceHeight: getRect('.canonical-response-footnote__trace').height,
            actionsHeight: getRect('.canonical-response-footnote__disclosures')
                .height,
            conceptWidths: concepts.map((rect) => rect.width),
            conceptHeights: concepts.map((rect) => rect.height),
            conceptMetrics,
            footnoteContainerType: footnoteStyle.containerType,
            connectorDisplay: connector
                ? getComputedStyle(connector).display
                : 'none',
        };
    });

    expect(desktopGeometry.footnoteWidth).toBeGreaterThan(
        desktopGeometry.shellInnerWidth * 0.9
    );
    expect(desktopGeometry.handoffWidth).toBeGreaterThan(
        desktopGeometry.shellInnerWidth * 0.9
    );
    expect(desktopGeometry.footnoteWidth).toBeGreaterThan(
        desktopGeometry.assistantWidth
    );
    expect(desktopGeometry.footnoteHeight).toBeLessThan(320);
    expect(desktopGeometry.summaryHeight).toBeLessThan(55);
    expect(desktopGeometry.traceHeight).toBeLessThan(205);
    expect(desktopGeometry.actionsHeight).toBeLessThan(65);
    expect(desktopGeometry.footnoteContainerType).toContain('inline-size');
    expect(desktopGeometry.connectorDisplay).toBe('none');
    expect(desktopGeometry.conceptWidths[0]).toBeGreaterThan(
        desktopGeometry.conceptWidths[1] * 1.6
    );
    expect(desktopGeometry.conceptWidths[1]).toBeGreaterThan(
        desktopGeometry.conceptWidths[2] * 0.8
    );
    expect(desktopGeometry.conceptWidths[1]).toBeLessThan(
        desktopGeometry.conceptWidths[2] * 1.2
    );
    const [firstConcept, ...otherConcepts] = desktopGeometry.conceptMetrics;
    for (const concept of otherConcepts) {
        expect(concept.artHeight).toBeCloseTo(firstConcept.artHeight, 0);
        expect(concept.artVisualHeight).toBeCloseTo(
            firstConcept.artVisualHeight,
            0
        );
        expect(concept.paddingTop).toBeCloseTo(firstConcept.paddingTop, 0);
        expect(concept.paddingBottom).toBeCloseTo(
            firstConcept.paddingBottom,
            0
        );
        expect(concept.headingTop).toBeCloseTo(firstConcept.headingTop, 0);
        expect(concept.paragraphTop).toBeCloseTo(firstConcept.paragraphTop, 0);
    }
    for (const height of desktopGeometry.conceptHeights) {
        expect(height).toBeGreaterThan(220);
        expect(height).toBeLessThan(290);
    }
    expect(
        Math.max(...desktopGeometry.conceptHeights) -
            Math.min(...desktopGeometry.conceptHeights)
    ).toBeLessThanOrEqual(0.5);

    await page.screenshot({
        animations: 'disabled',
        fullPage: true,
        path: testInfo.outputPath('homepage-1024x1536.png'),
    });
    await page.locator('.canonical-response-footnote').screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('canonical-footnote-homepage-1024.png'),
    });

    for (const viewport of [
        { width: 768, height: 1100, name: 'homepage-768' },
        { width: 706, height: 1000, name: 'homepage-706' },
        { width: 390, height: 844, name: 'homepage-390' },
        { width: 320, height: 900, name: 'homepage-320' },
    ]) {
        await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
        });
        await page.goto('/');
        await expect(
            page.locator('.canonical-response-footnote')
        ).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(() => document.documentElement.scrollWidth)
            )
            .toBeLessThanOrEqual(viewport.width);

        if (viewport.width <= 768) {
            await expect(
                page.locator('.canonical-response-footnote__connector')
            ).toBeHidden();
        }

        if (viewport.width <= 390) {
            const mobileConceptHeights = await page.evaluate(() =>
                [
                    ...document.querySelectorAll<HTMLElement>(
                        '.public-home__concept-wrap'
                    ),
                ].map((element) => element.getBoundingClientRect().height)
            );
            for (const height of mobileConceptHeights) {
                expect(height).toBeLessThan(300);
            }
        }

        await page.screenshot({
            animations: 'disabled',
            fullPage: true,
            path: testInfo.outputPath(`${viewport.name}.png`),
        });
        if (viewport.width === 390) {
            const actionRows = await page.evaluate(() =>
                [
                    ...document.querySelectorAll<HTMLElement>(
                        '.canonical-response-footnote__disclosure-actions > .canonical-response-footnote__action'
                    ),
                ].map((element) => element.getBoundingClientRect())
            );
            expect(actionRows).toHaveLength(4);
            expect(
                Math.abs(actionRows[0].top - actionRows[1].top)
            ).toBeLessThanOrEqual(0.5);
            expect(
                Math.abs(actionRows[2].top - actionRows[3].top)
            ).toBeLessThanOrEqual(0.5);
            expect(actionRows[2].top).toBeGreaterThan(actionRows[0].top);

            await page.locator('.canonical-response-footnote').screenshot({
                animations: 'disabled',
                path: testInfo.outputPath('canonical-footnote-390.png'),
            });
        }
    }
});

test('canonical summary remains readable at the desktop-medium boundary', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1024, height: 1536 });
    await page.goto('/');

    const summaryGeometry = await page.evaluate(() => {
        const footnote = document.querySelector<HTMLElement>(
            '.canonical-response-footnote'
        );
        if (!footnote) {
            throw new Error('Missing canonical footnote.');
        }
        footnote.style.width = '780px';

        const summaryItems = [
            ...footnote.querySelectorAll<HTMLElement>(
                '.canonical-response-footnote__summary > *'
            ),
        ];
        const safety = summaryItems[1];
        const licensing = summaryItems[2];
        if (!safety || !licensing) {
            throw new Error('Missing canonical summary cells.');
        }

        const safetyContent = [
            ...safety.querySelectorAll<HTMLElement>('span, strong'),
        ];
        return {
            safetyRight: Math.max(
                ...safetyContent.map(
                    (element) => element.getBoundingClientRect().right
                )
            ),
            licensingLeft: licensing.getBoundingClientRect().left,
        };
    });

    expect(summaryGeometry.safetyRight).toBeLessThanOrEqual(
        summaryGeometry.licensingLeft
    );
});
