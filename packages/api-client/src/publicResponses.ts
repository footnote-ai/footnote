/**
 * @description: Provides the narrow create/read/revoke transport for explicit public response pages.
 * @footnote-scope: utility
 * @footnote-module: PublicResponsesApi
 * @footnote-risk: medium - Request methods carry short-lived publication capabilities.
 * @footnote-ethics: high - Client transport must not widen the backend publication boundary.
 */
import type {
    ApiErrorResponse,
    CreatePublicResponseRequest,
    CreatePublicResponseResponse,
    GetPublicResponseResponse,
    RevokePublicResponseRequest,
    RevokePublicResponseResponse,
} from '@footnote/contracts/web';
import {
    ApiErrorResponseSchema,
    CreatePublicResponseResponseSchema,
    GetPublicResponseResponseSchema,
    RevokePublicResponseResponseSchema,
    createSchemaResponseValidator,
} from '@footnote/contracts/web';
import type { ApiJsonResult, ApiRequester } from './client.js';

export type PublicResponsesApi = {
    createPublicResponse: (
        request: CreatePublicResponseRequest,
        options?: { signal?: AbortSignal }
    ) => Promise<CreatePublicResponseResponse>;
    getPublicResponse: (
        publicId: string,
        options?: { signal?: AbortSignal }
    ) => Promise<ApiJsonResult<GetPublicResponseResponse | ApiErrorResponse>>;
    revokePublicResponse: (
        publicId: string,
        request: RevokePublicResponseRequest,
        options?: { signal?: AbortSignal }
    ) => Promise<
        ApiJsonResult<RevokePublicResponseResponse | ApiErrorResponse>
    >;
};

const PublicResponseReadResultSchema = GetPublicResponseResponseSchema.or(
    ApiErrorResponseSchema
);

export const createPublicResponsesApi = (
    requestJson: ApiRequester
): PublicResponsesApi => {
    /** @api.operationId: createPublicResponse @api.path: POST /api/public-responses */
    const createPublicResponse = async (
        request: CreatePublicResponseRequest,
        options?: { signal?: AbortSignal }
    ): Promise<CreatePublicResponseResponse> => {
        const response = await requestJson<CreatePublicResponseResponse>(
            '/api/public-responses',
            {
                method: 'POST',
                body: request,
                signal: options?.signal,
                validateResponse: createSchemaResponseValidator(
                    CreatePublicResponseResponseSchema
                ),
            }
        );
        return response.data;
    };

    /** @api.operationId: getPublicResponse @api.path: GET /api/public-responses/{publicId} */
    const getPublicResponse = (
        publicId: string,
        options?: { signal?: AbortSignal }
    ): Promise<ApiJsonResult<GetPublicResponseResponse | ApiErrorResponse>> =>
        requestJson<GetPublicResponseResponse | ApiErrorResponse>(
            `/api/public-responses/${encodeURIComponent(publicId)}`,
            {
                method: 'GET',
                signal: options?.signal,
                acceptedStatusCodes: [404, 410],
                validateResponse: createSchemaResponseValidator(
                    PublicResponseReadResultSchema
                ),
            }
        );

    /** @api.operationId: revokePublicResponse @api.path: DELETE /api/public-responses/{publicId} */
    const revokePublicResponse = (
        publicId: string,
        request: RevokePublicResponseRequest,
        options?: { signal?: AbortSignal }
    ): Promise<
        ApiJsonResult<RevokePublicResponseResponse | ApiErrorResponse>
    > =>
        requestJson<RevokePublicResponseResponse | ApiErrorResponse>(
            `/api/public-responses/${encodeURIComponent(publicId)}`,
            {
                method: 'DELETE',
                body: request,
                signal: options?.signal,
                acceptedStatusCodes: [404, 410],
                validateResponse: createSchemaResponseValidator(
                    RevokePublicResponseResponseSchema.or(
                        ApiErrorResponseSchema
                    )
                ),
            }
        );

    return { createPublicResponse, getPublicResponse, revokePublicResponse };
};
