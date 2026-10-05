/**
 * @description: Shares ordinary local chat fixtures between browser checks.
 * @footnote-scope: test
 * @footnote-module: ChatBrowserTestHelpers
 * @footnote-risk: low - Helpers only prepare controlled browser requests.
 * @footnote-ethics: low - Fixtures use public synthetic response data.
 */
import type { Page } from '@playwright/test';
import ordinaryAnswer from './fixtures/ordinary-text-answer.json';

export const deferred = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

export const configureRuntime = async (page: Page): Promise<void> => {
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

export const response = (message: string) => ({
    ...ordinaryAnswer.response,
    message,
});
