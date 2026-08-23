/**
 * @description: Verifies openid-client wiring, lazy discovery, PKCE parameters, and principal projection.
 * @footnote-scope: test
 * @footnote-module: OidcAccountClientTests
 * @footnote-risk: high - Incorrect library wiring could skip required callback checks.
 * @footnote-ethics: high - Tests ensure provider tokens are reduced to minimal identity data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOidcAccountClient } from '../src/services/oidcClient.js';

type Library = NonNullable<
    Parameters<typeof createOidcAccountClient>[0]['library']
>;

test('OIDC client lazily discovers once and wires PKCE callback checks', async () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const configuration = {
        serverMetadata: () => ({
            supportsPKCE: () => true,
        }),
    };
    const library = {
        ClientSecretBasic: (...args: unknown[]) => {
            calls.push({ name: 'ClientSecretBasic', args });
            return { method: 'basic' };
        },
        discovery: async (...args: unknown[]) => {
            calls.push({ name: 'discovery', args });
            return configuration;
        },
        randomPKCECodeVerifier: () => 'verifier-value',
        calculatePKCECodeChallenge: async (...args: unknown[]) => {
            calls.push({ name: 'calculatePKCECodeChallenge', args });
            return 'challenge-value';
        },
        randomState: () => 'state-value',
        randomNonce: () => 'nonce-value',
        buildAuthorizationUrl: (...args: unknown[]) => {
            calls.push({ name: 'buildAuthorizationUrl', args });
            return new URL('https://identity.example/authorize');
        },
        authorizationCodeGrant: async (...args: unknown[]) => {
            calls.push({ name: 'authorizationCodeGrant', args });
            return {
                claims: () => ({
                    iss: 'https://identity.example/',
                    sub: 'subject-1',
                    name: ' Administrator ',
                    preferred_username: 'ignored',
                }),
            };
        },
    } as unknown as Library;

    const client = createOidcAccountClient({
        issuerUrl: 'https://identity.example/',
        clientId: 'footnote',
        clientSecret: 'client-secret',
        redirectUri: 'https://footnote.example/api/auth/callback',
        library,
    });
    assert.equal(calls.length, 0);

    const authorization = await client.startAuthorization();
    assert.deepEqual(authorization, {
        authorizationUrl: 'https://identity.example/authorize',
        state: 'state-value',
        nonce: 'nonce-value',
        codeVerifier: 'verifier-value',
    });
    await client.startAuthorization();
    assert.equal(calls.filter((call) => call.name === 'discovery').length, 1);
    const discoveryCall = calls.find((call) => call.name === 'discovery');
    assert.equal((discoveryCall?.args[4] as { timeout?: number }).timeout, 10);
    assert.equal(
        (
            discoveryCall?.args[2] as {
                token_endpoint_auth_method?: string;
            }
        ).token_endpoint_auth_method,
        'client_secret_basic'
    );
    const authorizationCall = calls.find(
        (call) => call.name === 'buildAuthorizationUrl'
    );
    assert.deepEqual(authorizationCall?.args[1], {
        redirect_uri: 'https://footnote.example/api/auth/callback',
        scope: 'openid profile',
        code_challenge: 'challenge-value',
        code_challenge_method: 'S256',
        state: 'state-value',
        nonce: 'nonce-value',
    });

    const principal = await client.exchangeCallback({
        callbackQuery: '?code=one&state=state-value',
        state: 'state-value',
        nonce: 'nonce-value',
        codeVerifier: 'verifier-value',
    });
    assert.deepEqual(principal, {
        issuer: 'https://identity.example/',
        subject: 'subject-1',
        displayName: 'Administrator',
    });
    const grantCall = calls.find(
        (call) => call.name === 'authorizationCodeGrant'
    );
    assert.equal(
        (grantCall?.args[1] as URL).href,
        'https://footnote.example/api/auth/callback?code=one&state=state-value'
    );
    assert.deepEqual(grantCall?.args[2], {
        pkceCodeVerifier: 'verifier-value',
        expectedState: 'state-value',
        expectedNonce: 'nonce-value',
        idTokenExpected: true,
    });
});

test('failed discovery is retried and missing required claims fail closed', async () => {
    let discoveryCalls = 0;
    const configuration = {
        serverMetadata: () => ({
            supportsPKCE: () => true,
        }),
    };
    const library = {
        ClientSecretBasic: () => ({ method: 'basic' }),
        discovery: async () => {
            discoveryCalls += 1;
            if (discoveryCalls === 1) {
                throw new Error('temporary outage');
            }
            return configuration;
        },
        randomPKCECodeVerifier: () => 'verifier',
        calculatePKCECodeChallenge: async () => 'challenge',
        randomState: () => 'state',
        randomNonce: () => 'nonce',
        buildAuthorizationUrl: () =>
            new URL('https://identity.example/authorize'),
        authorizationCodeGrant: async () => ({
            claims: () => ({ iss: 'https://identity.example/' }),
        }),
    } as unknown as Library;
    const client = createOidcAccountClient({
        issuerUrl: 'https://identity.example/',
        clientId: 'footnote',
        clientSecret: 'client-secret',
        redirectUri: 'https://footnote.example/api/auth/callback',
        library,
    });

    await assert.rejects(client.startAuthorization());
    await client.startAuthorization();
    assert.equal(discoveryCalls, 2);
    await assert.rejects(
        client.exchangeCallback({
            callbackQuery: '?code=one',
            state: 'state',
            nonce: 'nonce',
            codeVerifier: 'verifier',
        }),
        /required ID claims/
    );
});

test('providers without PKCE S256 support are rejected', async () => {
    const library = {
        ClientSecretBasic: () => ({ method: 'basic' }),
        discovery: async () => ({
            serverMetadata: () => ({ supportsPKCE: () => false }),
        }),
        randomPKCECodeVerifier: () => 'verifier',
        calculatePKCECodeChallenge: async () => 'challenge',
        randomState: () => 'state',
        randomNonce: () => 'nonce',
        buildAuthorizationUrl: () =>
            new URL('https://identity.example/authorize'),
        authorizationCodeGrant: async () => ({ claims: () => ({}) }),
    } as unknown as Library;
    const client = createOidcAccountClient({
        issuerUrl: 'https://identity.example/',
        clientId: 'footnote',
        clientSecret: 'client-secret',
        redirectUri: 'https://footnote.example/api/auth/callback',
        library,
    });

    await assert.rejects(client.startAuthorization(), /PKCE S256/);
});
