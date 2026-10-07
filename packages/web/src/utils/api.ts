/**
 * @description: Web-facing wrapper over the shared @footnote/api-client package.
 * @footnote-scope: utility
 * @footnote-module: WebApiClient
 * @footnote-risk: medium - Incorrect transport wiring can break chat/trace experiences.
 * @footnote-ethics: medium - Consistent error handling helps keep fallback behavior transparent.
 */
import {
    createWebApiClient as createSharedWebApiClient,
    isApiClientError as isSharedApiClientError,
    type ApiJsonResult,
    type ApiClientError,
    type ApiErrorResponse,
    type CreateWebApiClientOptions,
    type ChatQuestionOptions,
} from '@footnote/api-client/web-client';
import type {
    GetAuthSessionResponse,
    GetRuntimeConfigResponse,
    GetTraceResponse,
    GetTraceStaleResponse,
    ExecutionReportResponse,
    GetResponseVersionsResponse,
    GetResponseVersionsStaleResponse,
    PostChatRequest,
    PostChatResponse,
} from '@footnote/contracts/web';

export const isApiClientError = (value: unknown): value is ApiClientError =>
    isSharedApiClientError(value, 'ApiClientError');

export type WebApiClient = {
    requestJson: ReturnType<typeof createSharedWebApiClient>['requestJson'];
    chatQuestion: (
        request: PostChatRequest,
        options?: ChatQuestionOptions
    ) => Promise<PostChatResponse>;
    getRuntimeConfig: (
        signal?: AbortSignal
    ) => Promise<GetRuntimeConfigResponse>;
    getAuthSession: (signal?: AbortSignal) => Promise<GetAuthSessionResponse>;
    logoutAccount: (csrfToken: string, signal?: AbortSignal) => Promise<void>;
    deleteAccount: (csrfToken: string, signal?: AbortSignal) => Promise<void>;
    getAccountIncidents: ReturnType<
        typeof createSharedWebApiClient
    >['getAccountIncidents'];
    claimIncident: ReturnType<typeof createSharedWebApiClient>['claimIncident'];
    getAccountMemories: ReturnType<
        typeof createSharedWebApiClient
    >['getAccountMemories'];
    addAccountMemory: ReturnType<
        typeof createSharedWebApiClient
    >['addAccountMemory'];
    updateAccountMemory: ReturnType<
        typeof createSharedWebApiClient
    >['updateAccountMemory'];
    forgetAccountMemory: ReturnType<
        typeof createSharedWebApiClient
    >['forgetAccountMemory'];
    exchangeDiscordConnection: ReturnType<
        typeof createSharedWebApiClient
    >['exchangeDiscordConnection'];
    getDiscordConnectionState: ReturnType<
        typeof createSharedWebApiClient
    >['getDiscordConnectionState'];
    getAccountDiscordStatus: ReturnType<
        typeof createSharedWebApiClient
    >['getAccountDiscordStatus'];
    disconnectAccountDiscord: ReturnType<
        typeof createSharedWebApiClient
    >['disconnectAccountDiscord'];
    consentDiscordConnection: ReturnType<
        typeof createSharedWebApiClient
    >['consentDiscordConnection'];
    cancelDiscordConnection: ReturnType<
        typeof createSharedWebApiClient
    >['cancelDiscordConnection'];
    getTrace: (
        responseId: string,
        signal?: AbortSignal
    ) => Promise<ApiJsonResult<GetTraceResponse | GetTraceStaleResponse>>;
    getResponseVersions: (
        responseId: string,
        signal?: AbortSignal
    ) => Promise<
        ApiJsonResult<
            GetResponseVersionsResponse | GetResponseVersionsStaleResponse
        >
    >;
    createPublicResponse: ReturnType<
        typeof createSharedWebApiClient
    >['createPublicResponse'];
    getPublicResponse: ReturnType<
        typeof createSharedWebApiClient
    >['getPublicResponse'];
    revokePublicResponse: ReturnType<
        typeof createSharedWebApiClient
    >['revokePublicResponse'];
};

// Keep this thin local wrapper so web can add surface-specific behavior later
// (telemetry, headers, retries, or method overrides) without changing imports.
export const createWebApiClient = (
    options: CreateWebApiClientOptions = {}
): WebApiClient => {
    const shared = createSharedWebApiClient({
        ...options,
        clientErrorName: options.clientErrorName ?? 'ApiClientError',
    });

    const chatQuestion = shared.chatQuestion;
    const getRuntimeConfig = shared.getRuntimeConfig;
    const getAuthSession = shared.getAuthSession;
    const logoutAccount = shared.logoutAccount;
    const deleteAccount = shared.deleteAccount;
    const getAccountIncidents = shared.getAccountIncidents;
    const claimIncident = shared.claimIncident;
    const getAccountMemories = shared.getAccountMemories;
    const addAccountMemory = shared.addAccountMemory;
    const updateAccountMemory = shared.updateAccountMemory;
    const forgetAccountMemory = shared.forgetAccountMemory;
    const exchangeDiscordConnection = shared.exchangeDiscordConnection;
    const getDiscordConnectionState = shared.getDiscordConnectionState;
    const getAccountDiscordStatus = shared.getAccountDiscordStatus;
    const disconnectAccountDiscord = shared.disconnectAccountDiscord;
    const consentDiscordConnection = shared.consentDiscordConnection;
    const cancelDiscordConnection = shared.cancelDiscordConnection;
    const getTrace = shared.getTrace;
    const getResponseVersions = shared.getResponseVersions;
    const createPublicResponse = shared.createPublicResponse;
    const getPublicResponse = shared.getPublicResponse;
    const revokePublicResponse = shared.revokePublicResponse;

    return {
        requestJson: shared.requestJson,
        chatQuestion,
        getRuntimeConfig,
        getAuthSession,
        logoutAccount,
        deleteAccount,
        getAccountIncidents,
        claimIncident,
        getAccountMemories,
        addAccountMemory,
        updateAccountMemory,
        forgetAccountMemory,
        exchangeDiscordConnection,
        getDiscordConnectionState,
        getAccountDiscordStatus,
        disconnectAccountDiscord,
        consentDiscordConnection,
        cancelDiscordConnection,
        getTrace,
        getResponseVersions,
        createPublicResponse,
        getPublicResponse,
        revokePublicResponse,
    };
};

