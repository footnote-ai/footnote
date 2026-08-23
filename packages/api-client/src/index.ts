/**
 * @description: Shared package that composes typed backend API clients for Footnote web and Discord surfaces.
 * @footnote-scope: interface
 * @footnote-module: SharedApiClient
 * @footnote-risk: high - Miswired client composition can break multiple surface-to-backend integrations at once.
 * @footnote-ethics: medium - Stable transport and schema validation help preserve transparent, fail-open behavior.
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
    createIncidentApi,
    type CreateIncidentApiOptions,
    type IncidentApi,
} from './incidents.js';
import {
    createChatApi,
    type CreateChatApiOptions,
    type ChatApi,
    type ChatToolExecutionContext,
    type DiscordChatApiResponse,
    type UnknownChatActionResponse,
} from './chat.js';
import {
    createInternalImageApi,
    type CreateInternalImageApiOptions,
    type InternalImageApi,
} from './internalImage.js';
import {
    createInternalTextApi,
    type CreateInternalTextApiOptions,
    type InternalTextApi,
} from './internalText.js';
import {
    createInternalVoiceApi,
    type CreateInternalVoiceApiOptions,
    type InternalVoiceApi,
} from './internalVoice.js';
import {
    createRecoverableTaskApi,
    type CreateRecoverableTaskApiOptions,
    type RecoverableTaskApi,
} from './recoverableTasks.js';
import {
    createTraceApi,
    type CreateTraceApiOptions,
    type TraceApi,
} from './traces.js';
import { createWebReadApi, type WebReadApi } from './web.js';

export type CreateDiscordApiClientOptions = CreateApiTransportOptions & {
    baseUrl: string;
} & CreateIncidentApiOptions &
    CreateTraceApiOptions &
    CreateChatApiOptions &
    CreateInternalImageApiOptions &
    CreateInternalTextApiOptions &
    CreateInternalVoiceApiOptions &
    CreateRecoverableTaskApiOptions;

export type DiscordApiClient = {
    requestJson: ApiRequester;
} & TraceApi &
    ChatApi &
    IncidentApi &
    InternalImageApi &
    InternalTextApi &
    InternalVoiceApi &
    RecoverableTaskApi;

export const createDiscordApiClient = ({
    baseUrl,
    defaultHeaders,
    defaultTimeoutMs,
    fetchImpl,
    traceApiToken,
}: CreateDiscordApiClientOptions): DiscordApiClient => {
    const { requestJson } = createApiTransport({
        baseUrl,
        defaultHeaders,
        defaultTimeoutMs,
        fetchImpl,
        clientErrorName: 'DiscordApiClientError',
    });

    return {
        requestJson,
        ...createIncidentApi(requestJson, { traceApiToken }),
        ...createInternalImageApi(requestJson, {
            traceApiToken,
            baseUrl,
            defaultHeaders,
            defaultTimeoutMs,
            fetchImpl,
        }),
        ...createInternalTextApi(requestJson, { traceApiToken }),
        ...createInternalVoiceApi(requestJson, { traceApiToken }),
        ...createRecoverableTaskApi(requestJson, { traceApiToken }),
        ...createChatApi(requestJson, { traceApiToken }),
        ...createTraceApi(requestJson, { traceApiToken }),
    };
};

export const isDiscordApiClientError = (
    value: unknown
): value is ApiClientError => isApiClientError(value, 'DiscordApiClientError');

export type CreateWebApiClientOptions = CreateApiTransportOptions;

export type WebApiClient = {
    requestJson: ApiRequester;
    chatQuestion: ChatApi['chatQuestion'];
} & WebReadApi &
    AccountAuthApi;

export const createWebApiClient = ({
    baseUrl,
    defaultHeaders,
    defaultTimeoutMs,
    fetchImpl = fetch,
}: CreateWebApiClientOptions = {}): WebApiClient => {
    const { requestJson } = createApiTransport({
        baseUrl,
        defaultHeaders,
        defaultTimeoutMs,
        fetchImpl,
        clientErrorName: 'ApiClientError',
    });
    const chatApi = createChatApi(requestJson);
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
export {
    createAccountAuthApi,
    createChatApi,
    createIncidentApi,
    createInternalImageApi,
    createInternalTextApi,
    createInternalVoiceApi,
    createRecoverableTaskApi,
    createTraceApi,
    createWebReadApi,
};
export type {
    AccountAuthApi,
    ApiClientError,
    ApiErrorResponse,
    ApiJsonResult,
    ApiRequestOptions,
};
export type {
    ApiRequester,
    ChatApi,
    CreateApiTransportOptions,
    CreateChatApiOptions,
    CreateIncidentApiOptions,
    CreateInternalImageApiOptions,
    CreateInternalTextApiOptions,
    CreateInternalVoiceApiOptions,
    CreateRecoverableTaskApiOptions,
    CreateTraceApiOptions,
    DiscordChatApiResponse,
    ChatToolExecutionContext,
    IncidentApi,
    InternalImageApi,
    InternalTextApi,
    InternalVoiceApi,
    RecoverableTaskApi,
    TraceApi,
    UnknownChatActionResponse,
    WebReadApi,
};
export type {
    GetIncidentResponse,
    GetIncidentsResponse,
    PostInternalRecoverableTaskClaimRequest,
    PostInternalRecoverableTaskClaimResponse,
    PostInternalRecoverableTaskCreateRequest,
    PostInternalRecoverableTaskCreateResponse,
    PostInternalRecoverableTaskFinishRequest,
    PostInternalRecoverableTaskFinishResponse,
    RecoverableTask,
    PostInternalImageGenerateRequest,
    PostInternalImageGenerateResponse,
    PostInternalImageDescriptionTaskRequest,
    PostInternalImageDescriptionTaskResponse,
    PostInternalNewsTaskRequest,
    PostInternalNewsTaskResponse,
    PostIncidentNotesRequest,
    PostIncidentNotesResponse,
    PostIncidentRemediationRequest,
    PostIncidentRemediationResponse,
    PostIncidentReportRequest,
    PostIncidentReportResponse,
    PostIncidentStatusRequest,
    PostIncidentStatusResponse,
    PostTraceCardFromTraceRequest,
    PostTraceCardFromTraceResponse,
    PostTraceCardRequest,
    PostTraceCardResponse,
    PostTracesRequest,
    PostTracesResponse,
} from '@footnote/contracts/web';
export type {
    PostInternalVoiceTtsRequest,
    PostInternalVoiceTtsResponse,
} from '@footnote/contracts/voice';
