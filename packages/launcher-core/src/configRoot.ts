/**
 * @description: Cross-platform launcher config-root and file-path resolution.
 * @footnote-scope: core
 * @footnote-module: LauncherConfigRoot
 * @footnote-risk: medium - Wrong path resolution can misplace user state and break lifecycle behavior.
 * @footnote-ethics: low - Predictable local state placement supports transparent operator ownership.
 */

import os from 'node:os';
import path from 'node:path';
import type { LauncherConfigPaths } from './types.js';

const resolveLinuxConfigBase = (env: NodeJS.ProcessEnv): string => {
    const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
    if (xdgConfigHome && xdgConfigHome.length > 0) {
        return xdgConfigHome;
    }
    return path.join(os.homedir(), '.config');
};

export const resolveDefaultConfigRoot = (
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv
): string => {
    if (platform === 'win32') {
        const appData = env.APPDATA?.trim();
        if (!appData) {
            return path.join(os.homedir(), 'AppData', 'Roaming', 'Footnote');
        }
        return path.join(appData, 'Footnote');
    }

    if (platform === 'darwin') {
        return path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Footnote'
        );
    }

    return path.join(resolveLinuxConfigBase(env), 'footnote');
};

export const resolveConfigPaths = (
    configRoot: string
): LauncherConfigPaths => ({
    configRoot,
    envFilePath: path.join(configRoot, '.env'),
    settingsFilePath: path.join(configRoot, 'footnote.yaml'),
    launcherMetadataPath: path.join(configRoot, 'launcher.json'),
});
