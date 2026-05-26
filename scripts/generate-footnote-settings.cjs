#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */

/**
 * @description: Generates canonical footnote.yaml defaults from shared config-spec template authority.
 * @footnote-scope: utility
 * @footnote-module: GenerateFootnoteSettings
 * @footnote-risk: medium - Incorrect generation can mislead first-run setup behavior.
 * @footnote-ethics: low - Developer/operator bootstrap helper only.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const defaultOutputPath = path.join(repoRoot, 'footnote.yaml');
const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
const configSpecDistIndexPath = path.join(
    repoRoot,
    'packages',
    'config-spec',
    'dist',
    'index.js'
);

const parseArgs = () => {
    const args = process.argv.slice(2);
    let outputPath = defaultOutputPath;
    let ifMissing = false;

    for (let index = 0; index < args.length; index += 1) {
        const current = args[index];
        if (current === '--output') {
            const next = args[index + 1];
            if (!next || next.startsWith('--')) {
                throw new Error('Missing value for --output');
            }
            outputPath = path.resolve(process.cwd(), next);
            index += 1;
            continue;
        }
        if (current === '--if-missing') {
            ifMissing = true;
            continue;
        }
    }

    return { outputPath, ifMissing };
};

const ensureConfigSpecBuild = () => {
    const result = spawnSync(
        'pnpm --filter @footnote/config-spec run build:dev',
        {
            cwd: repoRoot,
            stdio: 'inherit',
            shell: true,
        }
    );

    if (result.error) {
        throw result.error;
    }

    if ((result.status ?? 1) !== 0) {
        throw new Error(
            'Unable to build @footnote/config-spec before rendering settings template.'
        );
    }
};

const loadTemplateRenderer = async () => {
    const loadModule = async () =>
        import(pathToFileURL(configSpecDistIndexPath).href);

    ensureConfigSpecBuild();

    let hasRetriedBuild = false;
    let module;
    try {
        module = await loadModule();
    } catch {
        ensureConfigSpecBuild();
        hasRetriedBuild = true;
        module = await loadModule();
    }

    if (
        typeof module.renderSettingsTemplateYaml !== 'function' &&
        !hasRetriedBuild
    ) {
        ensureConfigSpecBuild();
        module = await loadModule();
    }

    if (typeof module.renderSettingsTemplateYaml !== 'function') {
        throw new Error(
            'renderSettingsTemplateYaml export was not found in @footnote/config-spec after one build retry.'
        );
    }

    return module.renderSettingsTemplateYaml;
};

const main = async () => {
    const { outputPath, ifMissing } = parseArgs();
    if (ifMissing && fs.existsSync(outputPath)) {
        console.log(
            `[settings:init] Found existing ${outputPath}; leaving as-is.`
        );
        return;
    }

    const renderSettingsTemplateYaml = await loadTemplateRenderer();
    const output = renderSettingsTemplateYaml({
        target: 'auto',
        env: process.env,
        lineEnding,
    });

    const parentDir = path.dirname(outputPath);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
    console.log(`[settings:init] Wrote ${outputPath}`);
};

void main().catch((error) => {
    console.error(
        `[settings:init] Failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
});
