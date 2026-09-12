/**
 * @description: Verifies static asset routing, wiki fallback isolation, and generated asset MIME coverage.
 * @footnote-scope: test
 * @footnote-module: AssetResolverTests
 * @footnote-risk: medium - Static route regressions can hide broken documentation or application delivery.
 * @footnote-ethics: medium - Correct route isolation prevents a missing public document from being presented as another page.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAssetResolver, MIME_MAP } from '../src/http/assets.js';

test('asset resolver serves nested wiki files without SPA fallback for missing wiki paths', async () => {
    const distDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'footnote-assets-test-')
    );
    try {
        await fs.mkdir(path.join(distDir, 'wiki', 'reference'), {
            recursive: true,
        });
        await fs.mkdir(path.join(distDir, 'wiki', '_astro'), {
            recursive: true,
        });
        await fs.writeFile(path.join(distDir, 'index.html'), 'react-app');
        await fs.writeFile(
            path.join(distDir, 'wiki', 'index.html'),
            'wiki-home'
        );
        await fs.writeFile(
            path.join(distDir, 'wiki', 'reference', 'index.html'),
            'wiki-reference'
        );
        await fs.writeFile(
            path.join(distDir, 'wiki', '_astro', 'font.woff2'),
            'font'
        );

        const { resolveAsset } = createAssetResolver(distDir, {
            spaFallbackExemptPrefixes: ['wiki'],
        });
        const wikiHome = await resolveAsset('/wiki/');
        const wikiReference = await resolveAsset('/wiki/reference/');
        const wikiMissing = await resolveAsset('/wiki/missing/');
        const wikiMissingWithQuery = await resolveAsset(
            '/wiki/missing?search=docs'
        );
        const spaFallback = await resolveAsset('/chat/missing');

        assert.equal(await wikiHome?.content.toString(), 'wiki-home');
        assert.equal(await wikiReference?.content.toString(), 'wiki-reference');
        assert.equal(wikiMissing, undefined);
        assert.equal(wikiMissingWithQuery, undefined);
        assert.equal(await spaFallback?.content.toString(), 'react-app');
        assert.equal(MIME_MAP.get('.woff2'), 'font/woff2');
        assert.equal(MIME_MAP.get('.wasm'), 'application/wasm');
        assert.equal(MIME_MAP.get('.pf_fragment'), 'application/octet-stream');
    } finally {
        await fs.rm(distDir, { recursive: true, force: true });
    }
});
