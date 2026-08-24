/**
 * @description: Defines the narrow cookie and header helpers shared by account and admin HTTP boundaries.
 * @footnote-scope: utility
 * @footnote-module: AuthCookies
 * @footnote-risk: high - Cookie parsing or CSRF-header mistakes can weaken session protections.
 * @footnote-ethics: high - These boundaries control account privacy and privileged administration.
 */

import type { IncomingMessage } from 'node:http';

export const ACCOUNT_TRANSACTION_COOKIE_NAME = 'footnote_auth_transaction';
export const ACCOUNT_SESSION_COOKIE_NAME = 'footnote_account_session';
export const AUTH_CSRF_HEADER_NAME = 'x-auth-csrf';

const readSingleHeader = (
    value: string | string[] | undefined
): string | null => {
    if (!value) {
        return null;
    }
    const rawValue = Array.isArray(value) ? value[0] : value;
    const trimmed = rawValue.trim();
    return trimmed.length > 0 ? trimmed : null;
};

/** Reads one opaque cookie value without decoding or interpreting its contents. */
export const readCookieValue = (
    req: IncomingMessage,
    cookieName: string
): string | null => {
    const cookieHeader = readSingleHeader(req.headers.cookie);
    if (!cookieHeader) {
        return null;
    }
    for (const segment of cookieHeader.split(';')) {
        const [rawName, ...rawValue] = segment.split('=');
        if (rawName?.trim() !== cookieName) {
            continue;
        }
        const value = rawValue.join('=').trim();
        return value.length > 0 ? value : null;
    }
    return null;
};
