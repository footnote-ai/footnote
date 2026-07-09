/**
 * @description: Serves backend-owned prepared conversation rows for public landing surfaces.
 * @footnote-scope: interface
 * @footnote-module: PreparedConversationsHandler
 * @footnote-risk: medium - Route failures can remove curated examples from the landing page.
 * @footnote-ethics: high - Prepared examples must match stored provenance traces.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GetPreparedLandingConversationsResponse } from '@footnote/contracts/web';
import { sendJson } from './chatResponses.js';
import type { TraceStore } from '../storage/traces/traceStore.js';
import { logger } from '../utils/logger.js';

type LogRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    extra?: string
) => void;

export const createPreparedConversationsHandler = ({
    traceStore,
    logRequest,
}: {
    traceStore: TraceStore | null;
    logRequest: LogRequest;
}) => {
    /**
     * @api.operationId: getPreparedLandingConversations
     * @api.path: GET /api/prepared-conversations/landing
     */
    const handlePreparedLandingConversationsRequest = async (
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> => {
        try {
            if (req.method !== 'GET') {
                sendJson(res, 405, { error: 'Method not allowed' });
                logRequest(
                    req,
                    res,
                    'prepared landing conversations method-not-allowed'
                );
                return;
            }

            if (!traceStore) {
                sendJson(res, 503, {
                    error: 'Prepared conversations unavailable',
                });
                logRequest(
                    req,
                    res,
                    'prepared landing conversations store-unavailable'
                );
                return;
            }

            const conversations =
                await traceStore.listReservedLandingConversations();
            const response: GetPreparedLandingConversationsResponse = {
                conversations,
            };

            sendJson(res, 200, response);
            logRequest(req, res, 'prepared landing conversations success');
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            logger.error(
                `Prepared landing conversations request failed: ${errorMessage}`
            );
            sendJson(res, 500, { error: 'Failed to load prepared examples' });
            logRequest(
                req,
                res,
                `prepared landing conversations error ${errorMessage}`
            );
        }
    };

    return { handlePreparedLandingConversationsRequest };
};
