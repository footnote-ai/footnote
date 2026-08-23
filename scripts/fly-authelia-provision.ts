/**
 * @description: Public CLI and test seam for the optional, provider-neutral Authelia Fly deployment profile.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaProvision
 * @footnote-risk: high - This seam coordinates identity provisioning and remote OIDC changes.
 * @footnote-ethics: high - A small, explicit interface keeps operator consent and recovery behavior inspectable.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../packages/discord-bot/src/utils/logger';
import {
    AUTHELIA_IMAGE,
    AUTHELIA_IMAGE_DIGEST,
    AUTHELIA_VERSION,
    OIDC_KEYS,
} from './fly-authelia/constants.js';
import {
    parseServerDefaults,
    renderConfiguration,
} from './fly-authelia/config.js';
import { provisionAuthelia } from './fly-authelia/provision.js';
import { realPrompt } from './fly-authelia/runtime.js';
import type {
    AuthMode,
    CommandResult,
    CommandRunner,
    CommandSpec,
    Fetcher,
    Prompt,
    ProvisionOptions,
} from './fly-authelia/types.js';

export {
    AUTHELIA_IMAGE,
    AUTHELIA_IMAGE_DIGEST,
    AUTHELIA_VERSION,
    OIDC_KEYS,
    parseServerDefaults,
    provisionAuthelia,
    renderConfiguration,
};

export type {
    AuthMode,
    CommandResult,
    CommandRunner,
    CommandSpec,
    Fetcher,
    Prompt,
    ProvisionOptions,
};

const parseCliArgs = (): {
    mode?: AuthMode;
    repositoryRoot: string;
    serverConfigPath: string;
} => {
    const args = process.argv.slice(2);
    let mode: AuthMode | undefined;
    let repositoryRoot = process.cwd();
    let serverConfigPath = path.join(
        repositoryRoot,
        'deploy',
        'fly',
        'server.toml'
    );
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const value = args[index + 1];
        if (
            arg === '--mode' &&
            (value === 'preserve' || value === 'authelia')
        ) {
            mode = value;
            index += 1;
        } else if (arg === '--repository-root' && value) {
            repositoryRoot = path.resolve(value);
            index += 1;
        } else if (arg === '--server-config' && value) {
            serverConfigPath = path.resolve(value);
            index += 1;
        } else {
            throw new Error(
                'Usage: fly-authelia-provision.ts [--mode preserve|authelia] [--repository-root path] [--server-config path]'
            );
        }
    }
    return { mode, repositoryRoot, serverConfigPath };
};

const isMain = (): boolean => {
    const entry = process.argv[1];
    return (
        Boolean(entry) &&
        pathToFileURL(path.resolve(entry)).href === import.meta.url
    );
};

const runCli = async (): Promise<void> => {
    const cli = parseCliArgs();
    const answer =
        cli.mode ??
        ((
            await realPrompt.text(
                'Authentication setup [preserve/authelia] (default preserve): '
            )
        )
            .trim()
            .toLowerCase() as AuthMode | '');
    if (answer !== '' && answer !== 'authelia' && answer !== 'preserve') {
        throw new Error('Authentication setup must be preserve or authelia.');
    }
    await provisionAuthelia({
        mode: answer === 'authelia' ? 'authelia' : 'preserve',
        repositoryRoot: cli.repositoryRoot,
        serverConfigPath: cli.serverConfigPath,
    });
};

if (isMain()) {
    void runCli().catch((error: unknown) => {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
