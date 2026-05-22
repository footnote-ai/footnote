/**
 * @description: Launcher metadata default resolution for start/setup/update command flows.
 * @footnote-scope: utility
 * @footnote-module: LauncherCliMetadata
 * @footnote-risk: medium - Default metadata drift can alter image/tag authority decisions.
 * @footnote-ethics: low - Stable defaults keep runtime behavior predictable for operators.
 */

import {
    DEFAULT_IMAGE_REPOSITORY,
    DEFAULT_IMAGE_TAG,
    type LauncherMetadata,
} from '@footnote/launcher-core';

export const resolveMetadataWithDefaults = (
    metadata: LauncherMetadata | null
): LauncherMetadata => {
    if (metadata) {
        return metadata;
    }
    return {
        version: 1,
        runtime: 'docker',
        instance: 'default',
        imageRepository: DEFAULT_IMAGE_REPOSITORY,
        defaultTag: DEFAULT_IMAGE_TAG,
    };
};
