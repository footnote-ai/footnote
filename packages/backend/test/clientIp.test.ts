/**
 * @description: Verifies direct-origin spoof resistance and Cloudflare proxy IP recovery.
 * @footnote-scope: test
 * @footnote-module: ClientIpResolutionTests
 * @footnote-risk: high - Proxy identity regressions can bypass abuse controls.
 * @footnote-ethics: high - Security-sensitive identity must remain deterministic and non-spoofable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';

import { isCloudflareEdgeIp, resolveClientIp } from '../src/http/clientIp.js';

const createRequest = ({
    socketAddress = '127.0.0.1',
    headers = {},
}: {
    socketAddress?: string;
    headers?: Record<string, string | string[]>;
}): IncomingMessage =>
    ({
        headers,
        socket: { remoteAddress: socketAddress },
    }) as IncomingMessage;

test('direct Fly traffic ignores forged Cloudflare and X-Forwarded-For headers', () => {
    const resolution = resolveClientIp(
        createRequest({
            socketAddress: '198.51.100.8',
            headers: {
                'fly-client-ip': '203.0.113.20',
                'cf-connecting-ip': '1.2.3.4',
                'x-forwarded-for': '1.2.3.4',
            },
        }),
        true
    );

    assert.deepEqual(resolution, {
        clientIp: '203.0.113.20',
        source: 'fly-client-ip',
    });
});

test('trusted Cloudflare IPv4 traffic uses one valid CF-Connecting-IP', () => {
    const resolution = resolveClientIp(
        createRequest({
            headers: {
                'fly-client-ip': '173.245.48.1',
                'cf-connecting-ip': '203.0.113.20',
                'x-forwarded-for': '198.51.100.9, 203.0.113.20',
            },
        }),
        true
    );

    assert.deepEqual(resolution, {
        clientIp: '203.0.113.20',
        source: 'cloudflare',
    });
});

test('trusted Cloudflare IPv6 traffic and IPv4-mapped addresses normalize safely', () => {
    const ipv6Resolution = resolveClientIp(
        createRequest({
            headers: {
                'fly-client-ip': '2606:4700::1',
                'cf-connecting-ip': '2001:0db8:0:0:0:0:0:20',
            },
        }),
        true
    );
    const mappedResolution = resolveClientIp(
        createRequest({
            headers: {
                'fly-client-ip': '::ffff:173.245.48.1',
                'cf-connecting-ip': '::ffff:203.0.113.20',
            },
        }),
        true
    );

    assert.equal(ipv6Resolution.clientIp, '2001:db8::20');
    assert.equal(ipv6Resolution.source, 'cloudflare');
    assert.deepEqual(mappedResolution, {
        clientIp: '203.0.113.20',
        source: 'cloudflare',
    });
});

test('malformed or ambiguous proxy headers fail closed to the Fly identity', () => {
    const malformedClientIp = resolveClientIp(
        createRequest({
            headers: {
                'fly-client-ip': '173.245.48.1',
                'cf-connecting-ip': '203.0.113.20, 198.51.100.9',
            },
        }),
        true
    );
    const untrustedFlyHeader = resolveClientIp(
        createRequest({
            headers: {
                'fly-client-ip': '203.0.113.20',
                'cf-connecting-ip': '198.51.100.5',
            },
        }),
        true
    );
    const malformedFlyHeader = resolveClientIp(
        createRequest({
            socketAddress: '198.51.100.7',
            headers: {
                'fly-client-ip': 'not-an-ip',
                'cf-connecting-ip': '203.0.113.20',
                'x-forwarded-for': '203.0.113.20',
            },
        }),
        true
    );

    assert.deepEqual(malformedClientIp, {
        clientIp: '173.245.48.1',
        source: 'fly-client-ip',
    });
    assert.deepEqual(untrustedFlyHeader, {
        clientIp: '203.0.113.20',
        source: 'fly-client-ip',
    });
    assert.deepEqual(malformedFlyHeader, {
        clientIp: '198.51.100.7',
        source: 'socket',
    });
});

test('Cloudflare range matching covers official IPv4 and IPv6 ranges', () => {
    assert.equal(isCloudflareEdgeIp('173.245.48.10'), true);
    assert.equal(isCloudflareEdgeIp('2606:4700::10'), true);
    assert.equal(isCloudflareEdgeIp('192.0.2.10'), false);
    assert.equal(isCloudflareEdgeIp('173.245.48.10, 198.51.100.1'), false);
});
