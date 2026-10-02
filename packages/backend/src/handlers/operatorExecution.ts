/**
 * @description: Serves one bounded execution record to an authorized account operator.
 * @footnote-scope: interface
 * @footnote-module: OperatorExecutionHandler
 * @footnote-risk: high - Authorization mistakes could expose private execution details.
 * @footnote-ethics: high - Execution records can reveal sensitive operational context.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAdminAuthorizationService } from '../services/adminAuthorization.js';
import type { AccountAuthService } from '../services/accountAuth.js';
import type { TraceStore } from '../storage/traces/traceStore.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { readAccountSession } from './accountRequest.js';
import { sendJson } from './chatResponses.js';

type OperatorExecutionLogger = {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
};

/** @api.operationId: getOperatorExecution @api.path: GET /api/admin/executions/{responseId} */
export const createOperatorExecutionHandler = ({
    accountAuthService,
    traceStore,
    logRequest,
    handlerLogger = defaultLogger,
}: {
    accountAuthService: AccountAuthService;
    traceStore: TraceStore | null;
    logRequest: (
        req: IncomingMessage,
        res: ServerResponse,
        extra?: string
    ) => void;
    handlerLogger?: OperatorExecutionLogger;
}): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
    const authorization = createAdminAuthorizationService({
        accountAuthService,
    });

    return async (req, res): Promise<void> => {
        const responseId = new URL(
            req.url ?? '/',
            'http://localhost'
        ).pathname.match(/^\/api\/admin\/executions\/([^/]+)\/?$/)?.[1];
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET' || !responseId) {
            sendJson(res, 400, { error: 'Invalid execution request' });
            logRequest(req, res, 'operator execution invalid-request');
            return;
        }

        const session = readAccountSession(req, accountAuthService);
        if (!session) {
            handlerLogger.warn('operator.execution.read', {
                decision: 'denied',
                reason: 'sign-in-required',
                responseId,
            });
            sendJson(res, 401, { error: 'Sign in required' });
            logRequest(req, res, 'operator execution signed-out');
            return;
        }
        const operator = authorization.authorizeAccountSession(
            session.sessionId
        );
        if (!operator) {
            handlerLogger.warn('operator.execution.read', {
                decision: 'denied',
                reason: 'operator-required',
                responseId,
            });
            sendJson(res, 403, { error: 'Operator access required' });
            logRequest(req, res, 'operator execution forbidden');
            return;
        }

        handlerLogger.info('operator.execution.read', {
            decision: 'allowed',
            actorSource: operator.actorSource,
            actorHash: operator.actorHash,
            responseId,
        });
        if (!traceStore) {
            sendJson(res, 503, { error: 'Execution records unavailable' });
            logRequest(req, res, 'operator execution store-unavailable');
            return;
        }
        try {
            const metadata = await traceStore.retrieve(responseId);
            if (!metadata?.workflow) {
                sendJson(res, 404, { error: 'Execution record not found' });
                logRequest(req, res, 'operator execution not-found');
                return;
            }
            sendJson(res, 200, {
                responseId: metadata.responseId,
                workflow: metadata.workflow,
            });
            logRequest(req, res, 'operator execution success');
        } catch {
            handlerLogger.warn('operator.execution.read', {
                decision: 'failed',
                reason: 'record-unavailable',
                responseId,
            });
            sendJson(res, 500, { error: 'Failed to read execution record' });
            logRequest(req, res, 'operator execution read-error');
        }
    };
};
