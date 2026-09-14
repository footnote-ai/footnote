/**
 * @description: Verifies official Cloudflare dummy Turnstile keys through the real browser and backend path.
 * @footnote-scope: test
 * @footnote-module: TurnstileBrowserIntegration
 * @footnote-risk: medium - It exercises external CAPTCHA verification but uses only official test credentials.
 * @footnote-ethics: medium - It proves the production auth boundary without bypassing or weakening it.
 */
import { expect, test } from '@playwright/test';

const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const waitForDummyToken = async (
    page: import('@playwright/test').Page
): Promise<void> => {
    await expect
        .poll(
            async () =>
                page
                    .locator(
                        '.interaction-captcha--invisible input[name="cf-turnstile-response"]'
                    )
                    .first()
                    .inputValue()
                    .catch(() => ''),
            { timeout: 10_000 }
        )
        .toBe(DUMMY_TOKEN);
};

const submitQuestion = async (
    page: import('@playwright/test').Page,
    question: string
) => {
    await page.getByLabel('Ask a question').fill(question);
    await waitForDummyToken(page);
    const requestPromise = page.waitForRequest('**/api/chat', {
        timeout: 10_000,
    });
    const responsePromise = page.waitForResponse('**/api/chat', {
        timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Submit question' }).click();
    const [request, response] = await Promise.all([
        requestPromise,
        responsePromise,
    ]);
    return { request, response };
};

const readRuntimeConfig = async (page: import('@playwright/test').Page) => {
    const result = await page.evaluate(async () => {
        const response = await fetch('/config.json');
        return {
            status: response.status,
            cacheControl: response.headers.get('cache-control'),
            body: (await response.json()) as { turnstileSiteKey: string },
        };
    });
    expect(result.status).toBe(200);
    expect(result.cacheControl).toContain('no-store');
    return result.body;
};

test.beforeEach(async ({ page }) => {
    await page.route('http://localhost:4173/api/**', async (route) => {
        await route.continue({
            url: route
                .request()
                .url()
                .replace('http://localhost:4173', 'http://127.0.0.1:3400'),
        });
    });
    await page.route('http://localhost:4173/config.json', async (route) => {
        await route.continue({
            url: route
                .request()
                .url()
                .replace('http://localhost:4173', 'http://127.0.0.1:3400'),
        });
    });
});

test('passes real Turnstile verification and mounts a fresh challenge after success', async ({
    page,
}) => {
    test.skip(process.env.TURNSTILE_E2E_MODE !== 'pass', 'pass mode only');
    const challengeRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/cdn-cgi/challenge-platform/')) {
            challengeRequests.push(request.url());
        }
    });
    await page.goto('/chat');
    const runtimeConfig = await readRuntimeConfig(page);
    expect(runtimeConfig.turnstileSiteKey).toBe('1x00000000000000000000BB');

    await page.getByLabel('Ask a question').focus();
    await expect(page.locator('.interaction-captcha')).toBeAttached();

    const first = await submitQuestion(page, 'Turnstile integration pass one');
    const firstToken = first.request.headers()['x-turnstile-token'];
    expect(firstToken).toBe(DUMMY_TOKEN);
    expect(first.response.status()).toBe(200);
    const firstPayload = (await first.response.json()) as {
        action?: string;
        message?: string;
    };
    expect(firstPayload.action).toBe('message');
    expect(firstPayload.message).toBeTruthy();

    await expect(
        page.getByRole('button', { name: 'Submit question' })
    ).toBeEnabled();

    const second = await submitQuestion(page, 'Turnstile integration pass two');
    const secondToken = second.request.headers()['x-turnstile-token'];
    expect(secondToken).toBe(DUMMY_TOKEN);
    expect(second.response.status()).toBe(200);
    expect((await second.response.json()).action).toBe('message');

    expect(firstToken).toBeTruthy();
    expect(secondToken).toBeTruthy();
    expect(challengeRequests.length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.interaction-captcha')).toBeAttached();
});

test('rejects the official always-fail key without sending an unauthenticated request', async ({
    page,
}) => {
    test.skip(process.env.TURNSTILE_E2E_MODE !== 'fail', 'fail mode only');
    await page.goto('/chat');
    const runtimeConfig = await readRuntimeConfig(page);
    expect(runtimeConfig.turnstileSiteKey).toBe('2x00000000000000000000BB');

    await page.getByLabel('Ask a question').focus();
    await expect
        .poll(
            () =>
                page
                    .getByLabel(
                        'Complete CAPTCHA verification to submit your question'
                    )
                    .count(),
            { timeout: 12_000 }
        )
        .toBeGreaterThan(0);
    await page
        .getByLabel('Ask a question')
        .fill('Turnstile integration failure');
    const chatRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().endsWith('/api/chat'))
            chatRequests.push(request.url());
    });
    await expect(
        page.getByRole('button', { name: 'Complete CAPTCHA to submit' })
    ).toHaveCount(1);
    await expect(page.getByRole('alert')).toContainText('CAPTCHA');
    expect(chatRequests).toHaveLength(0);
});
