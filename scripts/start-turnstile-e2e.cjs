/**
 * @description: Starts an isolated backend and deterministic provider for the Turnstile browser suite.
 * @footnote-scope: test
 * @footnote-module: StartTurnstileE2E
 * @footnote-risk: low - The runner binds only to localhost and uses official dummy credentials.
 * @footnote-ethics: low - No production configuration, secrets, or user data are involved.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const mode = process.env.TURNSTILE_E2E_MODE === 'fail' ? 'fail' : 'pass';
const credentials = JSON.parse(
    fs.readFileSync(
        path.join(root, 'test', 'turnstile-integration', 'credentials.json'),
        'utf8'
    )
);
const backendPort = Number(process.env.TURNSTILE_E2E_BACKEND_PORT ?? '3400');
const providerPort = Number(process.env.TURNSTILE_E2E_PROVIDER_PORT ?? '4545');
const settingsPath = path.join(
    root,
    'test',
    'turnstile-integration',
    `${mode}.yaml`
);
const dataDir = path.join(os.tmpdir(), `footnote-turnstile-e2e-${process.pid}`);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(backendPort),
    DATA_DIR: dataDir,
    FOOTNOTE_SETTINGS_PATH: settingsPath,
    TURNSTILE_SECRET_KEY:
        mode === 'pass' ? credentials.passSecretKey : credentials.failSecretKey,
    OPENROUTER_API_KEY: 'turnstile-e2e-provider',
    OPENAI_API_KEY: '',
    OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
    DEFAULT_PROFILE_ID: 'openrouter-deepseek-v4-flash-0731',
    PLANNER_PROFILE_ID: 'openrouter-deepseek-v4-flash-0731',
    TURNSTILE_E2E_PROVIDER_PORT: String(providerPort),
};

const children = [];
const start = (command, args) => {
    process.stderr.write(`starting ${command} ${args.join(' ')} cwd=${root}\n`);
    const child = spawn(command, args, {
        cwd: root,
        env: baseEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(command.endsWith('.cmd') ? { shell: true } : {}),
    });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    children.push(child);
    return child;
};

const provider = start(process.execPath, [
    path.join(root, 'scripts', 'turnstile-e2e-provider.cjs'),
]);
const backend = start(pnpmCommand, [
    'exec',
    'tsx',
    'packages/backend/src/server.ts',
]);

const shutdown = (exitCode = 0) => {
    for (const child of children) {
        if (!child.killed) {
            child.kill();
        }
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(exitCode);
};

provider.once('exit', (code) => {
    if (code !== 0) shutdown(code ?? 1);
});
backend.once('exit', (code) => shutdown(code ?? 1));
process.once('SIGINT', () => shutdown(130));
process.once('SIGTERM', () => shutdown(143));
