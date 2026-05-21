/**
 * @description: Launcher metadata persistence, defaults, and config-root hashing helpers.
 * @footnote-scope: core
 * @footnote-module: LauncherMetadata
 * @footnote-risk: medium - Metadata corruption can break lifecycle continuity and safety checks.
 * @footnote-ethics: low - Local metadata storage preserves explicit operator state and defaults.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { LauncherMetadata } from './types.js';

export const DEFAULT_IMAGE_REPOSITORY = 'ghcr.io/footnote-ai/footnote';
export const DEFAULT_IMAGE_TAG = 'latest';
export const DEFAULT_INSTANCE_NAME = 'default';

export const DEFAULT_METADATA: LauncherMetadata = {
    version: 1,
    runtime: 'docker',
    instance: DEFAULT_INSTANCE_NAME,
    imageRepository: DEFAULT_IMAGE_REPOSITORY,
    defaultTag: DEFAULT_IMAGE_TAG,
};

const isNodeError = (value: unknown): value is NodeJS.ErrnoException =>
    value !== null && typeof value === 'object' && 'code' in value;

export const computeConfigRootHash = (configRoot: string): string =>
    createHash('sha256').update(configRoot).digest('hex').slice(0, 12);

export const readLauncherMetadata = async (
    metadataPath: string
): Promise<LauncherMetadata | null> => {
    try {
        const raw = await readFile(metadataPath, 'utf8');
        return JSON.parse(raw) as LauncherMetadata;
    } catch (error: unknown) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
};

export const writeLauncherMetadata = async (
    metadataPath: string,
    metadata: LauncherMetadata
): Promise<void> => {
    await writeFile(
        metadataPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8'
    );
};