export const api = createWebApiClient();

/**
 * Public API boundary helper for posting chat requests to backend chat routes.
 * Delegates to internal api.chatQuestion and supports optional turnstileToken
 * and abort signal. Returns PostChatResponse.
 */
export const chatQuestion = (
    request: PostChatRequest,
    options?: ChatQuestionOptions
): Promise<PostChatResponse> => api.chatQuestion(request, options);

/**
 * Public API boundary helper for loading web runtime configuration from backend.
 * Delegates to internal api.getRuntimeConfig and accepts an optional abort
 * signal. Returns GetRuntimeConfigResponse.
 */
export const getRuntimeConfig = (
    signal?: AbortSignal
): Promise<GetRuntimeConfigResponse> => api.getRuntimeConfig(signal);

/**
 * Public API boundary helper for reading backend-owned account session state.
 */
export const getAuthSession = (
    signal?: AbortSignal
): Promise<GetAuthSessionResponse> => api.getAuthSession(signal);

/**
 * Public API boundary helper for revoking the current local account session.
 */
export const logoutAccount = (
    csrfToken: string,
    signal?: AbortSignal
): Promise<void> => api.logoutAccount(csrfToken, signal);

export const deleteAccount = (csrfToken: string, signal?: AbortSignal) =>
    api.deleteAccount(csrfToken, signal);

export const getAccountIncidents = (signal?: AbortSignal) =>
    api.getAccountIncidents(signal);
export const claimIncident = (claimCode: string, csrfToken: string) =>
    api.claimIncident(claimCode, csrfToken);
export const getAccountMemories = (signal?: AbortSignal) =>
    api.getAccountMemories(signal);
export const addAccountMemory = (text: string, csrfToken: string) =>
    api.addAccountMemory(text, csrfToken);
/** @api.operationId: patchAccountMemory @api.path: PATCH /api/account/memories/{memoryId} */
export const updateAccountMemory = (
    memoryId: string,
    text: string,
    csrfToken: string
) => api.updateAccountMemory(memoryId, text, csrfToken);
export const forgetAccountMemory = (memoryId: string, csrfToken: string) =>
    api.forgetAccountMemory(memoryId, csrfToken);

export const exchangeDiscordConnection = (capability: string) =>
    api.exchangeDiscordConnection(capability);
export const getDiscordConnectionState = (signal?: AbortSignal) =>
    api.getDiscordConnectionState(signal);
/** @api.operationId: getAccountDiscordConnection @api.path: GET /api/account/discord-connection */
export const getAccountDiscordStatus = (signal?: AbortSignal) =>
    api.getAccountDiscordStatus(signal);
export const disconnectAccountDiscord = (csrfToken: string) =>
    api.disconnectAccountDiscord(csrfToken);
export const consentDiscordConnection = (csrfToken: string) =>
    api.consentDiscordConnection(csrfToken);
export const cancelDiscordConnection = (csrfToken: string) =>
    api.cancelDiscordConnection(csrfToken);

/**
 * Public API boundary helper for fetching trace details for a response id.
 * Delegates to internal api.getTrace and supports optional abort signal for
 * cancellation. Returns ApiJsonResult<GetTraceResponse | GetTraceStaleResponse>.
 */
export const getTrace = (
    responseId: string,
    signal?: AbortSignal
): Promise<ApiJsonResult<GetTraceResponse | GetTraceStaleResponse>> =>
    api.getTrace(responseId, signal);

/** Loads model-produced response candidate history for the trace viewer only. */
export const getResponseVersions = (
    responseId: string,
    signal?: AbortSignal
): Promise<
    ApiJsonResult<
        GetResponseVersionsResponse | GetResponseVersionsStaleResponse
    >
> => api.getResponseVersions(responseId, signal);

/** Loads the execution report for a response. */
/**
 * @api.operationId: getOperatorExecution
 * @api.path: GET /api/admin/executions/{responseId}
 */
export const getExecutionReport = async (
    responseId: string,
    signal?: AbortSignal
): Promise<ExecutionReportResponse> => {
    const response = await api.requestJson<ExecutionReportResponse>(
        `/api/admin/executions/${encodeURIComponent(responseId)}`,
        { method: 'GET', signal, cache: 'no-store' }
    );
    return response.data;
};

export type { ApiClientError, ApiErrorResponse };
