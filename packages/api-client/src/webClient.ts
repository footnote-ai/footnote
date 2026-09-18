/**
 * @description: Web-focused API client entrypoint that avoids importing Discord/internal API modules.
 * @footnote-scope: interface
 * @footnote-module: WebApiClientEntrypoint
 * @footnote-risk: medium - Incorrect exports can break browser API wiring for chat, config, and trace reads.
 * @footnote-ethics: medium - Keeps response validation intact while reducing unnecessary startup code for web users.
 */

import {
    createApiTransport,
    isApiClientError,
    type ApiClientError,
    type ApiErrorResponse,
    type ApiJsonResult,
    type ApiRequestOptions,
    type ApiRequester,
    type CreateApiTransportOptions,
} from './client.js';
import { createAccountAuthApi, type AccountAuthApi } from './accountAuth.js';
import {
    createChatApi,
    type ChatApi,
    type ChatQuestionOptions,
    type CreateChatApiOptions,
    type DiscordChatApiResponse,
    type UnknownChatActionResponse,
} from './chat.js';
import { createWebReadApi, type WebReadApi } from './web.js';
import { DEFAULT_BACKEND_REQUEST_TIMEOUT_MS } from '@footnote/contracts/policy';

export type CreateWebApiClientOptions = CreateApiTransportOptions &
    Pick<CreateChatApiOptions, 'traceApiToken'>;

// Keep the browser transport behind the backend's bounded workflow plus the
// shared transport margin so valid long-running responses are not aborted.
export const DEFAULT_WEB_API_TIMEOUT_MS = DEFAULT_BACKEND_REQUEST_TIMEOUT_MS;

export type WebApiClient = {
    requestJson: ApiRequester;
    chatQuestion: ChatApi['chatQuestion'];
} & WebReadApi &
    AccountAuthApi;

/**
 * @description: Creates the web API boundary client and wires `createApiTransport`, `createChatApi`, and `createWebReadApi`.
 * @param options - `CreateWebApiClientOptions` including transport options such as `clientErrorName` and chat options such as `traceApiToken`.
 * @returns Stable `WebApiClient` methods for JSON requests, chat, and web read endpoints.
 */
export const createWebApiClient = ({
    baseUrl,
    defaultHeaders,
    defaultTimeoutMs = DEFAULT_WEB_API_TIMEOUT_MS,
    fetchImpl = fetch,
    clientErrorName,
    traceApiToken,
}: CreateWebApiClientOptions = {}): WebApiClient => {
    const { requestJson } = createApiTransport({
        baseUrl,
        defaultHeaders,
        defaultTimeoutMs,
        fetchImpl,
        clientErrorName,
    });
    const chatApi = createChatApi(requestJson, { traceApiToken });
    const webReadApi = createWebReadApi(requestJson);
    const accountAuthApi = createAccountAuthApi(requestJson);

    return {
        requestJson,
        chatQuestion: chatApi.chatQuestion,
        ...webReadApi,
        ...accountAuthApi,
    };
};

export { createApiTransport, isApiClientError };
export { createAccountAuthApi, createChatApi, createWebReadApi };
export type {
    AccountAuthApi,
    ApiClientError,
    ApiErrorResponse,
    ApiJsonResult,
    ApiRequestOptions,
    ApiRequester,
    ChatApi,
    ChatQuestionOptions,
    CreateApiTransportOptions,
    CreateChatApiOptions,
    DiscordChatApiResponse,
    UnknownChatActionResponse,
    WebReadApi,
};
