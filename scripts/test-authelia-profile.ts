/**
 * @description: Validates and starts a generated Authelia profile in Docker, then checks health and OIDC discovery.
 * @footnote-scope: test
 * @footnote-module: TestAutheliaProfile
 * @footnote-risk: high - Provider validation exercises the deployment authentication boundary.
 * @footnote-ethics: high - Local integration checks reduce the chance of shipping an inaccessible or misleading login path.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AUTHELIA_IMAGE } from './fly-authelia-provision.js';
import type { CommandResult, CommandSpec } from './fly-authelia/types.js';

type ProfileState = {
    provider: 'authelia';
    issuerUrl: string;
    configurationPath: string;
    usersPath: string;
};

const runDocker = (spec: CommandSpec): Promise<CommandResult> =>
    new Promise((resolve, reject) => {
        const child = spawn(spec.command, spec.args, {
            env: { ...process.env, ...spec.env },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) =>
            resolve({ code: code ?? 1, stdout, stderr })
        );
        child.stdin.end(spec.stdin);
    });

const randomSecret = (): string => crypto.randomBytes(32).toString('base64url');

const createSigningKey = (): string => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    return privateKey;
};

const getFreePort = async (): Promise<number> => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!address || typeof address === 'string') {
        throw new Error('Unable to allocate a local Docker probe port.');
    }
    return address.port;
};

const waitForHttp = async (
    url: string,
    headers: Record<string, string> = {}
): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        try {
            const response = await fetch(url, {
                headers,
                signal: controller.signal,
            });
            if (response.ok) {
                return response;
            }
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timeout);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Authelia did not become ready: ${String(lastError)}`);
};

const loadState = async (configDirectory: string): Promise<ProfileState> => {
    const state = JSON.parse(
        await fs.readFile(path.join(configDirectory, 'state.json'), 'utf8')
    ) as Partial<ProfileState>;
    if (
        state.provider !== 'authelia' ||
        !state.issuerUrl ||
        !state.configurationPath ||
        !state.usersPath
    ) {
        throw new Error(
            'The config directory does not contain valid Authelia state.'
        );
    }
    return state as ProfileState;
};

const main = async (): Promise<void> => {
    const configDirectoryFlag = process.argv.indexOf('--config-dir');
    const configDirectory =
        configDirectoryFlag >= 0
            ? process.argv[configDirectoryFlag + 1]
            : undefined;
    if (!configDirectory) {
        throw new Error(
            'Usage: pnpm test:authelia -- --config-dir .footnote/deploy/auth/authelia/<app>'
        );
    }
    const state = await loadState(path.resolve(configDirectory));
    const configurationPath = path.join(
        path.resolve(configDirectory),
        'configuration.yml'
    );
    const usersPath = path.join(path.resolve(configDirectory), 'users.yml');
    const port = await getFreePort();
    const containerName = `footnote-authelia-test-${process.pid}`;
    const signingKey = createSigningKey();
    const env = {
        AUTHELIA_SESSION_SECRET: randomSecret(),
        AUTHELIA_STORAGE_ENCRYPTION_KEY: randomSecret(),
        AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET: randomSecret(),
        AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET: randomSecret(),
        AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY: signingKey,
    };
    const commonArgs = [
        '--env',
        'AUTHELIA_SESSION_SECRET',
        '--env',
        'AUTHELIA_STORAGE_ENCRYPTION_KEY',
        '--env',
        'AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET',
        '--env',
        'AUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET',
        '--env',
        'AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY',
        '--tmpfs',
        '/data',
        '--volume',
        `${usersPath}:/data/users.yml:ro`,
        '--volume',
        `${configurationPath}:/config/configuration.yml:ro`,
    ];
    const validation = await runDocker({
        command: 'docker',
        args: [
            'run',
            '--rm',
            ...commonArgs,
            AUTHELIA_IMAGE,
            'authelia',
            'config',
            'validate',
            '--config',
            '/config/configuration.yml',
        ],
        env,
    });
    if (validation.code !== 0) {
        throw new Error(
            `Authelia configuration validation failed:\n${validation.stderr}`
        );
    }

    let started = false;
    try {
        const start = await runDocker({
            command: 'docker',
            args: [
                'run',
                '--detach',
                '--name',
                containerName,
                '--publish',
                `127.0.0.1:${port}:9091`,
                ...commonArgs,
                AUTHELIA_IMAGE,
                'authelia',
                '--config',
                '/config/configuration.yml',
            ],
            env,
        });
        if (start.code !== 0) {
            throw new Error(
                `Authelia container failed to start:\n${start.stderr}`
            );
        }
        started = true;
        await waitForHttp(`http://127.0.0.1:${port}/api/health`);
        const issuerUrl = new URL(state.issuerUrl);
        const discovery = await waitForHttp(
            `http://127.0.0.1:${port}/.well-known/openid-configuration`,
            {
                Host: issuerUrl.host,
                'X-Forwarded-Host': issuerUrl.host,
                'X-Forwarded-Proto': issuerUrl.protocol.replace(':', ''),
            }
        );
        const metadata = (await discovery.json()) as { issuer?: unknown };
        if (metadata.issuer !== state.issuerUrl) {
            throw new Error(
                `OIDC discovery issuer mismatch: expected ${state.issuerUrl}.`
            );
        }
        console.log(
            'Authelia Docker integration passed: config, health, and discovery.'
        );
    } finally {
        if (started) {
            await runDocker({
                command: 'docker',
                args: ['rm', '--force', containerName],
            });
        }
    }
};

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
