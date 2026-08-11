/**
 * @description: Handles trusted lifecycle requests for backend-owned recoverable tasks.
 * @footnote-scope: interface
 * @footnote-module: RecoverableTaskHandler
 * @footnote-risk: high - Trusted lifecycle controls must not accept unauthenticated task mutations.
 * @footnote-ethics: high - Validation ensures recovery records retain delivery metadata only, never prompts or artifacts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
    PostInternalRecoverableTaskClaimRequestSchema,
    PostInternalRecoverableTaskClaimResponseSchema,
    PostInternalRecoverableTaskCreateRequestSchema,
    PostInternalRecoverableTaskCreateResponseSchema,
    PostInternalRecoverableTaskFinishRequestSchema,
    PostInternalRecoverableTaskFinishResponseSchema,
} from '@footnote/contracts/web/schemas';
import type { SqliteRecoverableTaskStore } from '../storage/recoverableTaskStore.js';
import { SimpleRateLimiter } from '../services/rateLimiter.js';
import { sendJson } from './chatResponses.js';
import {
    parseTrustedBodyWithSchema,
    parseTrustedServiceAuth,
    type TrustedRouteLogRequest,
} from './trustedServiceRequest.js';

type CreateRecoverableTaskHandlerOptions = {
    recoverableTaskStore: SqliteRecoverableTaskStore | null;
    logRequest: TrustedRouteLogRequest;
    maxBodyBytes: number;
    traceApiToken: string | null;
    serviceToken: string | null;
    serviceRateLimiter: SimpleRateLimiter;
};

type RecoverableTaskHandlerMap = {
    handleCreateRecoverableTaskRequest: (
        req: IncomingMessage,
        res: ServerResponse
    ) => Promise<void>;
    handleFinishRecoverableTaskRequest: (
        req: IncomingMessage,
        res: ServerResponse,
        taskId: string
    ) => Promise<void>;
    handleClaimRecoverableTasksRequest: (
        req: IncomingMessage,
        res: ServerResponse
    ) => Promise<void>;
};

export const createRecoverableTaskHandler = ({
    recoverableTaskStore,
    logRequest,
    maxBodyBytes,
    traceApiToken,
    serviceToken,
    serviceRateLimiter,
}: CreateRecoverableTaskHandlerOptions): RecoverableTaskHandlerMap => {
    const authorize = (req: IncomingMessage, res: ServerResponse): boolean => {
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed' });
            logRequest(req, res, 'recoverable task method-not-allowed');
            return false;
        }
        const auth = parseTrustedServiceAuth(
            req,
            { traceApiToken, serviceToken },
            {
                missing: 'recoverable task missing-trusted-auth',
                invalid: 'recoverable task invalid-trusted-auth',
            }
        );
        if (!auth.ok) {
            sendJson(res, auth.statusCode, auth.payload);
            logRequest(req, res, auth.logLabel);
            return false;
        }
        const rateLimitResult = serviceRateLimiter.check(
            `${auth.source}:${auth.rateLimitKey}`
        );
        if (!rateLimitResult.allowed) {
            sendJson(
                res,
                429,
                {
                    error: 'Too many requests from this trusted service',
                    retryAfter: rateLimitResult.retryAfter,
                },
                { 'Retry-After': rateLimitResult.retryAfter.toString() }
            );
            logRequest(req, res, 'recoverable task rate-limited');
            return false;
        }
        if (!recoverableTaskStore) {
            sendJson(res, 503, { error: 'Recoverable task store unavailable' });
            logRequest(req, res, 'recoverable task store-unavailable');
            return false;
        }
        return true;
    };

    /** @api.operationId: postInternalRecoverableTask @api.path: POST /api/internal/recoverable-tasks */
    const handleCreateRecoverableTaskRequest = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        if (!authorize(req, res)) return;
        const request = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'recoverable task create',
            maxBodyBytes,
            safeParse: (value) =>
                PostInternalRecoverableTaskCreateRequestSchema.safeParse(value),
        });
        if (!request || !recoverableTaskStore) return;
        const payload = { task: recoverableTaskStore.create(request) };
        const parsed =
            PostInternalRecoverableTaskCreateResponseSchema.parse(payload);
        sendJson(res, 201, parsed);
        logRequest(req, res, `recoverable task created kind=${request.kind}`);
    };

    /** @api.operationId: postInternalRecoverableTaskFinish @api.path: POST /api/internal/recoverable-tasks/{taskId}/finish */
    const handleFinishRecoverableTaskRequest = async (
        req: IncomingMessage,
        res: ServerResponse,
        taskId: string
    ): Promise<void> => {
        if (!authorize(req, res)) return;
        const request = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'recoverable task finish',
            maxBodyBytes,
            safeParse: (value) =>
                PostInternalRecoverableTaskFinishRequestSchema.safeParse(value),
        });
        if (!request || !recoverableTaskStore) return;
        const payload = recoverableTaskStore.finish(taskId, request.state);
        const parsed =
            PostInternalRecoverableTaskFinishResponseSchema.parse(payload);
        if (!parsed.task) {
            sendJson(res, 404, { error: 'Recoverable task not found' });
            logRequest(req, res, 'recoverable task finish not-found');
            return;
        }
        sendJson(res, 200, parsed);
        logRequest(
            req,
            res,
            `recoverable task finished state=${request.state} changed=${parsed.changed}`
        );
    };

    /** @api.operationId: postInternalRecoverableTaskClaim @api.path: POST /api/internal/recoverable-tasks/claim */
    const handleClaimRecoverableTasksRequest = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        if (!authorize(req, res)) return;
        const request = await parseTrustedBodyWithSchema(req, res, {
            logRequest,
            routeLabel: 'recoverable task claim',
            maxBodyBytes,
            safeParse: (value) =>
                PostInternalRecoverableTaskClaimRequestSchema.safeParse(value),
        });
        if (!request || !recoverableTaskStore) return;
        const payload = {
            tasks: recoverableTaskStore.claimUnfinishedForBotProfile(
                request.botProfileId
            ),
        };
        const parsed =
            PostInternalRecoverableTaskClaimResponseSchema.parse(payload);
        sendJson(res, 200, parsed);
        logRequest(
            req,
            res,
            `recoverable task claim count=${parsed.tasks.length}`
        );
    };

    return {
        handleCreateRecoverableTaskRequest,
        handleFinishRecoverableTaskRequest,
        handleClaimRecoverableTasksRequest,
    };
};
