/**
 * @description: Exercises rendered chat request cancellation, timeout cleanup, and CAPTCHA error persistence in Chromium.
 * @footnote-scope: test
 * @footnote-module: ChatRequestStatusBrowserCheck
 * @footnote-risk: low - Browser routes and deterministic timing isolate the web UI from live services.
 * @footnote-ethics: medium - Coverage protects truthful request status and preserves user-visible security errors.
 */
import { expect, test, type Page } from '@playwright/test';
import ordinaryAnswer from './fixtures/ordinary-text-answer.json';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const CHAT_RESPONSE = {
    ...ordinaryAnswer.response,
    action: 'message',
    message: 'The newer answer wins.',
};

const configureRuntime = async (
    page: Page,
    turnstileSiteKey = ''
): Promise<void> => {
    await page.route('**/config.json', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                turnstileSiteKey,
                setup: { required: false, routePath: '/setup' },
            }),
        });
    });
};

const submitQuestion = async (page: Page, question: string): Promise<void> => {
    await page.getByLabel('Ask a question').fill(question);
    await page.locator('form').evaluate((form) => form.requestSubmit());
};

const installTurnstileStub = async (page: Page): Promise<void> => {
    await page.route('**/turnstile/v0/api.js*', async (route) => {
        await route.fulfill({
            contentType: 'application/javascript',
            body: `
                window.__footnoteTurnstileCallbacks = [];
                window.__footnoteTurnstileResponses = new Map();
                window.turnstile = {
                    render(container, params) {
                        window.__footnoteTurnstileCallbacks.push(params.callback);
                        window.__footnoteTurnstileResponses.set(container, 'XXXX.DUMMY.TOKEN.XXXX');
                        return String(window.__footnoteTurnstileCallbacks.length);
                    },
                    execute(container) {
                        const response = window.__footnoteTurnstileResponses.get(container);
                        const callback = window.__footnoteTurnstileCallbacks.at(-1);
                        if (response && callback) callback(response);
                    },
                    getResponse(container) {
                        return window.__footnoteTurnstileResponses.get(container) || '';
                    },
                    reset() {},
                    remove() {},
                };
                if (typeof window.onloadTurnstileCallback === 'function') {
                    window.onloadTurnstileCallback();
                }
            `,
        });
    });
};

test('reports an actual timeout and clears the timed-out request loading state', async ({
    page,
}) => {
    await page.clock.install();
    await configureRuntime(page);
    const pendingResponse = deferred<void>();
    await page.route('**/api/chat', async (route) => {
        await pendingResponse.promise;
        try {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(CHAT_RESPONSE),
            });
        } catch {
            // The browser has already aborted this controlled response.
        }
    });

    await page.goto('/chat');
    await submitQuestion(page, 'Will this time out?');
    await expect(
        page.getByRole('button', { name: 'Submitting question' })
    ).toBeDisabled();

    await page.clock.runFor(60_000);

    await expect(
        page.getByRole('button', { name: 'Submit question' })
    ).toBeEnabled();
    await expect(page.getByRole('status')).toHaveText(
        'The request timed out. Please try again.'
    );

    pendingResponse.resolve(undefined);
});

test('a superseded request cannot clear newer loading state or replace its answer', async ({
    page,
}) => {
    await configureRuntime(page);
    const firstResponse = deferred<void>();
    const secondResponse = deferred<void>();
    let requestCount = 0;
    await page.route('**/api/chat', async (route) => {
        requestCount += 1;
        if (requestCount === 1) {
            await firstResponse.promise;
            try {
                await route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify({
                        ...CHAT_RESPONSE,
                        message: 'The stale answer must not be shown.',
                    }),
                });
            } catch {
                // The first request is intentionally superseded.
            }
            return;
        }

        await secondResponse.promise;
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(CHAT_RESPONSE),
        });
    });

    await page.goto('/chat');
    await submitQuestion(page, 'The first question');
    await expect.poll(() => requestCount).toBe(1);

    await page.getByLabel('Ask a question').fill('The newer question');
    const secondRequest = page.waitForRequest('**/api/chat');
    await page.locator('form').evaluate((form) => form.requestSubmit());
    await secondRequest;

    await expect(
        page.getByRole('button', { name: 'Submitting question' })
    ).toBeDisabled();

    secondResponse.resolve(undefined);
    await expect(page.getByText(CHAT_RESPONSE.message)).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Submit question' })
    ).toBeEnabled();

    firstResponse.resolve(undefined);
    await expect(
        page.getByText('The stale answer must not be shown.')
    ).toHaveCount(0);
});

test('CAPTCHA verification preserves an existing API error message', async ({
    page,
}) => {
    await installTurnstileStub(page);
    await configureRuntime(page, '1x00000000000000000000AA');
    await page.route('**/api/chat', async (route) => {
        await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
                error: 'CAPTCHA verification failed',
                details: 'controlled test rejection',
            }),
        });
    });

    await page.goto('/chat');
    const questionInput = page.getByLabel('Ask a question');
    await questionInput.focus();
    await expect
        .poll(() =>
            page.evaluate(
                () => window.__footnoteTurnstileCallbacks?.length ?? 0
            )
        )
        .toBeGreaterThan(0);
    const initialCallbackCount = await page.evaluate(
        () => window.__footnoteTurnstileCallbacks?.length ?? 0
    );
    await page.evaluate(() => {
        const callback = window.__footnoteTurnstileCallbacks?.[0];
        callback?.('XXXX.DUMMY.TOKEN.XXXX');
    });
    await submitQuestion(page, 'Please reject this request');

    const expectedError =
        'CAPTCHA verification failed: controlled test rejection. Please refresh and try again.';
    await expect(page.getByRole('status')).toHaveText(expectedError);
    await expect(
        page.getByLabel('Complete CAPTCHA verification to submit your question')
    ).toBeVisible();

    await expect
        .poll(() =>
            page.evaluate(
                () => window.__footnoteTurnstileCallbacks?.length ?? 0
            )
        )
        .toBeGreaterThan(initialCallbackCount);
    await page.evaluate(() => {
        const callback = window.__footnoteTurnstileCallbacks?.at(-1);
        callback?.('XXXX.DUMMY.TOKEN.XXXX');
    });

    await expect(page.getByRole('status')).toHaveText(expectedError);
});

declare global {
    interface Window {
        __footnoteTurnstileCallbacks?: Array<(token: string) => void>;
        __footnoteTurnstileResponses?: Map<HTMLElement, string>;
        turnstile?: {
            render: (
                container: HTMLElement,
                params: { callback: (token: string) => void }
            ) => string;
            execute: (container: HTMLElement) => void;
            getResponse: (container: HTMLElement) => string;
            reset: () => void;
            remove: () => void;
        };
        onloadTurnstileCallback?: () => void;
    }
}
