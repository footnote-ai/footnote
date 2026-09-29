/**
 * @description: Typed browser transport for private reporter incident data.
 * @footnote-scope: interface
 * @footnote-module: AccountIncidentApi
 * @footnote-risk: medium - Incorrect request wiring can break account incident access.
 * @footnote-ethics: high - These operations expose sensitive reporter status.
 */
import type {
    GetAccountIncidentsResponse,
    PostAccountIncidentClaimResponse,
} from '@footnote/contracts/web';
import {
    GetAccountIncidentsResponseSchema,
    PostAccountIncidentClaimResponseSchema,
} from '@footnote/contracts/web/schemas';
import type { ApiRequester } from './client.js';
import { createSchemaResponseValidator } from '@footnote/contracts/web/schemas';

export type AccountIncidentApi = {
    getAccountIncidents: (
        signal?: AbortSignal
    ) => Promise<GetAccountIncidentsResponse>;
    claimIncident: (claimCode: string, csrfToken: string) => Promise<void>;
};

/** Creates account incident methods without adding account policy to transport. */
export const createAccountIncidentApi = (
    requestJson: ApiRequester
): AccountIncidentApi => ({
    getAccountIncidents: async (signal) => {
        const response = await requestJson<GetAccountIncidentsResponse>(
            '/api/account/incidents',
            {
                method: 'GET',
                signal,
                cache: 'no-store',
                validateResponse: createSchemaResponseValidator(
                    GetAccountIncidentsResponseSchema
                ),
            }
        );
        return response.data;
    },
    claimIncident: async (claimCode, csrfToken) => {
        await requestJson<PostAccountIncidentClaimResponse>(
            '/api/account/incidents/claim',
            {
                method: 'POST',
                cache: 'no-store',
                headers: { 'x-auth-csrf': csrfToken },
                body: { claimCode },
                validateResponse: createSchemaResponseValidator(
                    PostAccountIncidentClaimResponseSchema
                ),
            }
        );
    },
});
