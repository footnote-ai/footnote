/**
 * @description: Checks browser transport for signed-in incident reads and claims.
 * @footnote-scope: test
 * @footnote-module: AccountIncidentApiTests
 * @footnote-risk: low - Assertions cover the typed API client boundary.
 * @footnote-ethics: medium - Correct CSRF and response handling protect private status.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    ApiJsonResult,
    ApiRequestOptions,
    ApiRequester,
} from '../src/client.js';
import type { GetAccountIncidentsResponse } from '@footnote/contracts/web';
import { createAccountIncidentApi } from '../src/accountIncidents.js';

test('account incident client sends CSRF claims and validates reporter-safe reads', async () => {
    const calls: Array<{
        endpoint: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
    }> = [];
    const requestJson: ApiRequester = async <T>(
        endpoint: string,
        options: ApiRequestOptions<T> = {}
    ) => {
        calls.push({
            endpoint,
            method: options.method,
            headers: options.headers as Record<string, string> | undefined,
            body: options.body,
        });
        const data =
            endpoint === '/api/account/incidents'
                ? {
                      incidents: [
                          {
                              incidentId: 'a1b2c3d4',
                              status: 'under_review',
                              createdAt: '2026-09-01T00:00:00.000Z',
                              updatedAt: '2026-09-02T00:00:00.000Z',
                          },
                      ],
                  }
                : { success: true };
        return { status: 200, data } as ApiJsonResult<T>;
    };
    const api = createAccountIncidentApi(requestJson);

    const list: GetAccountIncidentsResponse = await api.getAccountIncidents();
    await api.claimIncident('A'.repeat(43), 'csrf-value');

    assert.equal(list.incidents[0]?.incidentId, 'a1b2c3d4');
    assert.equal(calls[1]?.endpoint, '/api/account/incidents/claim');
    assert.equal(calls[1]?.method, 'POST');
    assert.equal(calls[1]?.headers?.['x-auth-csrf'], 'csrf-value');
    assert.deepEqual(calls[1]?.body, { claimCode: 'A'.repeat(43) });
});
