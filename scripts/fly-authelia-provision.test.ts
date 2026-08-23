/**
 * @description: Verifies the public Authelia provisioning seam without contacting Fly or retaining plaintext credentials.
 * @footnote-scope: test
 * @footnote-module: FlyAutheliaProvisionTests
 * @footnote-risk: high - Missing coverage could silently replace or misconfigure deployment authentication.
 * @footnote-ethics: high - Tests protect operator consent, credential handling, and recoverability.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    AUTHELIA_IMAGE,
    provisionAuthelia,
    parseServerDefaults,
    renderConfiguration,
    type CommandResult,
    type CommandRunner,
    type CommandSpec,
    type Prompt,
} from './fly-authelia-provision.js';

const createTempRoot = async (): Promise<string> =>
    fs.mkdtemp(path.join(os.tmpdir(), 'footnote-authelia-test-'));

const writeServerConfig = async (
    root: string,
    contents?: string
): Promise<string> => {
    const filePath = path.join(root, 'deploy', 'fly', 'server.toml');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
        filePath,
        contents ??
            `app = 'footnote'\nprimary_region = 'ord'\n[env]\nALLOWED_ORIGINS = 'https://footnote.example'\n`
    );
    return filePath;
};

class FakeRunner implements CommandRunner {
    readonly calls: CommandSpec[] = [];
    private readonly responses: CommandResult[];

    constructor(responses: CommandResult[]) {
        this.responses = responses;
    }

    async run(spec: CommandSpec): Promise<CommandResult> {
        this.calls.push(spec);
        return this.responses.shift() ?? { code: 0, stdout: '', stderr: '' };
    }

    async runInteractive(spec: CommandSpec): Promise<CommandResult> {
        this.calls.push(spec);
        return this.responses.shift() ?? { code: 0, stdout: '', stderr: '' };
    }
}

const promptFrom = (answers: string[]): Prompt => ({
    async text(): Promise<string> {
        return answers.shift() ?? '';
    },
});

test('derives Fly defaults from server.toml and renders provider-neutral OIDC settings', () => {
    assert.deepEqual(
        parseServerDefaults(
            `app = 'footnote'\nprimary_region = 'ord'\n[env]\nALLOWED_ORIGINS = 'https://ai.example'\n`
        ),
        {
            footnoteAppName: 'footnote',
            primaryRegion: 'ord',
            publicUrl: 'https://ai.example',
        }
    );
    const configuration = renderConfiguration({
        issuerUrl: 'https://footnote-auth.fly.dev',
        redirectUri: 'https://ai.example/api/auth/callback',
        clientSecretHash: '$argon2id$hash',
        cookieDomain: 'footnote-auth.fly.dev',
    });
    assert.match(configuration, /require_pkce: true/);
    assert.match(configuration, /pkce_challenge_method: 'S256'/);
    assert.match(
        configuration,
        /token_endpoint_auth_method: 'client_secret_basic'/
    );
    assert.match(
        configuration,
        /scopes:\n          - 'openid'\n          - 'profile'/
    );
    assert.match(
        configuration,
        /AUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY/
    );
});

test('preserve mode performs no Fly or Docker work', async () => {
    const runner = new FakeRunner([]);
    await provisionAuthelia({
        mode: 'preserve',
        repositoryRoot: await createTempRoot(),
        serverConfigPath: 'unused',
        runner,
    });
    assert.equal(runner.calls.length, 0);
});

test('rejects committed OIDC keys before creating provider resources', async () => {
    const root = await createTempRoot();
    const serverConfigPath = await writeServerConfig(
        root,
        `app = 'footnote'\nprimary_region = 'ord'\nOIDC_CLIENT_SECRET = 'bad'\n`
    );
    const runner = new FakeRunner([]);
    await assert.rejects(
        provisionAuthelia({
            mode: 'authelia',
            repositoryRoot: root,
            serverConfigPath,
            prompt: promptFrom([]),
            runner,
        }),
        /OIDC keys are committed/
    );
    assert.equal(runner.calls.length, 0);
});

test('aborts when an existing provider has no matching local state', async () => {
    const root = await createTempRoot();
    const serverConfigPath = await writeServerConfig(root);
    const runner = new FakeRunner([
        { code: 0, stdout: 'Name: footnote-auth', stderr: '' },
    ]);
    await assert.rejects(
        provisionAuthelia({
            mode: 'authelia',
            repositoryRoot: root,
            serverConfigPath,
            prompt: promptFrom(['']),
            runner,
        }),
        /local deployment state is missing/
    );
});

test('requires explicit replacement before touching existing Footnote OIDC settings', async () => {
    const root = await createTempRoot();
    const serverConfigPath = await writeServerConfig(root);
    const runner = new FakeRunner([
        { code: 1, stdout: '', stderr: 'not found' },
        { code: 0, stdout: 'NAME\nOIDC_ISSUER_URL\n', stderr: '' },
    ]);
    await assert.rejects(
        provisionAuthelia({
            mode: 'authelia',
            repositoryRoot: root,
            serverConfigPath,
            prompt: promptFrom(['', 'no']),
            runner,
        }),
        /OIDC replacement was not confirmed/
    );
    assert.equal(
        runner.calls.some((call) => call.command === 'docker'),
        false
    );
});

test('provisions, validates, probes, and stores only sanitized state', async () => {
    const root = await createTempRoot();
    const serverConfigPath = await writeServerConfig(root);
    const runner = new FakeRunner([
        { code: 1, stdout: '', stderr: 'not found' },
        { code: 0, stdout: 'NAME\n', stderr: '' },
        { code: 0, stdout: 'Digest: $argon2id$password-hash\n', stderr: '' },
        {
            code: 0,
            stdout: 'Random Password: client-secret-value\nDigest: $argon2id$client-hash\n',
            stderr: '',
        },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
        { code: 0, stdout: '', stderr: '' },
    ]);
    await provisionAuthelia({
        mode: 'authelia',
        repositoryRoot: root,
        serverConfigPath,
        prompt: promptFrom(['', 'admin', 'Administrator', 'admin@example.com']),
        runner,
        fetcher: async () => ({
            status: 200,
            json: async () => ({ issuer: 'https://footnote-auth.fly.dev' }),
        }),
    });

    const statePath = path.join(
        root,
        '.footnote/deploy/auth/authelia/footnote-auth/state.json'
    );
    const state = await fs.readFile(statePath, 'utf8');
    assert.match(state, /password-hash/);
    assert.match(state, /client-hash/);
    assert.doesNotMatch(state, /client-secret-value/);
    assert.doesNotMatch(state, /AUTHELIA_SESSION_SECRET=.*\n/);
    const secretImport = runner.calls.find(
        (call) =>
            call.command === 'fly' &&
            call.args.includes('secrets') &&
            call.args.includes('import') &&
            call.args.includes('footnote')
    );
    assert.ok(
        secretImport?.stdin?.includes('OIDC_CLIENT_SECRET=client-secret-value')
    );
    assert.equal(
        runner.calls.some((call) => call.args.includes('client-secret-value')),
        false
    );
    assert.equal(
        runner.calls.some((call) => call.args.includes(AUTHELIA_IMAGE)),
        true
    );

    const rerunRunner = new FakeRunner([
        {
            code: 0,
            stdout: 'Name: footnote-auth',
            stderr: '',
        },
        {
            code: 0,
            stdout: 'NAME\nAUTHELIA_SESSION_SECRET\nAUTHELIA_STORAGE_ENCRYPTION_KEY\nAUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET\nAUTHELIA_IDENTITY_PROVIDERS_OIDC_HMAC_SECRET\nAUTHELIA_IDENTITY_PROVIDERS_OIDC_ISSUER_PRIVATE_KEY\nAUTHELIA_OIDC_CLIENT_SECRET\n',
            stderr: '',
        },
        {
            code: 0,
            stdout: 'NAME\nOIDC_ISSUER_URL\nOIDC_CLIENT_ID\nOIDC_CLIENT_SECRET\nOIDC_REDIRECT_URI\n',
            stderr: '',
        },
        { code: 0, stdout: '', stderr: '' },
    ]);
    await provisionAuthelia({
        mode: 'authelia',
        repositoryRoot: root,
        serverConfigPath,
        prompt: promptFrom(['']),
        runner: rerunRunner,
        fetcher: async () => ({
            status: 200,
            json: async () => ({ issuer: 'https://footnote-auth.fly.dev' }),
        }),
    });
    assert.equal(
        rerunRunner.calls.some((call) => call.command === 'docker'),
        false
    );
});
