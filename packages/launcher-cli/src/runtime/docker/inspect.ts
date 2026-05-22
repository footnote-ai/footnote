/**
 * @description: Docker inspect helpers for launcher-managed container and volume state lookup.
 * @footnote-scope: utility
 * @footnote-module: LauncherDockerInspect
 * @footnote-risk: medium - Inspect parse errors can misclassify runtime ownership and state.
 * @footnote-ethics: low - Accurate inspection supports safe operational decisions.
 */

import { parseInspect, runDocker } from './command.js';

export type DockerInspectContainer = {
    Id: string;
    Name: string;
    Config: {
        Image: string;
        Labels?: Record<string, string>;
    };
    State: {
        Running: boolean;
    };
    NetworkSettings?: {
        Ports?: Record<string, Array<{ HostPort: string }> | null>;
    };
};

export type DockerInspectVolume = {
    Name: string;
    Labels?: Record<string, string>;
};

export const inspectContainer = async (
    containerName: string
): Promise<DockerInspectContainer | null> => {
    const result = await runDocker(
        ['inspect', '--type', 'container', containerName],
        true
    );
    if (result.code !== 0) {
        return null;
    }
    return parseInspect<DockerInspectContainer>(result.stdout);
};

export const inspectVolume = async (
    volumeName: string
): Promise<DockerInspectVolume | null> => {
    const result = await runDocker(['volume', 'inspect', volumeName], true);
    if (result.code !== 0) {
        return null;
    }
    return parseInspect<DockerInspectVolume>(result.stdout);
};
