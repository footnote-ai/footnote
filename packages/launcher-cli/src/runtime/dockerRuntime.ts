/**
 * @description: Docker-backed runtime adapter for standalone launcher lifecycle commands.
 * @footnote-scope: core
 * @footnote-module: DockerRuntime
 * @footnote-risk: high - Incorrect container/volume lifecycle behavior can disrupt local runtime state.
 * @footnote-ethics: medium - Safe ownership checks prevent accidental impact to unrelated operator resources.
 */

import path from 'node:path';
import {
    ensureWebLocalUrlInSettings,
    LauncherError,
    selectAvailablePort,
    type FootnoteRuntime,
    type LogLine,
    type LogsInput,
    type StartInput,
    type StartResult,
    type StatusInput,
    type StatusResult,
    type StopInput,
    type StopResult,
} from '@footnote/launcher-core';
import { runDocker } from './docker/command.js';
import { inspectContainer } from './docker/inspect.js';
import {
    ensureManagedContainerForStart,
    ensureManagedVolume,
    ensureOwnedContainerForLifecycle,
    verifyDockerAvailable,
} from './docker/lifecycleGuards.js';
import { streamDockerLogs } from './docker/logStream.js';
import {
    buildLabelArgs,
    labelsMatch,
    toDockerLabels,
} from './docker/labels.js';
import { waitForReadiness } from './docker/readiness.js';

/**
 * Docker-backed authoritative runtime adapter for launcher lifecycle operations.
 * Methods mutate only launcher-owned resources and fail closed on ownership mismatches.
 */
export class DockerRuntime implements FootnoteRuntime {
    /**
     * Starts the launcher-managed container from the configured image and waits for readiness.
     * Returns runtime metadata used by the CLI; cleanup runs if startup/readiness fails.
     */
    public async start(input: StartInput): Promise<StartResult> {
        await verifyDockerAvailable();

        const labels = toDockerLabels(input);
        const tag = input.tagOverride ?? input.defaultTag;
        const imageRef = `${input.imageRepository}:${tag}`;

        try {
            await runDocker(['pull', imageRef], false, 'environment');
        } catch (error: unknown) {
            if (
                error instanceof LauncherError &&
                /unauthorized/i.test(error.message)
            ) {
                throw new LauncherError(
                    'environment',
                    [
                        `Could not pull ${imageRef} from GHCR: unauthorized.`,
                        'The image may not be publicly pullable yet.',
                        'Maintainers: set the GHCR package visibility to Public.',
                        'Advanced workaround: run `docker login ghcr.io` and retry.',
                    ].join(' ')
                );
            }
            throw error;
        }

        const warnings: string[] = [];
        const expectedDigest = input.digestByTag?.[tag];
        if (expectedDigest) {
            const digestResult = await runDocker(
                [
                    'image',
                    'inspect',
                    imageRef,
                    '--format',
                    '{{json .RepoDigests}}',
                ],
                true
            );

            if (digestResult.code !== 0) {
                warnings.push(
                    `Digest verification skipped for ${imageRef} because repo digest inspection failed.`
                );
            } else {
                const repoDigests = JSON.parse(
                    digestResult.stdout.trim() || '[]'
                ) as string[];
                const matched = repoDigests.some((digest) =>
                    digest.includes(expectedDigest)
                );
                if (!matched) {
                    warnings.push(
                        `Digest warning: expected ${expectedDigest} for tag ${tag}, but pulled image digest did not match.`
                    );
                }
            }
        }

        const port = await selectAvailablePort(input.preferredPort);
        const url = `http://localhost:${port}`;

        try {
            await ensureWebLocalUrlInSettings(input.settingsFilePath, url);
        } catch (error: unknown) {
            const reason =
                error instanceof Error ? error.message : 'Unknown patch error.';
            warnings.push(
                `Could not update footnote.yaml web allowlist for ${url}: ${reason}`
            );
        }

        await ensureManagedVolume(input.volumeName, labels);
        await ensureManagedContainerForStart(input.containerName, labels);
        let containerCreated = false;
        try {
            const settingsMountMode = input.settingsMountMode ?? 'file';
            const settingsMountSource =
                settingsMountMode === 'directory'
                    ? path.dirname(input.settingsFilePath)
                    : input.settingsFilePath;
            const settingsMountTarget =
                settingsMountMode === 'directory'
                    ? '/data/config'
                    : '/data/config/footnote.yaml';

            await runDocker([
                'create',
                '--name',
                input.containerName,
                '--restart',
                'unless-stopped',
                ...buildLabelArgs(labels),
                '--publish',
                `${port}:3000`,
                '--env-file',
                input.envFilePath,
                '--mount',
                `type=volume,source=${input.volumeName},target=/data`,
                '--mount',
                `type=bind,source=${settingsMountSource},target=${settingsMountTarget}`,
                imageRef,
            ]);
            containerCreated = true;

            const startResult = await runDocker(['start', input.containerName]);
            const containerId = startResult.stdout.trim();

            await waitForReadiness(url, input.readinessTimeoutMs);

            return {
                state: 'running',
                url,
                port,
                tag,
                imageRef,
                containerId,
                volumeName: input.volumeName,
                warnings,
            };
        } catch (error: unknown) {
            if (containerCreated) {
                try {
                    await runDocker(['rm', '-f', input.containerName], true);
                } catch {
                    // Best-effort cleanup; preserve original startup failure.
                }
            }
            throw error;
        }
    }

