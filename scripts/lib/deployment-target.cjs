#!/usr/bin/env node
/* eslint-env node */

/**
 * @description: Resolves operator command deployment target metadata from CLI flags, footnote.yaml, env, and Fly manifests.
 * @footnote-scope: utility
 * @footnote-module: DeploymentTargetResolver
 * @footnote-risk: medium - Wrong target detection can send settings commands to the wrong runtime.
 * @footnote-ethics: medium - Settings links grant privileged operator control and must resolve predictably.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const VALID_TARGETS = new Set(['local', 'fly']);

const parseTargetArgs = (argv) => {
    let target;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token !== '--target') {
            throw new Error(`Unknown option "${token}".`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error('Missing value for --target.');
        }
        if (!VALID_TARGETS.has(value)) {
            throw new Error('--target must be "local" or "fly".');
        }
        target = value;
        index += 1;
    }
    return { target };
};

const readYamlObject = (filePath) => {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    return parsed;
};

const readFlyAppFromToml = (filePath) => {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    const match = source.match(/^\s*app\s*=\s*['"]([^'"]+)['"]/m);
    return match?.[1]?.trim() || null;
};

const readDeploymentMetadata = (repoRoot) => {
    const settingsPath =
        process.env.FOOTNOTE_SETTINGS_PATH?.trim() ||
        path.join(repoRoot, 'footnote.yaml');
    const parsed = readYamlObject(settingsPath);
    const deployment =
        parsed && typeof parsed.deployment === 'object'
            ? parsed.deployment
            : null;
    return {
        settingsPath,
        target:
            deployment &&
            (deployment.target === 'local' || deployment.target === 'fly')
                ? deployment.target
                : undefined,
        flyApp:
            deployment && typeof deployment['fly-app'] === 'string'
                ? deployment['fly-app'].trim() || undefined
                : undefined,
        serverPort:
            parsed &&
            typeof parsed.server === 'object' &&
            parsed.server !== null &&
            typeof parsed.server.port === 'number'
                ? parsed.server.port
                : undefined,
    };
};

/**
 * resolveDeploymentTarget resolves the operator command target from explicit
 * args, footnote.yaml deployment metadata, env, and Fly manifests.
 *
 * @param {{ argv: string[], repoRoot: string }} options - CLI argv tokens and repository root path.
 * @returns {{ target: 'local'|'fly', flyApp?: string, localPort: number, settingsPath: string }} Resolved deployment metadata.
 */
const resolveDeploymentTarget = ({ argv, repoRoot }) => {
    const parsedArgs = parseTargetArgs(argv);
    const metadata = readDeploymentMetadata(repoRoot);
    const deployFlyApp = readFlyAppFromToml(
        path.join(repoRoot, 'deploy', 'fly', 'server.toml')
    );
    const envFlyApp = process.env.FLY_APP_NAME?.trim() || undefined;

    const target =
        parsedArgs.target ??
        metadata.target ??
        (envFlyApp ? 'fly' : undefined) ??
        (deployFlyApp ? 'fly' : undefined) ??
        'local';

    const flyApp = metadata.flyApp ?? envFlyApp ?? deployFlyApp ?? undefined;

    if (target === 'fly' && !flyApp) {
        throw new Error(
            'Unable to determine Fly app name. Set deployment.fly-app in footnote.yaml or pass --target local.'
        );
    }

    return {
        target,
        flyApp,
        localPort: metadata.serverPort ?? 3000,
        settingsPath: metadata.settingsPath,
    };
};

module.exports = {
    resolveDeploymentTarget,
};
