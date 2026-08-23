/**
 * @description: Holds the pinned provider image and managed secret names used by the Fly profile.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaConstants
 * @footnote-risk: medium - Incorrect pins or secret names can provision an unusable identity provider.
 * @footnote-ethics: high - Stable credential ownership names support safe reruns and recovery.
 */

export const AUTHELIA_VERSION = '4.39.20';
export const AUTHELIA_IMAGE_DIGEST =
    'sha256:1b363e9279e742397966333f364e0876ae02bf5c876de73e83af6d48c57ff51b';
export const AUTHELIA_IMAGE = `docker.io/authelia/authelia:${AUTHELIA_VERSION}@${AUTHELIA_IMAGE_DIGEST}`;

export const OIDC_KEYS = [
    'OIDC_ISSUER_URL',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_REDIRECT_URI',
] as const;

export const AUTH_SECRET_NAMES = [
    'AUTHELIA_SESSION_SECRET',
    'AUTHELIA_STORAGE_ENCRYPTION_KEY',
    'AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET',
    'AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET',
    'AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY',
    'AUTHELIA_OIDC_CLIENT_SECRET',
];
