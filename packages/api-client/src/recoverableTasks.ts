/**
 * @description: Trusted internal recoverable-task lifecycle transport for Discord delivery recovery.
 * @footnote-scope: utility
 * @footnote-module: SharedRecoverableTaskApi
 * @footnote-risk: medium - Lifecycle transport failures should not block the user-facing image flow.
 * @footnote-ethics: high - This API transports only identifiers and timestamps, never prompts or image artifacts.
 */
import type {
    PostInternalRecoverableTaskClaimRequest,
    PostInternalRecoverableTaskClaimResponse,
    PostInternalRecoverableTaskCreateRequest,
    PostInternalRecoverableTaskCreateResponse,
    PostInternalRecoverableTaskFinishRequest,
    PostInternalRecoverableTaskFinishResponse,
} from '@footnote/contracts/web';
import {
    PostInternalRecoverableTaskClaimResponseSchema,
    PostInternalRecoverableTaskCreateResponseSchema,
    PostInternalRecoverableTaskFinishResponseSchema,
    createSchemaResponseValidator,
} from '@footnote/contracts/web/schemas';
import type { ApiRequester } from './client.js';

export type CreateRecoverableTaskApiOptions = { traceApiToken?: string };

export type RecoverableTaskApi = {
    startRecoverableTask: (
        request: PostInternalRecoverableTaskCreateRequest
    ) => Promise<PostInternalRecoverableTaskCreateResponse>;
    completeRecoverableTask: (
        taskId: string
    ) => Promise<PostInternalRecoverableTaskFinishResponse>;
    failRecoverableTask: (
        taskId: string
    ) => Promise<PostInternalRecoverableTaskFinishResponse>;
    claimRecoverableTasks: (
        request: PostInternalRecoverableTaskClaimRequest
    ) => Promise<PostInternalRecoverableTaskClaimResponse>;
};

const buildTrustedHeaders = (traceApiToken?: string): Record<string, string> =>
    traceApiToken ? { 'X-Trace-Token': traceApiToken } : {};

export const createRecoverableTaskApi = (
    requestJson: ApiRequester,
    { traceApiToken }: CreateRecoverableTaskApiOptions
): RecoverableTaskApi => {
    const headers = buildTrustedHeaders(traceApiToken);

    /** @api.operationId: postInternalRecoverableTask @api.path: POST /api/internal/recoverable-tasks */
    const startRecoverableTask = async (
        body: PostInternalRecoverableTaskCreateRequest
    ): Promise<PostInternalRecoverableTaskCreateResponse> =>
        (
            await requestJson<PostInternalRecoverableTaskCreateResponse>(
                '/api/internal/recoverable-tasks',
                {
                    method: 'POST',
                    headers,
                    body,
                    validateResponse: createSchemaResponseValidator(
                        PostInternalRecoverableTaskCreateResponseSchema
                    ),
                }
            )
        ).data;

    const finish = async (
        taskId: string,
        state: 'complete' | 'failed'
    ): Promise<PostInternalRecoverableTaskFinishResponse> => {
        const body: PostInternalRecoverableTaskFinishRequest = { state };
        return (
            await requestJson<PostInternalRecoverableTaskFinishResponse>(
                `/api/internal/recoverable-tasks/${encodeURIComponent(taskId)}/finish`,
                {
                    method: 'POST',
                    headers,
                    body,
                    validateResponse: createSchemaResponseValidator(
                        PostInternalRecoverableTaskFinishResponseSchema
                    ),
                }
            )
        ).data;
    };

    /** @api.operationId: postInternalRecoverableTaskFinish @api.path: POST /api/internal/recoverable-tasks/{taskId}/finish */
    const completeRecoverableTask = (taskId: string) =>
        finish(taskId, 'complete');
    /** @api.operationId: postInternalRecoverableTaskFinish @api.path: POST /api/internal/recoverable-tasks/{taskId}/finish */
    const failRecoverableTask = (taskId: string) => finish(taskId, 'failed');

    /** @api.operationId: postInternalRecoverableTaskClaim @api.path: POST /api/internal/recoverable-tasks/claim */
    const claimRecoverableTasks = async (
        body: PostInternalRecoverableTaskClaimRequest
    ): Promise<PostInternalRecoverableTaskClaimResponse> =>
        (
            await requestJson<PostInternalRecoverableTaskClaimResponse>(
                '/api/internal/recoverable-tasks/claim',
                {
                    method: 'POST',
                    headers,
                    body,
                    validateResponse: createSchemaResponseValidator(
                        PostInternalRecoverableTaskClaimResponseSchema
                    ),
                }
            )
        ).data;

    return {
        startRecoverableTask,
        completeRecoverableTask,
        failRecoverableTask,
        claimRecoverableTasks,
    };
};
