/**
 * @description: Exercises settled multi-turn chat behavior across the public routes.
 * @footnote-scope: test
 * @footnote-module: ChatIntegratedBrowserCheck
 * @footnote-risk: low - Browser routes return deterministic backend-shaped fixtures.
 * @footnote-ethics: medium - It protects truthful per-turn provenance and failure states.
 */
import { expect, test } from '@playwright/test';
import type { PostChatRequest } from '@footnote/contracts/web';
import {
    configureRuntime,
    deferred,
    expectTurnSource,
    latestEmbedHeight,
    mountSizedEmbed,
    readEmbedHeights,
    responseWithCitation,
} from './chat-test-helpers';

test('keeps request assembly, retries, provenance, and reset coherent on /chat', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await configureRuntime(page);

    const firstResponse = deferred();
    const requests: PostChatRequest[] = [];
    let requestCount = 0;
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        requests.push(route.request().postDataJSON() as PostChatRequest);
        if (requestCount === 1) {
            await firstResponse.promise;
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(
                    responseWithCitation(
                        'First answer with **bounded context**.',
                        'integrated-response-1',
                        'Integrated source 1',
                        'https://example.org/integrated-1',
                        'Evidence for integrated turn 1.'
                    )
                ),
            });
            return;
        }
        if (requestCount === 2) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Service unavailable' }),
            });
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(
                responseWithCitation(
                    'Second answer with **source-local evidence**.',
                    `integrated-response-${requestCount - 1}`,
                    `Integrated source ${requestCount - 1}`,
                    `https://example.org/integrated-${requestCount - 1}`,
                    `Evidence for integrated turn ${requestCount - 1}.`
                )
            ),
        });
    });

    await page.goto('/chat');
    const input = page.getByLabel('Ask a question');
    await input.fill('First question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.locator('.public-message--person')).toHaveText(
        'First question'
    );
    await expect(
        page.locator('.interaction-request-state[data-request-state="pending"]')
    ).toBeVisible();
    await expect(page.locator('.public-message--assistant')).toHaveCount(0);
    await expect(input).toHaveValue('');
    firstResponse.resolve();

    await expect(
        page.getByText('First answer with bounded context.')
    ).toBeVisible();
    await expect(page.locator('.interaction-turn')).toHaveCount(1);
    const firstSessionId = requests[0]?.sessionId;
    expect(requests[0]).toEqual({
        surface: 'web',
        trigger: { kind: 'submit' },
        latestUserInput: 'First question',
        conversation: [{ role: 'user', content: 'First question' }],
        sessionId: expect.any(String),
        capabilities: {
            canReact: false,
            canGenerateImages: false,
            canUseTts: false,
        },
        surfaceContext: { requestHost: 'output-check.localhost:4173' },
    });

    await input.fill('Second question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.getByRole('status')).toHaveAttribute(
        'data-request-state',
        'backend'
    );
    await expect(page.locator('.interaction-turn')).toHaveCount(2);
    await expect(page.locator('.public-message--assistant')).toHaveText([
        'First answer with bounded context.',
    ]);
    expect(requests[1]).toMatchObject({
        latestUserInput: 'Second question',
        conversation: [
            { role: 'user', content: 'First question' },
            {
                role: 'assistant',
                content: 'First answer with **bounded context**.',
            },
            { role: 'user', content: 'Second question' },
        ],
        sessionId: firstSessionId,
    });

    await input.fill('Draft to keep');
    await page.getByRole('button', { name: 'Retry question' }).click();
    await expect(
        page.getByText('Second answer with source-local evidence.')
    ).toBeVisible();
    await expect(input).toHaveValue('Draft to keep');
    await expect(page.locator('.interaction-turn')).toHaveCount(2);
    expect(requests[2]).toEqual(requests[1]);
    await expect(page.locator('.public-message--person')).toHaveText([
        'First question',
        'Second question',
    ]);

    const firstTurn = page.locator('.interaction-turn').nth(0);
    const secondTurn = page.locator('.interaction-turn').nth(1);
    await expectTurnSource(
        firstTurn,
        'integrated-response-1',
        'Integrated source 1',
        'https://example.org/integrated-1',
        'Integrated source 2'
    );
    const secondFootnote = await expectTurnSource(
        secondTurn,
        'integrated-response-2',
        'Integrated source 2',
        'https://example.org/integrated-2',
        'Integrated source 1'
    );
    await secondFootnote
        .getByRole('button', { name: 'Trace', exact: true })
        .click();
    await expect(
        secondFootnote.getByRole('link', { name: 'Open full Trace' })
    ).toHaveAttribute('href', '/traces/integrated-response-2');

    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.locator('.interaction-turn')).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await input.fill('A question in the new chat');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(
        page.getByText('Second answer with source-local evidence.')
    ).toBeVisible();
    expect(requests[3]).toMatchObject({
        latestUserInput: 'A question in the new chat',
        conversation: [{ role: 'user', content: 'A question in the new chat' }],
    });
    expect(requests[3]?.sessionId).not.toBe(firstSessionId);
    const width = await page.locator('body').evaluate((body) => ({
        body: body.scrollWidth,
        viewport: window.innerWidth,
    }));
    expect(width.body).toBeLessThanOrEqual(width.viewport);
});

