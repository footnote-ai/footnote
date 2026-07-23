/**
 * @description: Provides structured request logging for backend endpoints.
 * @footnote-scope: utility
 * @footnote-module: RequestLogger
 * @footnote-risk: low - Logging failures reduce observability but do not block requests.
 * @footnote-ethics: medium - Logs must avoid leaking sensitive user data.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from './logger.js';

export type RequestLogLevel = 'debug' | 'error' | 'warn';

export const selectRequestLogLevel = (statusCode: number): RequestLogLevel => {
    if (statusCode >= 500) {
        return 'error';
    }
    if (statusCode >= 400) {
        return 'warn';
    }
    return 'debug';
};

/**
 * Builds a short log entry for monitoring within Fly.io logs.
 */
function logRequest(
    req: IncomingMessage,
    res: ServerResponse,
    extra = ''
): void {
    // --- Timestamp ---
    const timestamp = new Date().toISOString();

    // --- URL sanitization ---
    // Avoid logging chat content or OIDC callback values from query strings.
    let logUrl = req.url;
    if (
        req.url &&
        (req.url.includes('/api/chat') ||
            req.url.includes('/api/auth/callback'))
    ) {
        try {
            const parsedUrl = new URL(req.url, 'http://localhost');
            logUrl = parsedUrl.pathname;
        } catch {
            logUrl = req.url;
        }
    }

    // --- Emit ---
    // Keep format consistent for ingestion into log tooling.
    const message =
        `[${timestamp}] ${req.method} ${logUrl} -> ${res.statusCode} ${extra}`.trim();
    const level = selectRequestLogLevel(res.statusCode);
    if (level === 'error') {
        logger.error(message);
    } else if (level === 'warn') {
        logger.warn(message);
    } else {
        logger.debug(message);
    }
}

export { logRequest };
