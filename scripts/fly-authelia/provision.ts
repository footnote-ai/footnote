/**
 * @description: Orchestrates the optional Authelia profile while keeping credential generation, Fly mutation, and recovery ordering local.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaProvisioning
 * @footnote-risk: high - This workflow creates identity resources and applies the public runtime's OIDC configuration.
 * @footnote-ethics: high - Explicit consent, fail-open ordering, and sanitized state protect account access and operator control.
 */

import path from 'node:path';
import { logger } from '../../packages/discord-bot/src/utils/logger';
import {
    AUTH_SECRET_NAMES,
    AUTHELIA_IMAGE,
    AUTHELIA_VERSION,
    OIDC_KEYS,
} from './constants.js';
import {
    createSigningKey,
    getCallbackUri,
    parseDigest,
    parseRandomPasswordAndDigest,
    parseServerDefaults,
    randomSecret,
    renderConfiguration,
    renderManifest,
    renderUsers,
    validateHttpsUrl,
} from './config.js';
import {
    ensureExistingProfile,
    flyAppExists,
    getSecretNames,
    probeAuthelia,
    requireReplacementConfirmation,
} from './fly.js';
import {
    commandOrThrow,
    readText,
    realPrompt,
    realRunner,
    writeText,
} from './runtime.js';
import { buildSafeState, hasState, loadState, saveState } from './state.js';
import type { Fetcher, ProvisionOptions, CommandRunner } from './types.js';

const validateAdministrator = (
    username: string,
    displayName: string,
    email: string
): void => {
    if (!/^[a-zA-Z0-9_.-]+$/.test(username) || !username) {
        throw new Error(
            'Administrator username must contain only letters, numbers, dot, underscore, or dash.'
        );
    }
    if (!displayName || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new Error(
            'Administrator display name and a valid email are required.'
        );
    }
};

const getFetcher = (): Fetcher => fetch as unknown as Fetcher;

const generateCredentialMaterial = async (input: {
    runner: CommandRunner;
}): Promise<{
    passwordHash: string;
    clientSecret: string;
    clientSecretHash: string;
    authSecrets: Record<string, string>;
}> => {
    logger.info(
        'The pinned Authelia CLI will now prompt for the hidden administrator password twice.'
    );
    const passwordHashOutput = await commandOrThrow(
        input.runner,
        {
            command: 'docker',
            args: [
                'run',
                '--rm',
                '-it',
                AUTHELIA_IMAGE,
                'authelia',
                'crypto',
                'hash',
                'generate',
                'argon2',
            ],
        },
        true
    );
    const passwordHash = parseDigest(passwordHashOutput.stdout);
    const clientSecretOutput = await commandOrThrow(input.runner, {
        command: 'docker',
        args: [
            'run',
            '--rm',
            AUTHELIA_IMAGE,
            'authelia',
            'crypto',
            'hash',
            'generate',
            'argon2',
            '--random',
            '--random.length',
            '48',
            '--random.charset',
            'rfc3986',
        ],
    });
    const { password: clientSecret, digest: clientSecretHash } =
        parseRandomPasswordAndDigest(clientSecretOutput.stdout);
    const signingKey = createSigningKey();
    const authSecrets: Record<string, string> = {
        AUTHELIA_SESSION_SECRET: randomSecret(),
        AUTHELIA_STORAGE_ENCRYPTION_KEY: randomSecret(48),
        AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET:
            randomSecret(48),
        AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET: randomSecret(48),
        AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY: signingKey,
        AUTHELIA_OIDC_CLIENT_SECRET: clientSecret,
    };
    return { passwordHash, clientSecret, clientSecretHash, authSecrets };
};

const validateGeneratedProvider = async (input: {
    runner: CommandRunner;
    stateDirectory: string;
    usersPath: string;
}): Promise<void> => {
    const validationKey = createSigningKey();
    await commandOrThrow(input.runner, {
        command: 'docker',
        args: [
            'run',
            '--rm',
            '--env',
            'AUTHELIA_SESSION_SECRET=validation-session-secret',
            '--env',
            'AUTHELIA_STORAGE_ENCRYPTION_KEY=validation-storage-encryption-key',
            '--env',
            'AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET=validation-reset-password-jwt-secret',
            '--env',
            'AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET=validation-hmac-secret',
            '--env',
            'AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY',
            '--tmpfs',
            '/data',
            '--volume',
            `${input.usersPath}:/data/users.yml:ro`,
            '--volume',
            `${input.stateDirectory}:/config:ro`,
            AUTHELIA_IMAGE,
            'authelia',
            'config',
            'validate',
            '--config',
            '/config/configuration.yml',
        ],
        env: {
            AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY: validationKey,
        },
    });
};

