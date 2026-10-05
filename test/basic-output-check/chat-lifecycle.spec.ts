/**
 * @description: Covers public chat submission, retry, reset, and input lifecycle in Chromium.
 * @footnote-scope: test
 * @footnote-module: ChatLifecycleBrowserCheck
 * @footnote-risk: low - Controlled browser routes exercise the public chat interface.
 * @footnote-ethics: medium - These checks keep request failures separate from assistant speech.
 */
import { expect, test } from '@playwright/test';
import ordinaryAnswer from './fixtures/ordinary-text-answer.json';

declare global {
    interface Window {
        __chatCaptchaCallbacks?: Array<(token: string) => void>;
    }
}

const response = (message: string) => ({
    ...ordinaryAnswer.response,
    action: 'message',
    message,
});

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

test('keeps prior turns after failure and retries the failed turn once', async ({
    page,
}) => {
    await configureRuntime(page);
    let requestCount = 0;
    const failedResponse = deferred();
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        if (requestCount === 2) {
            await failedResponse.promise;
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Service unavailable' }),
            });
            return;
        }

        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(response(`Answer ${requestCount}`)),
        });
    });

    await page.goto('/chat');
    const input = page.getByLabel('Ask a question');
    await input.fill('First question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.locator('.interaction-turn')).toHaveCount(1);
    await expect(page.locator('.public-message--assistant')).toHaveText(
        'Answer 1'
    );

    await input.fill('Second question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(input).toHaveValue('');
    await expect(page.locator('.public-message--person')).toHaveText([
        'First question',
        'Second question',
    ]);
    await expect(
        page.locator('.interaction-request-state[data-request-state="pending"]')
    ).toHaveText('Preparing a response…');
    await expect(page.locator('.public-message--assistant')).toHaveText([
        'Answer 1',
    ]);
    failedResponse.resolve();
    await expect(page.getByRole('status')).toHaveText(
        'The server could not complete this request. Please try again.'
    );
    await expect(input).toHaveValue('');
    await expect(page.locator('.interaction-turn')).toHaveCount(2);
    await expect(page.locator('.public-message--assistant')).toHaveText([
        'Answer 1',
    ]);
    await expect(
        page.getByRole('button', { name: 'Retry question' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Retry question' }).click();
    await expect(page.locator('.interaction-turn')).toHaveCount(2);
    await expect(page.locator('.public-message--person')).toHaveText([
        'First question',
        'Second question',
    ]);
    await expect(page.locator('.public-message--assistant')).toHaveText([
        'Answer 1',
        'Answer 3',
    ]);
    expect(requestCount).toBe(3);
});

test('new chat rotates its session and ignores the aborted response', async ({
    page,
}) => {
    await configureRuntime(page);
    let requestCount = 0;
    let firstSessionId = '';
    let secondSessionId = '';
    const firstResponse = deferred();
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        const body = route.request().postDataJSON() as { sessionId: string };
        if (requestCount === 1) {
            firstSessionId = body.sessionId;
            await firstResponse.promise;
            try {
                await route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify(response('Stale answer')),
                });
            } catch {
                // New chat aborts this request; its response must stay ignored.
            }
            return;
        }

        secondSessionId = body.sessionId;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(response('Fresh answer')),
        });
    });

    await page.goto('/chat');
    await page.getByLabel('Ask a question').fill('Old question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect.poll(() => requestCount).toBe(1);
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
    await page.getByLabel('Ask a question').fill('Unsaved draft');
    await page.getByRole('button', { name: 'New chat' }).click();
    await expect(page.locator('.interaction-turn')).toHaveCount(0);
    await expect(page.getByLabel('Ask a question')).toBeFocused();
    await expect(page.getByLabel('Ask a question')).toHaveValue('');
    await expect(page.locator('.interaction-status')).toHaveCount(0);

    await page.getByLabel('Ask a question').fill('Fresh question');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.getByText('Fresh answer')).toBeVisible();
    firstResponse.resolve();
    await expect(page.getByText('Stale answer')).toHaveCount(0);
    expect(firstSessionId).not.toBe('');
    expect(secondSessionId).not.toBe('');
    expect(secondSessionId).not.toBe(firstSessionId);
});