    /**
     * Stops and removes the launcher-owned container when present.
     * Refuses lifecycle operations for mismatched ownership labels.
     */
    public async stop(input: StopInput): Promise<StopResult> {
        const labels = toDockerLabels(input);
        const container = await ensureOwnedContainerForLifecycle(
            input.containerName,
            labels
        );

        if (!container) {
            return {
                stopped: false,
                removed: false,
                message: `No launcher-managed container named "${input.containerName}" was found.`,
            };
        }

        if (container.State.Running) {
            await runDocker(['stop', input.containerName]);
        }
        await runDocker(['rm', input.containerName]);

        return {
            stopped: true,
            removed: true,
            message: `Stopped and removed launcher-managed container "${input.containerName}".`,
        };
    }

    /**
     * Returns read-only runtime status for the managed container and ownership match state.
     * No bootstrap or resource creation happens in this method.
     */
    public async status(input: StatusInput): Promise<StatusResult> {
        const labels = toDockerLabels(input);
        const container = await inspectContainer(input.containerName);

        if (!container) {
            return {
                state: 'not_found',
                containerName: input.containerName,
                configRoot: input.configRoot,
                volumeName: input.volumeName,
                ownershipMatches: false,
            };
        }

        const ownershipMatches = labelsMatch(container.Config.Labels, labels);
        const publishedPorts = container.NetworkSettings?.Ports ?? {};
        const webPortBinding = publishedPorts['3000/tcp'];
        const port = webPortBinding?.[0]?.HostPort
            ? Number.parseInt(webPortBinding[0].HostPort, 10)
            : undefined;
        const url = port ? `http://localhost:${port}` : undefined;

        return {
            state: container.State.Running ? 'running' : 'stopped',
            containerName: input.containerName,
            containerId: container.Id,
            imageRef: container.Config.Image,
            port,
            url,
            configRoot: input.configRoot,
            volumeName: input.volumeName,
            ownershipMatches,
        };
    }

    /**
     * Streams logs from the launcher-owned container.
     * Throws when no owned container is present; never mutates runtime resources.
     */
    public async *logs(input: LogsInput): AsyncGenerator<LogLine, void, void> {
        const labels = toDockerLabels(input);
        const container = await ensureOwnedContainerForLifecycle(
            input.containerName,
            labels
        );

        if (!container) {
            throw new LauncherError(
                'environment',
                `No launcher-managed container named "${input.containerName}" was found.`
            );
        }

        yield* streamDockerLogs({
            containerName: input.containerName,
            follow: input.follow,
        });
    }
}
