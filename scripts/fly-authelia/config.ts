/**
 * @description: Parses Footnote Fly defaults and renders the inspectable Authelia configuration artifacts.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaConfig
 * @footnote-risk: high - Configuration rendering defines provider availability, redirects, and persistent storage.
 * @footnote-ethics: high - Explicit provider policy and callback rendering protect operator consent and account identity.
 */

import crypto from 'node:crypto';
import { AUTHELIA_IMAGE } from './constants.js';
import type { ServerDefaults } from './types.js';

const parseTomlString = (source: string, key: string): string | null => {
    const match = source.match(
        new RegExp(`^\\s*${key}\\s*=\\s*['"]([^'"]+)['"]`, 'm')
    );
    return match?.[1] ?? null;
};

export const parseServerDefaults = (source: string): ServerDefaults => {
    const footnoteAppName = parseTomlString(source, 'app');
    const primaryRegion = parseTomlString(source, 'primary_region');
    if (!footnoteAppName || !primaryRegion) {
        throw new Error(
            'server.toml must define both app and primary_region before Authelia setup.'
        );
    }

    const allowedOrigins = parseTomlString(source, 'ALLOWED_ORIGINS');
    const publicUrl =
        allowedOrigins?.split(',')[0]?.trim() ||
        `https://${footnoteAppName}.fly.dev`;
    return { footnoteAppName, primaryRegion, publicUrl };
};

export const validateHttpsUrl = (value: string, label: string): string => {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${label} must be a valid HTTPS URL.`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`${label} must use HTTPS.`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`${label} must not include credentials.`);
    }
    if (parsed.pathname !== '/') {
        throw new Error(`${label} must be an HTTPS origin without a path.`);
    }
    if (parsed.search || parsed.hash) {
        throw new Error(
            `${label} must not include a query string or fragment.`
        );
    }
    return parsed.toString().replace(/\/$/, '');
};

export const getCallbackUri = (publicUrl: string): string =>
    `${validateHttpsUrl(publicUrl, 'Footnote public URL')}/api/auth/callback`;

export const parseDigest = (output: string): string => {
    const digest = output.match(/Digest:\s*(\$argon2\S+)/i)?.[1];
    if (!digest) {
        throw new Error('Pinned Authelia CLI did not return an Argon2 digest.');
    }
    return digest;
};

export const parseRandomPasswordAndDigest = (
    output: string
): { password: string; digest: string } => {
    const password = output.match(/Random Password:\s*(\S+)/)?.[1];
    if (!password) {
        throw new Error(
            'Pinned Authelia CLI did not return a generated client secret.'
        );
    }
    return { password, digest: parseDigest(output) };
};

export const randomSecret = (bytes = 32): string =>
    crypto.randomBytes(bytes).toString('base64url');

export const createSigningKey = (): string => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    return privateKey;
};

const shellSafeYaml = (value: string): string =>
    `'${value.replace(/'/g, "''")}'`;

export const renderConfiguration = (input: {
    issuerUrl: string;
    redirectUri: string;
    clientSecretHash: string;
    cookieDomain: string;
}): string => `server:
  address: 'tcp://:9091/'
  disable_healthcheck: false

log:
  level: 'info'
  keep_stdout: true

authentication_backend:
  file:
    path: '/config/users.yml'

identity_validation:
  reset_password:
    jwt_secret: '\${AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET}'

access_control:
  default_policy: 'one_factor'

session:
  name: 'authelia_session'
  secret: '\${AUTHELIA_SESSION_SECRET}'
  cookies:
    - domain: ${shellSafeYaml(input.cookieDomain)}
      authelia_url: ${shellSafeYaml(input.issuerUrl)}

storage:
  encryption_key: '\${AUTHELIA_STORAGE_ENCRYPTION_KEY}'
  local:
    path: '/data/authelia.sqlite3'

notifier:
  disable_startup_check: false
  filesystem:
    filename: '/data/notifications.txt'

identity_providers:
  oidc:
    hmac_secret: '\${AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET}'
    issuer_private_key: '\${AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY}'
    clients:
      - client_id: 'footnote'
        client_name: 'Footnote'
        client_secret: ${shellSafeYaml(input.clientSecretHash)}
        public: false
        authorization_policy: 'one_factor'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - ${shellSafeYaml(input.redirectUri)}
        scopes:
          - 'openid'
          - 'profile'
        response_types:
          - 'code'
        grant_types:
          - 'authorization_code'
        token_endpoint_auth_method: 'client_secret_basic'
`;

export const renderUsers = (input: {
    username: string;
    displayName: string;
    email: string;
    passwordHash: string;
}): string => `users:
  ${input.username}:
    displayname: ${shellSafeYaml(input.displayName)}
    password: ${shellSafeYaml(input.passwordHash)}
    email: ${shellSafeYaml(input.email)}
    groups:
      - 'administrators'
`;

export const renderManifest = (input: {
    authAppName: string;
    region: string;
    configurationPath: string;
    usersPath: string;
}): string => `app = '${input.authAppName}'
primary_region = '${input.region}'

[build]
  image = '${AUTHELIA_IMAGE}'

[env]
  AUTHELIA_CONFIG = '/config/configuration.yml'

[[files]]
  guest_path = '/config/configuration.yml'
  local_path = '${input.configurationPath.replace(/'/g, "''")}'

[[files]]
  guest_path = '/config/users.yml'
  local_path = '${input.usersPath.replace(/'/g, "''")}'

[[services]]
  internal_port = 9091
  protocol = 'tcp'
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
  max_machines_running = 1

  [[services.ports]]
    port = 80
    handlers = ['http']
    force_https = true

  [[services.ports]]
    port = 443
    handlers = ['tls', 'http']

  [[services.http_checks]]
    interval = '15s'
    timeout = '5s'
    method = 'GET'
    path = '/api/health'

[[mounts]]
  source = 'authelia_data'
  destination = '/data'

[[vm]]
  cpu_kind = 'shared'
  cpus = 1
  memory = '256mb'
`;