test('retry after CAPTCHA rejection uses a fresh token and the same turn', async ({
    page,
}) => {
    await page.route('**/turnstile/v0/api.js*', async (route) => {
        await route.fulfill({
            contentType: 'application/javascript',
            body: `
                window.__chatCaptchaCallbacks = [];
                window.turnstile = {
                    render(container, params) {
                        window.__chatCaptchaCallbacks.push(params.callback);
                        return String(window.__chatCaptchaCallbacks.length);
                    },
                    execute(container) {
                        window.__chatCaptchaCallbacks.at(-1)?.('XXXX.DUMMY.TOKEN');
                    },
                    getResponse() { return 'XXXX.DUMMY.TOKEN'; },
                    reset() {},
                    remove() {},
                };
                if (typeof window.onloadTurnstileCallback === 'function') {
                    window.onloadTurnstileCallback();
                }
            `,
        });
    });
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey: '1x00000000000000000000AA',
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });

    const tokens: string[] = [];
    let requestCount = 0;
    let serializedRequest = '';
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        tokens.push(route.request().headers()['x-turnstile-token'] ?? '');
        const requestBody = route.request().postData() ?? '';
        if (requestCount === 1) {
            serializedRequest = requestBody;
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'CAPTCHA verification failed' }),
            });
            return;
        }

        expect(requestBody).toBe(serializedRequest);
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(response('Retried answer')),
        });
    });

    await page.goto('/chat');
    await page.getByLabel('Ask a question').focus();
    await expect
        .poll(() =>
            page.evaluate(() => window.__chatCaptchaCallbacks?.length ?? 0)
        )
        .toBeGreaterThan(0);
    await page.evaluate(() => {
        window.__chatCaptchaCallbacks?.[0]?.('XXXX.DUMMY.TOKEN.1.XXXX');
    });
    await page.getByLabel('Ask a question').fill('Retry this exact turn');
    await page.getByRole('button', { name: 'Submit question' }).click();

    await expect(page.getByRole('status')).toHaveAttribute(
        'data-request-state',
        'captcha'
    );
    await expect(
        page.getByLabel('Complete CAPTCHA verification to submit your question')
    ).toBeVisible();
    await expect
        .poll(() =>
            page.evaluate(() => window.__chatCaptchaCallbacks?.length ?? 0)
        )
        .toBeGreaterThan(1);
    await page.evaluate(() => {
        window.__chatCaptchaCallbacks?.at(-1)?.('XXXX.DUMMY.TOKEN.2.XXXX');
    });

    await page.getByRole('button', { name: 'Retry question' }).click();
    await expect(page.getByText('Retried answer')).toBeVisible();
    await expect(page.locator('.public-message--person')).toHaveText(
        'Retry this exact turn'
    );
    expect(requestCount).toBe(2);
    expect(tokens[0]).toBe('XXXX.DUMMY.TOKEN.1.XXXX');
    expect(tokens[1]).toBe('XXXX.DUMMY.TOKEN.2.XXXX');
});

test('keeps a supported but web-incompatible action out of assistant content', async ({
    page,
}) => {
    await configureRuntime(page);
    await page.route('**/api/chat', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                action: 'react',
                reaction: '👋',
                metadata: null,
            }),
        });
    });

    await page.goto('/chat');
    await page.getByLabel('Ask a question').fill('Please use a reaction');
    await page.getByRole('button', { name: 'Submit question' }).click();
    await expect(page.getByRole('status')).toHaveAttribute(
        'data-request-state',
        'unsupported'
    );
    await expect(page.locator('.public-message--assistant')).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Retry question' })
    ).toBeVisible();
});

test('keeps Enter available for multiline and ignores composing modified Enter', async ({
    page,
}) => {
    await configureRuntime(page);
    let requestCount = 0;
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(response('Answer')),
        });
    });

    await page.goto('/chat');
    const input = page.getByLabel('Ask a question');
    await input.fill('First line');
    await input.press('Enter');
    await expect(input).toHaveValue('First line\n');
    await input.dispatchEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        isComposing: true,
        keyCode: 229,
    });
    await expect.poll(() => requestCount).toBe(0);
    await input.press('Control+Enter');
    await expect(page.getByText('Answer', { exact: true })).toBeVisible();
    expect(requestCount).toBe(1);
});
