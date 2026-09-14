/**
 * @description: Runs the real browser-to-backend Turnstile integration suite against localhost.
 * @footnote-scope: test
 * @footnote-module: TurnstilePlaywrightConfig
 * @footnote-risk: low - Web servers are isolated to local test ports and official dummy keys.
 * @footnote-ethics: low - The suite excludes production credentials and production hosts.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './test/turnstile-integration',
    fullyParallel: false,
    forbidOnly: true,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
        ...devices['Desktop Chrome'],
    },
    webServer: [
        {
            command:
                'pnpm backend:prepare && pnpm --filter @footnote/agent-runtime build && node scripts/start-turnstile-e2e.cjs',
            url: 'http://127.0.0.1:3400/config.json',
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            command:
                'pnpm --filter @footnote/contracts build && pnpm --filter @footnote/api-client build && pnpm --filter @footnote/web exec vite build && pnpm --filter @footnote/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort',
            url: 'http://127.0.0.1:4173',
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