const applyAuthSecrets = async (input: {
    runner: CommandRunner;
    authAppName: string;
    authSecrets: Record<string, string>;
}): Promise<void> => {
    await commandOrThrow(input.runner, {
        command: 'fly',
        args: ['secrets', 'import', '--app', input.authAppName],
        stdin: `${Object.entries(input.authSecrets)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')}\n`,
    });
};

const applyFootnoteSecrets = async (input: {
    runner: CommandRunner;
    footnoteAppName: string;
    issuerUrl: string;
    redirectUri: string;
    clientSecret: string;
}): Promise<void> => {
    await commandOrThrow(input.runner, {
        command: 'fly',
        args: ['secrets', 'import', '--app', input.footnoteAppName],
        stdin: [
            `OIDC_ISSUER_URL=${input.issuerUrl}`,
            'OIDC_CLIENT_ID=footnote',
            `OIDC_CLIENT_SECRET=${input.clientSecret}`,
            `OIDC_REDIRECT_URI=${input.redirectUri}`,
            '',
        ].join('\n'),
    });
};

const provisionFreshProfile = async (input: {
    runner: CommandRunner;
    fetcher: Fetcher;
    stateDirectory: string;
    statePath: string;
    manifestPath: string;
    configurationPath: string;
    usersPath: string;
    authAppName: string;
    footnoteAppName: string;
    region: string;
    issuerUrl: string;
    redirectUri: string;
    username: string;
    displayName: string;
    email: string;
}): Promise<void> => {
    const credentials = await generateCredentialMaterial({
        runner: input.runner,
    });
    const configuration = renderConfiguration({
        issuerUrl: input.issuerUrl,
        redirectUri: input.redirectUri,
        clientSecretHash: credentials.clientSecretHash,
        cookieDomain: new URL(input.issuerUrl).hostname,
    });
    const users = renderUsers({
        username: input.username,
        displayName: input.displayName,
        email: input.email,
        passwordHash: credentials.passwordHash,
    });
    const manifest = renderManifest({
        authAppName: input.authAppName,
        region: input.region,
        configurationPath: input.configurationPath,
        usersPath: input.usersPath,
    });
    await Promise.all([
        writeText(input.configurationPath, configuration),
        writeText(input.usersPath, users),
        writeText(input.manifestPath, manifest),
    ]);
    await validateGeneratedProvider({
        runner: input.runner,
        stateDirectory: input.stateDirectory,
        usersPath: input.usersPath,
    });

    const state = buildSafeState({
        version: 1,
        provider: 'authelia',
        providerVersion: AUTHELIA_VERSION,
        image: AUTHELIA_IMAGE,
        authAppName: input.authAppName,
        footnoteAppName: input.footnoteAppName,
        region: input.region,
        issuerUrl: input.issuerUrl,
        redirectUri: input.redirectUri,
        username: input.username,
        displayName: input.displayName,
        email: input.email,
        passwordHash: credentials.passwordHash,
        clientSecretHash: credentials.clientSecretHash,
        secretNames: [...AUTH_SECRET_NAMES],
        manifestPath: input.manifestPath,
        configurationPath: input.configurationPath,
        usersPath: input.usersPath,
    });
    await saveState(input.statePath, state);

    const cleanup = `fly apps destroy ${input.authAppName} --yes`;
    try {
        await commandOrThrow(input.runner, {
            command: 'fly',
            args: ['apps', 'create', input.authAppName],
        });
        await commandOrThrow(input.runner, {
            command: 'fly',
            args: [
                'volumes',
                'create',
                'authelia_data',
                '--app',
                input.authAppName,
                '--region',
                input.region,
                '--size',
                '1',
                '--yes',
            ],
        });
        await applyAuthSecrets({
            runner: input.runner,
            authAppName: input.authAppName,
            authSecrets: credentials.authSecrets,
        });
        await commandOrThrow(input.runner, {
            command: 'fly',
            args: ['deploy', '--config', input.manifestPath, '--yes'],
        });
        await probeAuthelia(input.fetcher, input.issuerUrl);
        await applyFootnoteSecrets({
            runner: input.runner,
            footnoteAppName: input.footnoteAppName,
            issuerUrl: input.issuerUrl,
            redirectUri: input.redirectUri,
            clientSecret: credentials.clientSecret,
        });
    } catch (error) {
        logger.error(
            `Authelia provisioning stopped before replacing Footnote authentication. Created resources were kept for diagnosis. Cleanup if needed: ${cleanup}`
        );
        throw error;
    }
};

