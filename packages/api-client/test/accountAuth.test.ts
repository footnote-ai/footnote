/**
 * @description: Verifies typed account-session and local-logout client request wiring.
 * @footnote-scope: test
 * @footnote-module: AccountAuthApiTests
 * @footnote-risk: low - Tests exercise synthetic transport calls only.
 * @footnote-ethics: medium - Coverage guards CSRF handling and strict public identity validation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { GetAuthSessionResponse } from '@footnote/contracts/web';
import type {
    ApiJsonResult,
    ApiRequestOptions,
    ApiRequester,
} from '../src/client.js';
import { createAccountAuthApi } from '../src/accountAuth.js';

test('getAuthSession requests a no-store validated session response', async () => {
    const session: GetAuthSessionResponse = {
        enabled: true,
        authenticated: true,
        principal: {
            issuer: 'https://identity.example/application/o/footnote/',
            subject: 'account-123',
            displayName: 'Example Operator',
        },
        expiresAt: '2026-07-23T12:00:00.000Z',
        csrfToken: 'csrf-token',
    };
    let capturedEndpoint = '';
    let capturedOptions: ApiRequestOptions<GetAuthSessionResponse> = {};
    const requestJson: ApiRequester = async <T>(
        endpoint: string,
        options: ApiRequestOptions<T> = {}
    ): Promise<ApiJsonResult<T>> => {
        capturedEndpoint = endpoint;
        capturedOptions = options as ApiRequestOptions<GetAuthSessionResponse>;
        return {
            status: 200,
            data: session as T,
        };
    };

    const result = await createAccountAuthApi(requestJson).getAuthSession();

    assert.equal(capturedEndpoint, '/api/auth/session');
    assert.equal(capturedOptions.method, 'GET');
    assert.equal(capturedOptions.cache, 'no-store');
    assert.equal(typeof capturedOptions.validateResponse, 'function');
    assert.deepEqual(capturedOptions.validateResponse?.(session), {
        success: true,
        data: session,
    });
    assert.equal(
        capturedOptions.validateResponse?.({
            enabled: true,
            authenticated: true,
            providerToken: 'must-not-cross-the-boundary',
        }).success,
        false
    );
    assert.deepEqual(result, session);
});

test('logoutAccount posts only the CSRF header and normalizes success to void', async () => {
    const controller = new AbortController();
    let capturedEndpoint = '';
    let capturedOptions: ApiRequestOptions<unknown> = {};
    const requestJson: ApiRequester = async <T>(
        endpoint: string,
        options: ApiRequestOptions<T> = {}
    ): Promise<ApiJsonResult<T>> => {
        capturedEndpoint = endpoint;
        capturedOptions = options as ApiRequestOptions<unknown>;
        return {
            status: 204,
            data: null as T,
        };
    };

    const result = await createAccountAuthApi(requestJson).logoutAccount(
        'csrf-token',
        controller.signal
    );

    assert.equal(capturedEndpoint, '/api/auth/logout');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.cache, 'no-store');
    assert.equal(capturedOptions.signal, controller.signal);
    assert.deepEqual(capturedOptions.headers, {
        'x-auth-csrf': 'csrf-token',
    });
    assert.equal(capturedOptions.body, undefined);
    assert.equal(result, undefined);
});
