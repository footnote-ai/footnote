/**
 * @description: Typed trusted transport for Discord-owned account connection commands.
 * @footnote-scope: interface
 * @footnote-module: DiscordAccountApi
 * @footnote-risk: high - This client transports the trusted Discord identity.
 * @footnote-ethics: high - Keeping identity inputs at the adapter boundary prevents chat context becoming ownership.
 */
import type {
    DiscordAccountConfirmRequest,
    DiscordAccountConfirmResponse,
    DiscordAccountStartRequest,
    DiscordAccountStartResponse,
    DiscordAccountStatusRequest,
    DiscordAccountStatusResponse,
} from '@footnote/contracts/web';
import {
    DiscordAccountConfirmResponseSchema,
    DiscordAccountStartResponseSchema,
    DiscordAccountStatusResponseSchema,
    createSchemaResponseValidator,
} from '@footnote/contracts/web/schemas';
import type { ApiRequester } from './client.js';
import type { ApiResponseValidator } from '@footnote/contracts/web/client-core';

export type DiscordAccountApi = {
    startDiscordAccountConnection: (
        request: DiscordAccountStartRequest
    ) => Promise<DiscordAccountStartResponse>;
    getDiscordAccountStatus: (
        request: DiscordAccountStatusRequest
    ) => Promise<DiscordAccountStatusResponse>;
    confirmDiscordAccountConnection: (
        request: DiscordAccountConfirmRequest
    ) => Promise<DiscordAccountConfirmResponse>;
};

/** Creates the thin trusted Discord-account transport used by the bot adapter. */
export const createDiscordAccountApi = (
    requestJson: ApiRequester,
    traceApiToken?: string
): DiscordAccountApi => {
    const headers: Record<string, string> = {};
    if (traceApiToken) headers['X-Trace-Token'] = traceApiToken;
    const post = async <T>(
        path: string,
        body: object,
        validateResponse: ApiResponseValidator<T>
    ): Promise<T> => {
        const response = await requestJson<T>(path, {
            method: 'POST',
            headers,
            body,
            validateResponse,
        });
        return response.data;
    };
    /** @api.operationId: postInternalDiscordAccountStart @api.path: POST /api/internal/discord/account/start */
    const startDiscordAccountConnection = (
        request: DiscordAccountStartRequest
    ): Promise<DiscordAccountStartResponse> =>
        post(
            '/api/internal/discord/account/start',
            request,
            createSchemaResponseValidator(DiscordAccountStartResponseSchema)
        );
    /** @api.operationId: postInternalDiscordAccountStatus @api.path: POST /api/internal/discord/account/status */
    const getDiscordAccountStatus = (
        request: DiscordAccountStatusRequest
    ): Promise<DiscordAccountStatusResponse> =>
        post(
            '/api/internal/discord/account/status',
            request,
            createSchemaResponseValidator(DiscordAccountStatusResponseSchema)
        );
    /** @api.operationId: postInternalDiscordAccountConfirm @api.path: POST /api/internal/discord/account/confirm */
    const confirmDiscordAccountConnection = (
        request: DiscordAccountConfirmRequest
    ): Promise<DiscordAccountConfirmResponse> =>
        post(
            '/api/internal/discord/account/confirm',
            request,
            createSchemaResponseValidator(DiscordAccountConfirmResponseSchema)
        );
    return {
        startDiscordAccountConnection,
        getDiscordAccountStatus,
        confirmDiscordAccountConnection,
    };
};
