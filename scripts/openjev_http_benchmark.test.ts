/**
 * @description: Tests the TypeScript OpenJEV HTTP benchmark without a model server.
 * @footnote-scope: test
 * @footnote-module: OpenJevHttpBenchmarkTests
 * @footnote-risk: low - Tests only synthetic request and response handling.
 * @footnote-ethics: high - Fixtures contain no private conversation content.
 */

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
    buildHttpCandidates,
    runHttpBenchmark,
} from './openjev_http_benchmark.js';

let server: Server;
let url: string;

before(async () => {
    server = createServer(async (request, response) => {
        if (request.url !== '/classify' || request.method !== 'POST') {
            response.writeHead(404).end();
            return;
        }
        let body = '';
        for await (const chunk of request) body += chunk;
        const parsed: unknown = JSON.parse(body);
        const texts =
            typeof parsed === 'object' &&
            parsed !== null &&
            'text' in parsed &&
            Array.isArray(parsed.text)
                ? parsed.text
                : [];
        response.setHeader('content-type', 'application/json');
        response.end(
            JSON.stringify(texts.map(() => ({ embedding: [0.1, 0.8, 0.1] })))
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('test server did not bind');
    url = `http://127.0.0.1:${address.port}`;
});

after(() => server.close());

describe('OpenJEV HTTP benchmark', () => {
    it('builds exact candidate word counts', () => {
        const candidates = buildHttpCandidates(10, 32);
        assert.equal(candidates.length, 10);
        assert.ok(
            candidates.every((candidate) => candidate.split(' ').length === 32)
        );
    });

    it('runs against the OpenJEV-compatible classify boundary', async () => {
        const result = await runHttpBenchmark({
            url,
            modelId: 'test/openjev',
            revision: 'test-revision',
            candidateCounts: [2],
            candidateLengths: [4],
            repetitions: 2,
            timeoutMs: 1000,
        });

        assert.equal(result.status, 'completed');
        assert.equal(result.measurements.length, 2);
        assert.ok(
            result.measurements.every((item) => item.pairsPerSecond !== null)
        );
    });
});
