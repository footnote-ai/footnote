/**
 * @description: Tracks first-setup bootstrap code and short-lived setup sessions for missing footnote.yaml flows.
 * @footnote-scope: core
 * @footnote-module: SetupBootstrapService
 * @footnote-risk: high - Auth/session mistakes can expose privileged settings write paths during first setup.
 * @footnote-ethics: high - First-setup access controls shape operator authority and governance-sensitive configuration changes.
 */

import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const SETUP_SESSION_COOKIE_NAME = 'footnote_setup_session';
export const SETUP_MISSING_IF_MATCH_ETAG = '"footnote-settings-missing"';

const DEFAULT_BOOTSTRAP_CODE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1_000;
const BOOTSTRAP_CODE_PREFIX = 'fn_setup_';

type SetupBootstrapCode = {
    code: string;
    expiresAt: string;
};

export type SetupSessionRecord = {
    sessionId: string;
    csrfToken: string;
    expiresAt: string;
};

type SetupSessionExchangeResult =
    | {
          ok: true;
          session: SetupSessionRecord;
      }
    | {
          ok: false;
          reason: 'setup_not_required' | 'invalid_code';
      };

type CreateSetupBootstrapServiceDeps = {
    settingsPath: string;
    now?: () => number;
    bootstrapCodeTtlMs?: number;
    sessionTtlMs?: number;
    randomToken?: (byteLength: number) => string;
};

export type SetupBootstrapService = {
    isSetupRequiredNow: () => Promise<boolean>;
    issueOrGetActiveCode: () => Promise<SetupBootstrapCode | null>;
    exchangeCodeForSession: (
        code: string
    ) => Promise<SetupSessionExchangeResult>;
    validateSetupSession: (
        sessionId: string
    ) => Promise<SetupSessionRecord | null>;
    clearSetupSession: (sessionId: string) => void;
};

type ActiveBootstrapCode = {
    code: string;
    expiresAtMs: number;
    used: boolean;
};