test('settles embed height after a successful turn, provenance, and failure', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await configureRuntime(page);
    let requestCount = 0;
    const responsePending = deferred();
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        if (requestCount === 1) {
            await responsePending.promise;
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(
                    responseWithCitation(
                        Array.from(
                            { length: 8 },
                            (_, index) =>
                                `Embedded paragraph ${index + 1} remains visible with its response.`
                        ).join('\n\n'),
                        'integrated-response-1',
                        'Integrated source 1',
                        'https://example.org/integrated-1',
                        'Evidence for integrated turn 1.'
                    )
                ),
            });
            return;
        }
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Service unavailable' }),
        });
    });

    const embed = await mountSizedEmbed(page);
    await expect(embed.getByLabel('Ask a question')).toBeVisible();
    await expect.poll(() => readEmbedHeights(page)).not.toHaveLength(0);
    const input = embed.getByLabel('Ask a question');
    await input.fill('Explain this embedded flow.');
    await embed.getByRole('button', { name: 'Submit question' }).click();
    await expect(embed.getByText('Preparing a response…')).toBeVisible();
    const pendingHeight = Math.max(...(await readEmbedHeights(page)));
    responsePending.resolve();
    await expect(embed.getByText('Embedded paragraph 8')).toBeVisible();
    await expect
        .poll(async () => Math.max(...(await readEmbedHeights(page))))
        .toBeGreaterThan(pendingHeight);

    const firstFootnote = embed.locator('.canonical-response-footnote');
    await firstFootnote
        .getByRole('button', { name: 'Sources', exact: true })
        .click();
    await expect(
        firstFootnote.getByRole('region', { name: 'Sources' })
    ).toBeVisible();
    const provenanceHeight = Math.max(...(await readEmbedHeights(page)));
    const sourceDrawerBottom = await firstFootnote
        .getByRole('region', { name: 'Sources' })
        .evaluate((drawer) => drawer.getBoundingClientRect().bottom);
    const childViewportHeight = await embed
        .locator('body')
        .evaluate(() => window.innerHeight);
    expect(sourceDrawerBottom).toBeLessThanOrEqual(childViewportHeight + 1);
    await input.fill('A follow-up that fails');
    await embed.getByRole('button', { name: 'Submit question' }).click();
    await expect(embed.getByRole('status')).toHaveAttribute(
        'data-request-state',
        'backend'
    );
    await expect(embed.locator('.interaction-turn')).toHaveCount(2);
    await expect(embed.locator('.public-message--assistant')).toHaveText([
        /Embedded paragraph 1/,
    ]);
    await expect
        .poll(async () => Math.max(...(await readEmbedHeights(page))))
        .toBeGreaterThan(provenanceHeight);
    const failureBottom = await embed
        .locator('.interaction-status')
        .evaluate((status) => status.getBoundingClientRect().bottom);
    const childLayout = await embed.locator('body').evaluate((body) => ({
        bodyWidth: body.scrollWidth,
        viewportWidth: window.innerWidth,
        nestedFrames: document.querySelectorAll('iframe').length,
        scrollY: window.scrollY,
    }));
    const embedReport = await latestEmbedHeight(page);
    const iframeHeight = await page
        .locator('#footnote-chat-frame')
        .evaluate((frame) => frame.getBoundingClientRect().height);
    expect(childLayout.bodyWidth).toBeLessThanOrEqual(
        childLayout.viewportWidth
    );
    expect(childLayout.scrollY).toBe(0);
    expect(failureBottom).toBeLessThanOrEqual(childViewportHeight + 1);
    expect(iframeHeight).toBeGreaterThanOrEqual(embedReport);
    expect(childLayout.nestedFrames).toBe(0);
});
