/**
 * @description: Ownership-enforcing Docker lifecycle guards for launcher-managed containers and volumes.
 * @footnote-scope: core
 * @footnote-module: LauncherDockerLifecycleGuards
 * @footnote-risk: high - Guard regressions can mutate unmanaged resources or block legitimate lifecycle actions.
 * @footnote-ethics: medium - Strict ownership checks prevent accidental operator harm.
 */

import {
    LauncherError,
    type ManagedResourceLabels,
} from '@footnote/launcher-core';
import { runDocker } from './command.js';
import {
    inspectContainer,
    inspectVolume,
    type DockerInspectContainer,
} from './inspect.js';
import {
    buildLabelArgs,
    labelsMatch,
    normalizeContainerName,
} from './labels.js';
import { formatCommand } from './invocation.js';

export const verifyDockerAvailable = async (): Promise<void> => {
    await runDocker(['--version']);

    const daemonResult = await runDocker(['info'], true);
    if (daemonResult.code !== 0) {
        throw new LauncherError(
            'environment',
            [
                'Docker daemon is not reachable.',
                `Start Docker Desktop (or Docker Engine) and retry \`${formatCommand('start')}\`.`,
            ].join(' ')
        );
    }
};

export const ensureManagedVolume = async (
    volumeName: string,
    labels: ManagedResourceLabels
): Promise<void> => {
    const volume = await inspectVolume(volumeName);

    if (!volume) {
        await runDocker([
            'volume',
            'create',
            ...buildLabelArgs(labels),
            volumeName,
        ]);
        return;
    }

    if (!labelsMatch(volume.Labels, labels)) {
        throw new LauncherError(
            'runtime',
            `Refusing to use Docker volume "${volumeName}" because ownership labels do not match launcher-managed resources.`
        );
    }
};

export const ensureManagedContainerForStart = async (
    containerName: string,
    labels: ManagedResourceLabels
): Promise<void> => {
    const container = await inspectContainer(containerName);
    if (!container) {
        return;
    }

    const currentName = normalizeContainerName(container.Name);
    if (currentName !== containerName) {
        throw new LauncherError(
            'runtime',
            `Container name mismatch while resolving launcher-owned resource: expected "${containerName}", got "${currentName}".`
        );
    }

    if (!labelsMatch(container.Config.Labels, labels)) {
        throw new LauncherError(
            'runtime',
            `Refusing to modify Docker container "${containerName}" because ownership labels do not match launcher-managed resources.`
        );
    }

    await runDocker(['rm', '--force', containerName]);
};

export const ensureOwnedContainerForLifecycle = async (
    containerName: string,
    labels: ManagedResourceLabels
): Promise<DockerInspectContainer | null> => {
    const container = await inspectContainer(containerName);
    if (!container) {
        return null;
    }

    const currentName = normalizeContainerName(container.Name);
    if (currentName !== containerName) {
        throw new LauncherError(
            'runtime',
            `Container name mismatch while resolving launcher-owned resource: expected "${containerName}", got "${currentName}".`
        );
    }

    if (!labelsMatch(container.Config.Labels, labels)) {
        throw new LauncherError(
            'runtime',
            `Refusing lifecycle operation on "${containerName}" because required ownership labels are missing or mismatched.`
        );
    }

    return container;
};
