/**
 * @description: Encapsulates Fly inspection, consent, deployment, and provider probes behind the command runner seam.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaFlyAdapter
 * @footnote-risk: high - Remote command ordering controls whether existing authentication can be replaced safely.
 * @footnote-ethics: high - Consent and fail-open ordering protect operators from silent identity changes.
 */

import { AUTH_SECRET_NAMES, OIDC_KEYS } from './constants.js';
import { commandOrThrow } from './runtime.js';
import { logger } from '../../packages/discord-bot/src/utils/logger.js';
import type {
    CommandResult,
    CommandRunner,
    ExistingState,
    Fetcher,
    Prompt,
} from './types.js';

export type SecretNamesResult =
    { ok: true; names: string[] } | { ok: false; error: CommandResult };

const PROBE_ATTEMPTS = 5;
const PROBE_TIMEOUT_MS = 3_000;
const PROBE_BACKOFF_MS = 250;

const parseSecretNames = (output: string): string[] =>
    output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((name): name is string => Boolean(name) && name !== 'NAME');

export const getSecretNames = async (
    runner: CommandRunner,
    appName: string
): Promise<SecretNamesResult> => {
    const result = await runner.run({
        command: 'fly',
        args: ['secrets', 'list', '--app', appName],
    });
    return result.code === 0
        ? { ok: true, names: parseSecretNames(result.stdout) }
        : { ok: false, error: result };
};

const requireSecretNames = async (
    runner: CommandRunner,
    appName: string
): Promise<string[]> => {
    const result = await getSecretNames(runner, appName);
    if (!result.ok) {
        const details =
            result.error.stderr.trim() || result.error.stdout.trim();
        throw new Error(
            `Fly secrets list failed for ${appName} with exit code ${result.error.code}${details ? `: ${details}` : '.'}`
        );
    }
    return result.names;
};

export const flyAppExists = async (
    runner: CommandRunner,
    appName: string
): Promise<boolean> => {
    const result = await runner.run({
        command: 'fly',
        args: ['apps', 'show', appName],
    });
    return result.code === 0;
};

export const requireReplacementConfirmation = async (
    prompt: Prompt,
    existingKeys: string[]
): Promise<void> => {
    if (existingKeys.length === 0) {
        return;
    }
    logger.warn(
        `Existing remote OIDC settings detected (keys only): ${existingKeys.join(', ')}`
    );
    const confirmation = (
        await prompt.text(
            'Type REPLACE to replace these four settings, or anything else to abort: '
        )
    ).trim();
    if (confirmation !== 'REPLACE') {
        throw new Error(
            'OIDC replacement was not confirmed; Footnote was not changed.'
        );
    }
};

export const probeAuthelia = async (
    fetcher: Fetcher,
    issuerUrl: string
): Promise<void> => {
    const fetchWithRetry = async (
        url: string,
        label: string,
        httpFailure: (status: number) => string
    ): Promise<{ status: number; json: () => Promise<unknown> }> => {
        let lastError: unknown;
        let lastStatus: number | undefined;
        for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                PROBE_TIMEOUT_MS
            );
            try {
                const response = await fetcher(url, {
                    signal: controller.signal,
                });
                if (response.status >= 200 && response.status < 300) {
                    return response;
                }
                lastStatus = response.status;
                lastError = new Error(`HTTP ${response.status}`);
            } catch (error) {
                lastError = error;
            } finally {
                clearTimeout(timeout);
            }
            if (attempt < PROBE_ATTEMPTS - 1) {
                await new Promise((resolve) =>
                    setTimeout(resolve, PROBE_BACKOFF_MS * (attempt + 1))
                );
            }
        }
        if (lastStatus !== undefined) {
            throw new Error(httpFailure(lastStatus));
        }
        throw new Error(
            `Authelia ${label} check failed after ${PROBE_ATTEMPTS} attempts: ${String(lastError)}`
        );
    };

    await fetchWithRetry(
        `${issuerUrl}/api/health`,
        'health',
        (status) => `Authelia health check failed with HTTP ${status}.`
    );
    const discovery = await fetchWithRetry(
        `${issuerUrl}/.well-known/openid-configuration`,
        'OIDC discovery',
        (status) => `Authelia OIDC discovery check failed with HTTP ${status}.`
    );
    const metadata = await discovery.json();
    if (
        typeof metadata !== 'object' ||
        metadata === null ||
        (metadata as { issuer?: unknown }).issuer !== issuerUrl
    ) {
        throw new Error(
            'Authelia discovery metadata returned the wrong issuer.'
        );
    }
};

export const ensureExistingProfile = async (input: {
    runner: CommandRunner;
    fetcher: Fetcher;
    state: ExistingState;
    authAppExists: boolean;
    authAppName: string;
    footnoteAppName: string;
}): Promise<void> => {
    if (!input.authAppExists) {
        throw new Error(
            `Authelia app ${input.authAppName} is missing but local state exists. Recover the app or remove the state only after confirming teardown; the provisioning tool will not rotate or guess credentials.`
        );
    }
    const authSecrets = await requireSecretNames(
        input.runner,
        input.authAppName
    );
    const missingAuthSecrets = AUTH_SECRET_NAMES.filter(
        (name) => !authSecrets.includes(name)
    );
    if (missingAuthSecrets.length > 0) {
        throw new Error(
            `Authelia app ${input.authAppName} is missing managed secret keys: ${missingAuthSecrets.join(', ')}. Restore them manually; credentials are not regenerated automatically.`
        );
    }
    const footnoteSecrets = await requireSecretNames(
        input.runner,
        input.footnoteAppName
    );
    const missingFootnoteSecrets = OIDC_KEYS.filter(
        (name) => !footnoteSecrets.includes(name)
    );
    if (missingFootnoteSecrets.length > 0) {
        throw new Error(
            `Footnote is missing managed OIDC keys: ${missingFootnoteSecrets.join(', ')}. Restore them manually; the client secret is not retained locally.`
        );
    }
    await commandOrThrow(input.runner, {
        command: 'fly',
        args: ['deploy', '--config', input.state.manifestPath, '--yes'],
    });
    await probeAuthelia(input.fetcher, input.state.issuerUrl);
};
