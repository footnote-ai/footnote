/**
 * @description: Validates optional OpenID Connect bootstrap configuration for account sign-in.
 * @footnote-scope: utility
 * @footnote-module: AccountAuthConfig
 * @footnote-risk: high - Invalid identity-provider configuration can weaken or disable sign-in.
 * @footnote-ethics: high - Sign-in configuration controls access to account identity.
 */

import { parseCsvEnv, parseOptionalTrimmedString } from '../parsers.js';
import { buildExternalIdentityKey } from '@footnote/contracts';
import type { RuntimeConfig, WarningSink } from '../types.js';

const OIDC_KEYS = [
    'OIDC_ISSUER_URL',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
] as const;

const isLoopbackHostname = (hostname: string): boolean =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

const parseIssuerUrl = (value: string): URL | null => {
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            url.username.length > 0 ||
            url.password.length > 0 ||
            url.search.length > 0 ||
            url.hash.length > 0
        ) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
};

const parseRedirectUrl = (value: string): URL | null => {
    try {
        const url = new URL(value);
        const usesAllowedProtocol =
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
        if (
            !usesAllowedProtocol ||
            url.username.length > 0 ||
            url.password.length > 0 ||
            url.search.length > 0 ||
            url.hash.length > 0 ||
            url.pathname !== '/api/auth/callback'
        ) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
};

const parseAdministratorIdentityKeys = (
    value: string | undefined,
    warn: WarningSink
): string[] => {
    const entries = parseCsvEnv(value, []);
    const keys: string[] = [];

    entries.forEach((entry, index) => {
        const separatorIndex = entry.indexOf('|');
        const issuerValue =
            separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : '';
        const subject =
            separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : '';
        const issuer = issuerValue ? parseIssuerUrl(issuerValue) : null;
        if (!issuer || subject.length === 0) {
            warn(
                `Ignoring invalid OIDC_ADMIN_IDENTITIES entry at position ${index + 1}. Expected issuer|subject.`
            );
            return;
        }
        keys.push(buildExternalIdentityKey(issuer.href, subject));
    });

    return [...new Set(keys)];
};

/**
 * Keeps optional account sign-in fail-open for public Footnote: incomplete or
 * invalid configuration disables only sign-in and emits a secret-safe warning.
 */
export const buildAccountAuthSection = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): RuntimeConfig['accountAuth'] => {
    const values = {
        issuerUrl: parseOptionalTrimmedString(env.OIDC_ISSUER_URL),
        clientId: parseOptionalTrimmedString(env.OIDC_CLIENT_ID),
        clientSecret: parseOptionalTrimmedString(env.OIDC_CLIENT_SECRET),
        redirectUri: parseOptionalTrimmedString(env.OIDC_REDIRECT_URI),
    };
    const presentCount = Object.values(values).filter(Boolean).length;

    if (presentCount === 0) {
        return { enabled: false };
    }

    if (presentCount !== OIDC_KEYS.length) {
        const missingKeys = OIDC_KEYS.filter((key) => {
            const fieldByKey: Record<
                (typeof OIDC_KEYS)[number],
                string | null
            > = {
                OIDC_ISSUER_URL: values.issuerUrl,
                OIDC_CLIENT_ID: values.clientId,
                OIDC_CLIENT_SECRET: values.clientSecret,
                OIDC_REDIRECT_URI: values.redirectUri,
            };
            return fieldByKey[key] === null;
        });
        warn(
            `Account sign-in is disabled because these OIDC values are missing: ${missingKeys.join(', ')}.`
        );
        return { enabled: false };
    }

    const issuer = parseIssuerUrl(values.issuerUrl!);
    const redirect = parseRedirectUrl(values.redirectUri!);
    if (!issuer || !redirect) {
        const invalidKeys = [
            ...(!issuer ? ['OIDC_ISSUER_URL'] : []),
            ...(!redirect ? ['OIDC_REDIRECT_URI'] : []),
        ];
        warn(
            `Account sign-in is disabled because these OIDC URLs are invalid: ${invalidKeys.join(', ')}.`
        );
        return { enabled: false };
    }

    return {
        enabled: true,
        issuerUrl: issuer.href,
        clientId: values.clientId!,
        clientSecret: values.clientSecret!,
        redirectUri: redirect.href,
        secureCookies: redirect.protocol === 'https:',
        administratorIdentityKeys: parseAdministratorIdentityKeys(
            env.OIDC_ADMIN_IDENTITIES,
            warn
        ),
    };
};
