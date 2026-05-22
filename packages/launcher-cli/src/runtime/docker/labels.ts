/**
 * @description: Ownership label helpers and input-to-label normalization for managed Docker resources.
 * @footnote-scope: utility
 * @footnote-module: LauncherDockerLabels
 * @footnote-risk: high - Label mismatches can cause unsafe lifecycle operations on unrelated resources.
 * @footnote-ethics: medium - Strict ownership matching protects operator assets and governance boundaries.
 */

import type {
    LogsInput,
    ManagedResourceLabels,
    StartInput,
    StatusInput,
    StopInput,
} from '@footnote/launcher-core';

export const OWNERSHIP_LABELS = {
    managed: 'dev.footnote.managed',
    launcher: 'dev.footnote.launcher',
    instance: 'dev.footnote.instance',
    configRootHash: 'dev.footnote.configRootHash',
} as const;

export const normalizeContainerName = (name: string): string =>
    name.startsWith('/') ? name.slice(1) : name;

export const toDockerLabels = (
    input: StartInput | StopInput | StatusInput | LogsInput
): ManagedResourceLabels => ({
    managed: 'true',
    launcher: input.launcherId,
    instance: input.instance,
    configRootHash: input.configRootHash,
});

export const labelsMatch = (
    labels: Record<string, string> | undefined,
    expected: ManagedResourceLabels
): boolean => {
    if (!labels) {
        return false;
    }

    return (
        labels[OWNERSHIP_LABELS.managed] === expected.managed &&
        labels[OWNERSHIP_LABELS.launcher] === expected.launcher &&
        labels[OWNERSHIP_LABELS.instance] === expected.instance &&
        labels[OWNERSHIP_LABELS.configRootHash] === expected.configRootHash
    );
};

export const buildLabelArgs = (labels: ManagedResourceLabels): string[] => [
    '--label',
    `${OWNERSHIP_LABELS.managed}=${labels.managed}`,
    '--label',
    `${OWNERSHIP_LABELS.launcher}=${labels.launcher}`,
    '--label',
    `${OWNERSHIP_LABELS.instance}=${labels.instance}`,
    '--label',
    `${OWNERSHIP_LABELS.configRootHash}=${labels.configRootHash}`,
];
