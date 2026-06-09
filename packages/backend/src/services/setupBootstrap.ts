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
export type SetupBootstrapMode = 'first-run' | 'operator';

const DEFAULT_BOOTSTRAP_CODE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1_000;
const BOOTSTRAP_CODE_PREFIX = 'fn_setup_';

type SetupBootstrapCode = {
    code: string;
    mode: SetupBootstrapMode;
    expiresAt: string;
};

export type SetupSessionRecord = {
    sessionId: string;
    mode: SetupBootstrapMode;
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
    issueOrGetActiveCode: (options?: {
        mode?: SetupBootstrapMode;
    }) => Promise<SetupBootstrapCode | null>;
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
    mode: SetupBootstrapMode;
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
    // activeBootstrapCode is global: issuing a code for a different mode replaces
    // the previous code. Operator requests intentionally take precedence.
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

    const isModeCurrentlyAllowed = async (
        mode: SetupBootstrapMode
    ): Promise<boolean> =>
        mode === 'operator' ? true : await isSetupRequiredNow();

    const issueOrGetActiveCode = async (
        options: { mode?: SetupBootstrapMode } = {}
    ): Promise<SetupBootstrapCode | null> => {
        const mode = options.mode ?? 'first-run';
        if (!(await isModeCurrentlyAllowed(mode))) {
            if (activeBootstrapCode?.mode === mode) {
                activeBootstrapCode = null;
            }
            return null;
        }
        const nowMs = now();
        if (
            activeBootstrapCode &&
            activeBootstrapCode.mode === mode &&
            activeBootstrapCode.used === false &&
            activeBootstrapCode.expiresAtMs > nowMs
        ) {
            return {
                code: activeBootstrapCode.code,
                mode: activeBootstrapCode.mode,
                expiresAt: new Date(
                    activeBootstrapCode.expiresAtMs
                ).toISOString(),
            };
        }
        const expiresAtMs = nowMs + bootstrapCodeTtlMs;
        const code = `${BOOTSTRAP_CODE_PREFIX}${randomToken(24)}`;
        activeBootstrapCode = {
            code,
            mode,
            expiresAtMs,
            used: false,
        };
        return {
            code,
            mode,
            expiresAt: new Date(expiresAtMs).toISOString(),
        };
    };

    const exchangeCodeForSession = async (
        code: string
    ): Promise<SetupSessionExchangeResult> => {
        if (!activeBootstrapCode) {
            if (!(await isSetupRequiredNow())) {
                return { ok: false, reason: 'setup_not_required' };
            }
            return { ok: false, reason: 'invalid_code' };
        }
        if (!(await isModeCurrentlyAllowed(activeBootstrapCode.mode))) {
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
            mode: activeBootstrapCode.mode,
            csrfToken,
            expiresAtMs,
            expiresAt: new Date(expiresAtMs).toISOString(),
        };
        sessions.set(sessionId, session);
        return {
            ok: true,
            session: {
                sessionId,
                mode: session.mode,
                csrfToken,
                expiresAt: session.expiresAt,
            },
        };
    };

    const validateSetupSession = async (
        sessionId: string
    ): Promise<SetupSessionRecord | null> => {
        pruneExpiredSessions();
        const session = sessions.get(sessionId);
        if (!session) {
            return null;
        }
        if (!(await isModeCurrentlyAllowed(session.mode))) {
            sessions.delete(sessionId);
            return null;
        }
        return {
            sessionId: session.sessionId,
            mode: session.mode,
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
