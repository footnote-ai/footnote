/**
 * @description: Bootstrap helpers for standalone launcher config files and metadata.
 * @footnote-scope: core
 * @footnote-module: LauncherBootstrap
 * @footnote-risk: medium - Incorrect defaults can degrade startup reliability on first run.
 * @footnote-ethics: low - Bootstrapping keeps user control with local, inspectable config files.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
    DEFAULT_IMAGE_REPOSITORY,
    DEFAULT_IMAGE_TAG,
    DEFAULT_INSTANCE_NAME,
    DEFAULT_METADATA,
} from './metadata.js';
import type {
    BootstrapResult,
    LauncherConfigPaths,
    LauncherMetadata,
} from './types.js';

const DEFAULT_ENV_FILE = `# Footnote runtime environment\n# Add secrets here if needed.\n\nNODE_ENV=production\n`;

const DEFAULT_SETTINGS_FILE = `version: 1\n\nserver:\n    host: '::'\n    port: 3000\n    trust-proxy: false\n    data-dir: '/data'\n\nweb:\n    allowed-origins:\n        - 'http://localhost:8080'\n        - 'http://localhost:3000'\n    frame-ancestors:\n        - "'self'"\n        - 'http://localhost:8080'\n        - 'http://localhost:3000'\n\ndiscord-bots: []\n`;

const readExistingMetadata = async (
    metadataPath: string
): Promise<LauncherMetadata | null> => {
    try {
        const raw = await readFile(metadataPath, 'utf8');
        const parsed = JSON.parse(raw) as LauncherMetadata;
        return parsed;
    } catch (error: unknown) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
        ) {
            return null;
        }
        throw error;
    }
};

const ensureFile = async (
    filePath: string,
    content: string,
    createdPaths: string[]
): Promise<void> => {
    try {
        await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
        createdPaths.push(filePath);
    } catch (error: unknown) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'EEXIST'
        ) {
            return;
        }
        throw error;
    }
};

export const createDefaultMetadata = (): LauncherMetadata => ({
    ...DEFAULT_METADATA,
    runtime: 'docker',
    instance: DEFAULT_INSTANCE_NAME,
    imageRepository: DEFAULT_IMAGE_REPOSITORY,
    defaultTag: DEFAULT_IMAGE_TAG,
});

export const bootstrapConfigFiles = async (
    paths: LauncherConfigPaths
): Promise<BootstrapResult> => {
    await mkdir(paths.configRoot, { recursive: true });

    const createdPaths: string[] = [];

    await ensureFile(paths.envFilePath, DEFAULT_ENV_FILE, createdPaths);
    await ensureFile(
        paths.settingsFilePath,
        DEFAULT_SETTINGS_FILE,
        createdPaths
    );

    const existingMetadata = await readExistingMetadata(
        paths.launcherMetadataPath
    );
    const metadata = existingMetadata ?? createDefaultMetadata();

    if (!existingMetadata) {
        await writeFile(
            paths.launcherMetadataPath,
            `${JSON.stringify(metadata, null, 2)}\n`,
            'utf8'
        );
        createdPaths.push(paths.launcherMetadataPath);
    }

    return {
        createdPaths,
        metadata,
    };
};