const readSingleHeader = (
    header: string | string[] | undefined
): string | null => {
    if (!header) {
        return null;
    }
    const value = Array.isArray(header) ? header[0] : header;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const buildCookie = ({
    name,
    value,
    maxAgeMs,
    secure,
}: {
    name: string;
    value: string;
    maxAgeMs: number;
    secure: boolean;
}): string => {
    const maxAgeSeconds = Math.max(0, Math.floor(maxAgeMs / 1_000));
    const parts = [
        `${name}=${value}`,
        'Path=/',
        `Max-Age=${maxAgeSeconds}`,
        'HttpOnly',
        'SameSite=Strict',
    ];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
};

export const buildSetupSessionCookie = ({
    sessionId,
    maxAgeMs,
    secure,
}: {
    sessionId: string;
    maxAgeMs: number;
    secure: boolean;
}): string =>
    buildCookie({
        name: SETUP_SESSION_COOKIE_NAME,
        value: sessionId,
        maxAgeMs,
        secure,
    });

export const buildSetupSessionClearCookie = (secure: boolean): string =>
    buildCookie({
        name: SETUP_SESSION_COOKIE_NAME,
        value: '',
        maxAgeMs: 0,
        secure,
    });

export const readSetupSessionIdFromRequest = (
    req: IncomingMessage
): string | null => {
    const cookieHeader = readSingleHeader(req.headers.cookie);
    if (!cookieHeader) {
        return null;
    }
    const segments = cookieHeader.split(';');
    for (const segment of segments) {
        const [rawName, ...valueParts] = segment.split('=');
        if (rawName?.trim() !== SETUP_SESSION_COOKIE_NAME) {
            continue;
        }
        const value = valueParts.join('=').trim();
        return value.length > 0 ? value : null;
    }
    return null;
};

export const requestUsesSecureTransport = (req: IncomingMessage): boolean => {
    const forwardedProto = readSingleHeader(req.headers['x-forwarded-proto']);
    if (forwardedProto) {
        const firstProto = forwardedProto.split(',')[0]?.trim().toLowerCase();
        if (firstProto === 'https') {
            return true;
        }
    }
    const socketWithTls = req.socket as typeof req.socket & {
        encrypted?: boolean;
    };
    return socketWithTls.encrypted === true;
};

export const createSetupBootstrapService = ({
    settingsPath,
    now = () => Date.now(),
    bootstrapCodeTtlMs = DEFAULT_BOOTSTRAP_CODE_TTL_MS,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    randomToken = (byteLength: number) =>
        randomBytes(byteLength).toString('hex'),
}: CreateSetupBootstrapServiceDeps): SetupBootstrapService => {
    let activeBootstrapCode: ActiveBootstrapCode | null = null;
    const sessions = new Map<
        string,
        SetupSessionRecord & { expiresAtMs: number }
    >();

    const pruneExpiredSessions = (): void => {
        const nowMs = now();
        for (const [sessionId, session] of sessions) {
            if (session.expiresAtMs <= nowMs) {
                sessions.delete(sessionId);
            }
        }
    };

    const isSetupRequiredNow = async (): Promise<boolean> => {
        try {
            await fs.promises.access(settingsPath, fs.constants.F_OK);
            return false;
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === 'ENOENT') {
                return true;
            }
            return false;
        }
    };

    const issueOrGetActiveCode =
        async (): Promise<SetupBootstrapCode | null> => {
            if (!(await isSetupRequiredNow())) {
                activeBootstrapCode = null;
                return null;
            }
            const nowMs = now();
            if (
                activeBootstrapCode &&
                activeBootstrapCode.used === false &&
                activeBootstrapCode.expiresAtMs > nowMs
            ) {
                return {
                    code: activeBootstrapCode.code,
                    expiresAt: new Date(
                        activeBootstrapCode.expiresAtMs
                    ).toISOString(),
                };
            }
            const expiresAtMs = nowMs + bootstrapCodeTtlMs;
            const code = `${BOOTSTRAP_CODE_PREFIX}${randomToken(24)}`;
            activeBootstrapCode = {
                code,
                expiresAtMs,
                used: false,
            };
            return {
                code,
                expiresAt: new Date(expiresAtMs).toISOString(),
            };
        };

    const exchangeCodeForSession = async (
        code: string
    ): Promise<SetupSessionExchangeResult> => {
        if (!(await isSetupRequiredNow())) {
            activeBootstrapCode = null;
            return { ok: false, reason: 'setup_not_required' };
        }
        const nowMs = now();
        if (!activeBootstrapCode || activeBootstrapCode.expiresAtMs <= nowMs) {
            activeBootstrapCode = null;
            return { ok: false, reason: 'invalid_code' };
        }
        if (activeBootstrapCode.used || code !== activeBootstrapCode.code) {
            return { ok: false, reason: 'invalid_code' };
        }
        activeBootstrapCode.used = true;

        pruneExpiredSessions();
        const expiresAtMs = nowMs + sessionTtlMs;
        const sessionId = randomToken(24);
        const csrfToken = randomToken(24);
        const session = {
            sessionId,
            csrfToken,
            expiresAtMs,
            expiresAt: new Date(expiresAtMs).toISOString(),
        };
        sessions.set(sessionId, session);
        return {
            ok: true,
            session: {
                sessionId,
                csrfToken,
                expiresAt: session.expiresAt,
            },
        };
    };

    const validateSetupSession = async (
        sessionId: string
    ): Promise<SetupSessionRecord | null> => {
        if (!(await isSetupRequiredNow())) {
            sessions.clear();
            return null;
        }
        pruneExpiredSessions();
        const session = sessions.get(sessionId);
        if (!session) {
            return null;
        }
        return {
            sessionId: session.sessionId,
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
        };
    };

    const clearSetupSession = (sessionId: string): void => {
        sessions.delete(sessionId);
    };

    return {
        isSetupRequiredNow,
        issueOrGetActiveCode,
        exchangeCodeForSession,
        validateSetupSession,
        clearSetupSession,
    };
};
