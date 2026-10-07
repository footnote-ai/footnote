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
    createAccountIncidentApi,
    type AccountIncidentApi,
} from './accountIncidents.js';
import {
    createAccountMemoryApi,
    type AccountMemoryApi,
} from './accountMemories.js';
import {
    createIncidentApi,
    type CreateIncidentApiOptions,
    type IncidentApi,
} from './incidents.js';
import {
    createChatApi,
    type CreateChatApiOptions,
    type ChatApi,
    type ChatQuestionOptions,
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
import {
    createPublicResponsesApi,
    type PublicResponsesApi,
} from './publicResponses.js';
import {
    createDiscordAccountApi,
    type DiscordAccountApi,
} from './discordAccounts.js';

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
    RecoverableTaskApi &
    DiscordAccountApi;

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
        ...createDiscordAccountApi(requestJson, traceApiToken),
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
    PublicResponsesApi &
    AccountAuthApi &
    AccountIncidentApi &
    AccountMemoryApi;

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
    const publicResponsesApi = createPublicResponsesApi(requestJson);
    const accountAuthApi = createAccountAuthApi(requestJson);
    const accountIncidentApi = createAccountIncidentApi(requestJson);
    const accountMemoryApi = createAccountMemoryApi(requestJson);

    return {
        requestJson,
        chatQuestion: chatApi.chatQuestion,
        ...webReadApi,
        ...publicResponsesApi,
        ...accountAuthApi,
        ...accountIncidentApi,
        ...accountMemoryApi,
    };
};

export { createApiTransport, isApiClientError };
export {
    createAccountAuthApi,
    createAccountIncidentApi,
    createAccountMemoryApi,
    createDiscordAccountApi,
    createChatApi,
    createIncidentApi,
    createInternalImageApi,
    createInternalTextApi,
    createInternalVoiceApi,
    createRecoverableTaskApi,
    createTraceApi,
    createWebReadApi,
    createPublicResponsesApi,
};
export type {
    AccountAuthApi,
    AccountIncidentApi,
    AccountMemoryApi,
    DiscordAccountApi,
    ApiClientError,
    ApiErrorResponse,
    ApiJsonResult,
    ApiRequestOptions,
};
export type {
    ApiRequester,
    ChatApi,
    ChatQuestionOptions,
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
    PublicResponsesApi,
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
