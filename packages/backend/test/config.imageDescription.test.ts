/**
 * @description: Verifies image-description provider defaults and explicit runtime configuration.
 * @footnote-scope: test
 * @footnote-module: ImageDescriptionConfigTests
 * @footnote-risk: low - Missed config defaults can make scanner startup behavior diverge from operator settings.
 * @footnote-ethics: medium - Provider selection controls where uploaded images are processed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildRuntimeConfig } from '../src/config/buildRuntimeConfig.js';

test('image-description config keeps OpenAI as the default and leaves alternate model selection explicit', () => {
    const config = buildRuntimeConfig({}, () => undefined);
    assert.equal(config.imageDescription.provider, 'openai');
    assert.equal(config.imageDescription.model, null);
    assert.equal(config.imageDescription.requestTimeoutMs, 180000);
});

test('image-description config accepts Ollama provider, model, URL, and timeout from footnote.yaml', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'footnote-image-'));
    const settingsPath = path.join(directory, 'footnote.yaml');
    try {
        await writeFile(
            settingsPath,
            [
                'version: 1',
                'image-description:',
                '  provider: ollama',
                '  model: local-vision',
                '  base-url: http://localhost:11434/v1',
                '  timeout-ms: 12000',
            ].join('\n')
        );
        const config = buildRuntimeConfig(
            { FOOTNOTE_SETTINGS_PATH: settingsPath },
            () => undefined
        );
        assert.equal(config.imageDescription.provider, 'ollama');
        assert.equal(config.imageDescription.model, 'local-vision');
        assert.equal(
            config.imageDescription.baseUrl,
            'http://localhost:11434/v1'
        );
        assert.equal(config.imageDescription.requestTimeoutMs, 12000);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
