/**
 * @description: Typed transport for account-owned memory list, add, and forget operations.
 * @footnote-scope: interface
 * @footnote-module: AccountMemoryApi
 * @footnote-risk: medium - Request wiring can expose or alter private account memories.
 * @footnote-ethics: high - These operations provide user control over saved personal context.
 */
import type {
    GetAccountMemoriesResponse,
    PostAccountMemoryResponse,
} from '@footnote/contracts/web';
import {
    GetAccountMemoriesResponseSchema,
    PostAccountMemoryResponseSchema,
    createSchemaResponseValidator,
} from '@footnote/contracts/web/schemas';
import type { ApiRequester } from './client.js';

export type AccountMemoryApi = {
    getAccountMemories: (
        signal?: AbortSignal
    ) => Promise<GetAccountMemoriesResponse>;
    addAccountMemory: (
        text: string,
        csrfToken: string
    ) => Promise<PostAccountMemoryResponse>;
    forgetAccountMemory: (memoryId: string, csrfToken: string) => Promise<void>;
};

/** Creates account-memory methods without adding policy to the transport. */
export const createAccountMemoryApi = (
    requestJson: ApiRequester
): AccountMemoryApi => ({
    getAccountMemories: async (signal) =>
        (
            await requestJson<GetAccountMemoriesResponse>(
                '/api/account/memories',
                {
                    method: 'GET',
                    signal,
                    cache: 'no-store',
                    validateResponse: createSchemaResponseValidator(
                        GetAccountMemoriesResponseSchema
                    ),
                }
            )
        ).data,
    addAccountMemory: async (text, csrfToken) =>
        (
            await requestJson<PostAccountMemoryResponse>(
                '/api/account/memories',
                {
                    method: 'POST',
                    cache: 'no-store',
                    headers: { 'x-auth-csrf': csrfToken },
                    body: { text },
                    validateResponse: createSchemaResponseValidator(
                        PostAccountMemoryResponseSchema
                    ),
                }
            )
        ).data,
    forgetAccountMemory: async (memoryId, csrfToken) => {
        await requestJson(
            '/api/account/memories/' + encodeURIComponent(memoryId),
            {
                method: 'DELETE',
                cache: 'no-store',
                headers: { 'x-auth-csrf': csrfToken },
            }
        );
    },
});