export const provisionAuthelia = async (
    options: ProvisionOptions
): Promise<void> => {
    if (options.mode === 'preserve') {
        logger.info('Preserving current authentication configuration.');
        return;
    }

    const runner = options.runner ?? realRunner;
    const prompt = options.prompt ?? realPrompt;
    const fetcher = options.fetcher ?? getFetcher();
    const serverToml = await readText(options.serverConfigPath);
    if (
        OIDC_KEYS.some((key) =>
            new RegExp(`^\\s*${key}\\s*=`, 'm').test(serverToml)
        )
    ) {
        throw new Error(
            'OIDC keys are committed in server.toml. Remove them manually before using automatic Authelia setup.'
        );
    }
    const defaults = parseServerDefaults(serverToml);
    const authAppName = `${defaults.footnoteAppName}-auth`;
    const issuerUrl = `https://${authAppName}.fly.dev`;
    const callbackPublicUrl = await prompt.text(
        `Confirm Footnote public URL [${defaults.publicUrl}]: `
    );
    const publicUrl = validateHttpsUrl(
        callbackPublicUrl.trim() || defaults.publicUrl,
        'Footnote public URL'
    );
    const redirectUri = getCallbackUri(publicUrl);
    const stateDirectory =
        options.stateRoot ??
        path.join(
            options.repositoryRoot,
            '.footnote',
            'deploy',
            'auth',
            'authelia',
            authAppName
        );
    const statePath = path.join(stateDirectory, 'state.json');
    const authAppAlreadyExists = await flyAppExists(runner, authAppName);

    if (hasState(statePath)) {
        await ensureExistingProfile({
            runner,
            fetcher,
            state: await loadState(statePath),
            authAppExists: authAppAlreadyExists,
            authAppName,
            footnoteAppName: defaults.footnoteAppName,
        });
        logger.info(`Reused Authelia deployment state at ${stateDirectory}.`);
        return;
    }
    if (authAppAlreadyExists) {
        throw new Error(
            `Authelia app ${authAppName} already exists but local deployment state is missing. Recover it before continuing; the tool will not guess or recreate credentials.`
        );
    }

    const existingFootnoteSecretNames = await getSecretNames(
        runner,
        defaults.footnoteAppName
    );
    await requireReplacementConfirmation(
        prompt,
        OIDC_KEYS.filter((key) => existingFootnoteSecretNames.includes(key))
    );

    const username = (
        await prompt.text('Authelia administrator username: ')
    ).trim();
    const displayName = (
        await prompt.text('Authelia administrator display name: ')
    ).trim();
    const email = (await prompt.text('Authelia administrator email: ')).trim();
    validateAdministrator(username, displayName, email);

    const configurationPath = path.join(stateDirectory, 'configuration.yml');
    const usersPath = path.join(stateDirectory, 'users.yml');
    const manifestPath = path.join(stateDirectory, 'authelia.fly.toml');
    await provisionFreshProfile({
        runner,
        fetcher,
        stateDirectory,
        statePath,
        manifestPath,
        configurationPath,
        usersPath,
        authAppName,
        footnoteAppName: defaults.footnoteAppName,
        region: defaults.primaryRegion,
        issuerUrl,
        redirectUri,
        username,
        displayName,
        email,
    });
    logger.info(`Authelia is ready at ${issuerUrl}.`);
    logger.info(`Inspect generated state at ${stateDirectory}.`);
};

export type { AuthMode, Fetcher, Prompt, ProvisionOptions } from './types.js';
