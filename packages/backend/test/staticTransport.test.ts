/**
 * @description: Verifies static fallback headers stay private on anonymous response pages.
 * @footnote-scope: test
 * @footnote-module: StaticTransportTests
 * @footnote-risk: low - Covers isolated HTTP response headers only.
 * @footnote-ethics: high - Prevents caching or referral leakage for shared answer pages.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { handleStaticTransportRequest } from '../src/http/staticTransport.js';

test('shared response shell is not cached, indexed, or used as a referrer', async (t) => {
    const server = http.createServer(
        (req, res) =>
            void handleStaticTransportRequest({
                req,
                res,
                parsedUrl: new URL(req.url ?? '/', 'http://localhost'),
                resolveAsset: async () => ({
                    content: Buffer.from('<html>shared response</html>'),
                    absolutePath: 'C:/app/dist/index.html',
                }),
                mimeMap: new Map([['.html', 'text/html']]),
                frameAncestors: [],
                logRequest: () => undefined,
            })
    );
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind static transport test server');
    }
    t.after(
        async () =>
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            )
    );

    const response = await fetch(
        `http://127.0.0.1:${address.port}/share/${'A'.repeat(43)}`
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, noarchive');
});
