/**
 * @description: Serves one bounded execution record to an authorized account operator.
 * @footnote-scope: interface
 * @footnote-module: OperatorExecutionHandler
 * @footnote-risk: high - Authorization mistakes could expose private execution details.
 * @footnote-ethics: high - Execution records can reveal sensitive operational context.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecutionReportDebugCapture } from '@footnote/contracts/web';
import { createAdminAuthorizationService } from '../services/adminAuthorization.js';
import { boundAndRedactDebugText } from '../services/modelDebugCapture.js';
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
        const pathMatch = /^\/api\/admin\/executions\/([^/]+)\/?$/u.exec(
            new URL(req.url ?? '/', 'http://localhost').pathname
        );
        const responseId = pathMatch?.[1];
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
            let modelDebugCaptures: ExecutionReportDebugCapture[] = [];
            try {
                const storedCaptures =
                    await traceStore.retrieveModelDebugCaptures(responseId);
                const candidateIds = new Set(
                    storedCaptures.flatMap((capture) =>
                        capture.outputCandidateId === undefined
                            ? []
                            : [capture.outputCandidateId]
                    )
                );
                let candidateTextById = new Map<string, string>();
                if (candidateIds.size > 0) {
                    try {
                        const candidates =
                            await traceStore.retrieveResponseCandidates(
                                responseId
                            );
                        candidateTextById = new Map(
                            candidates
                                .filter((candidate) =>
                                    candidateIds.has(candidate.id)
                                )
                                .map((candidate) => [
                                    candidate.id,
                                    candidate.text,
                                ])
                        );
                    } catch {
                        // Missing candidate text is debug-only and must not hide the report.
                    }
                }
                modelDebugCaptures = storedCaptures.map((capture) => {
                    const candidateText = capture.outputCandidateId
                        ? candidateTextById.get(capture.outputCandidateId)
                        : undefined;
                    const boundedCandidate =
                        candidateText === undefined
                            ? undefined
                            : boundAndRedactDebugText(candidateText);
                    return {
                        ...capture,
                        ...(boundedCandidate !== undefined && {
                            outputText: boundedCandidate.text,
                            outputRedacted:
                                capture.outputRedacted ||
                                boundedCandidate.redacted,
                            outputTruncated:
                                capture.outputTruncated ||
                                boundedCandidate.truncated,
                        }),
                        ...(capture.outputCandidateId !== undefined &&
                            candidateText === undefined && {
                                outputUnavailable: true,
                            }),
                    };
                });
            } catch {
                handlerLogger.warn('operator.execution.debug.read', {
                    decision: 'unavailable',
                    responseId,
                });
            }
            sendJson(res, 200, {
                responseId: metadata.responseId,
                workflow: metadata.workflow,
                modelDebugCaptures,
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
