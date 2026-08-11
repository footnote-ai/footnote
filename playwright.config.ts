/**
 * @description: Runs the single repeatable web output check in Chromium.
 * @footnote-scope: test
 * @footnote-module: BasicOutputCheckPlaywrightConfig
 * @footnote-risk: low - This configuration only starts the local web server for a test.
 * @footnote-ethics: medium - It protects the visibility of answer provenance in the public web flow.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/basic-output-check',
    outputDir: 'test-results/output-check',
    reporter: 'list',
    snapshotPathTemplate: '{testDir}/snapshots/{testFilePath}/{arg}{ext}',
    use: {
        baseURL: 'http://output-check.localhost:4173',
        viewport: { width: 1440, height: 900 },
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
    webServer: {
        command:
            'pnpm --filter @footnote/contracts build && pnpm --filter @footnote/api-client build && pnpm --filter @footnote/web exec vite --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
    },
});
