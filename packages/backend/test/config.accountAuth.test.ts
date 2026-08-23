/**
 * @description: Verifies optional OIDC account sign-in configuration and safe disable behavior.
 * @footnote-scope: test
 * @footnote-module: AccountAuthConfigTests
 * @footnote-risk: high - Config regressions can expose or disable authentication.
 * @footnote-ethics: high - These checks protect administrator identity boundaries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountAuthSection } from '../src/config/sections/accountAuth.js';

test('account auth is quietly disabled when no OIDC values are set', () => {
    const warnings: string[] = [];
    assert.deepEqual(
        buildAccountAuthSection({}, (message) => warnings.push(message)),
        { enabled: false }
    );
    assert.deepEqual(warnings, []);
});

test('account auth enables valid HTTPS configuration', () => {
    const warnings: string[] = [];
    const config = buildAccountAuthSection(
        {
            OIDC_ISSUER_URL: 'https://identity.example/application/o/footnote/',
            OIDC_CLIENT_ID: 'footnote',
            OIDC_CLIENT_SECRET: 'secret-value',
            OIDC_REDIRECT_URI: 'https://footnote.example/api/auth/callback',
        },
        (message) => warnings.push(message)
    );

    assert.deepEqual(config, {
        enabled: true,
        issuerUrl: 'https://identity.example/application/o/footnote/',
        clientId: 'footnote',
        clientSecret: 'secret-value',
        redirectUri: 'https://footnote.example/api/auth/callback',
        secureCookies: true,
    });
    assert.deepEqual(warnings, []);
});

test('account auth allows loopback HTTP callbacks for local development', () => {
    const config = buildAccountAuthSection(
        {
            OIDC_ISSUER_URL: 'https://identity.example/',
            OIDC_CLIENT_ID: 'footnote',
            OIDC_CLIENT_SECRET: 'secret-value',
            OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
        },
        () => undefined
    );

    assert.equal(config.enabled, true);
    if (config.enabled) {
        assert.equal(config.secureCookies, false);
    }
});

test('account auth disables partial config without exposing values', () => {
    const warnings: string[] = [];
    const config = buildAccountAuthSection(
        {
            OIDC_ISSUER_URL: 'https://identity.example/',
            OIDC_CLIENT_SECRET: 'do-not-log-this',
        },
        (message) => warnings.push(message)
    );

    assert.deepEqual(config, { enabled: false });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /OIDC_CLIENT_ID/);
    assert.match(warnings[0] ?? '', /OIDC_REDIRECT_URI/);
    assert.doesNotMatch(warnings[0] ?? '', /do-not-log-this/);
});

test('account auth rejects unsafe issuer and callback URLs', () => {
    const cases: Array<{
        issuerUrl: string;
        redirectUri: string;
        expectedKey: string;
    }> = [
        {
            issuerUrl: 'http://identity.example/',
            redirectUri: 'https://footnote.example/api/auth/callback',
            expectedKey: 'OIDC_ISSUER_URL',
        },
        {
            issuerUrl: 'https://identity.example/?tenant=one',
            redirectUri: 'https://footnote.example/api/auth/callback',
            expectedKey: 'OIDC_ISSUER_URL',
        },
        {
            issuerUrl: 'https://identity.example/',
            redirectUri: 'http://footnote.example/api/auth/callback',
            expectedKey: 'OIDC_REDIRECT_URI',
        },
        {
            issuerUrl: 'https://identity.example/',
            redirectUri: 'https://footnote.example/wrong-callback',
            expectedKey: 'OIDC_REDIRECT_URI',
        },
    ];

    for (const testCase of cases) {
        const warnings: string[] = [];
        const config = buildAccountAuthSection(
            {
                OIDC_ISSUER_URL: testCase.issuerUrl,
                OIDC_CLIENT_ID: 'footnote',
                OIDC_CLIENT_SECRET: 'secret-value',
                OIDC_REDIRECT_URI: testCase.redirectUri,
            },
            (message) => warnings.push(message)
        );
        assert.deepEqual(config, { enabled: false });
        assert.match(warnings[0] ?? '', new RegExp(testCase.expectedKey));
        assert.doesNotMatch(warnings[0] ?? '', /secret-value/);
        assert.doesNotMatch(warnings[0] ?? '', /identity\.example/);
    }
});
