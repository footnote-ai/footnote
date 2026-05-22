/**
 * @description: Docker-backed runtime adapter for standalone launcher lifecycle commands.
 * @footnote-scope: core
 * @footnote-module: DockerRuntime
 * @footnote-risk: high - Incorrect container/volume lifecycle behavior can disrupt local runtime state.
 * @footnote-ethics: medium - Safe ownership checks prevent accidental impact to unrelated operator resources.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import {
    ensureWebLocalUrlInSettings,
    LauncherError,
    selectAvailablePort,
    type FootnoteRuntime,
    type LogLine,
    type LogsInput,
    type ManagedResourceLabels,
    type StartInput,
    type StartResult,
    type StatusInput,
    type StatusResult,
    type StopInput,
    type StopResult,
} from '@footnote/launcher-core';

type DockerCommandResult = {
    code: number;
    stdout: string;
    stderr: string;
};

type DockerInspectContainer = {
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

type DockerInspectVolume = {
    Name: string;
    Labels?: Record<string, string>;
};

const OWNERSHIP_LABELS = {
    managed: 'dev.footnote.managed',
    launcher: 'dev.footnote.launcher',
    instance: 'dev.footnote.instance',
    configRootHash: 'dev.footnote.configRootHash',
} as const;

const normalizeContainerName = (name: string): string =>
    name.startsWith('/') ? name.slice(1) : name;

const readLinesFromChunk = (
    state: { buffered: string },
    chunk: Buffer,
    stream: LogLine['stream'],
    enqueue: (line: LogLine) => void
): void => {
    state.buffered += chunk.toString('utf8');

    let lineBreakIndex = state.buffered.indexOf('\n');
    while (lineBreakIndex >= 0) {
        const raw = state.buffered.slice(0, lineBreakIndex);
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (text.length > 0) {
            enqueue({ text, stream });
        }
        state.buffered = state.buffered.slice(lineBreakIndex + 1);
        lineBreakIndex = state.buffered.indexOf('\n');
    }
};

const toDockerLabels = (
    input: StartInput | StopInput | StatusInput | LogsInput
): ManagedResourceLabels => ({
    managed: 'true',
    launcher: input.launcherId,
    instance: input.instance,
    configRootHash: input.configRootHash,
});

const labelsMatch = (
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

const runDocker = async (
    args: readonly string[],
    allowFailure: boolean = false,
    failureKind: 'environment' | 'runtime' = 'runtime'
): Promise<DockerCommandResult> =>
    new Promise((resolve, reject) => {
        const child = spawn('docker', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });

        child.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                reject(
                    new LauncherError(
                        'environment',
                        [
                            'Docker CLI was not found.',
                            'Install Docker Desktop (or Docker Engine) and confirm `docker --version` works.',
                        ].join(' '),
                        error
                    )
                );
                return;
            }
            reject(error);
        });

        child.on('close', (code) => {
            const result: DockerCommandResult = {
                code: code ?? 1,
                stdout,
                stderr,
            };
            if (!allowFailure && result.code !== 0) {
                reject(
                    new LauncherError(
                        failureKind,
                        `Docker command failed: docker ${args.join(' ')}\n${stderr.trim() || stdout.trim()}`
                    )
                );
                return;
            }
            resolve(result);
        });
    });

const parseInspect = <T>(stdout: string): T | null => {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = JSON.parse(trimmed) as T[];
    return parsed[0] ?? null;
};

const waitForReadiness = async (
    url: string,
    timeoutMs: number
): Promise<void> => {
    const startedAt = Date.now();
    const delayMs = 1_000;

    while (true) {
        const elapsedMs = Date.now() - startedAt;
        const remainingMs = timeoutMs - elapsedMs;
        if (remainingMs <= 0) {
            break;
        }

        const attemptTimeoutMs = Math.max(1, Math.min(delayMs, remainingMs));
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(attemptTimeoutMs),
            });
            if (response.status < 500) {
                return;
            }
        } catch {
            // Keep polling until timeout.
        }

        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), attemptTimeoutMs);
        });
    }

    throw new LauncherError(
        'runtime',
        [
            `Runtime readiness timed out after ${Math.round(timeoutMs / 1_000)}s.`,
            `URL: ${url}`,
            'Run `footnote logs` for diagnostic output.',
        ].join(' ')
    );
};

const buildLabelArgs = (labels: ManagedResourceLabels): string[] => [
    '--label',
    `${OWNERSHIP_LABELS.managed}=${labels.managed}`,
    '--label',
    `${OWNERSHIP_LABELS.launcher}=${labels.launcher}`,
    '--label',
    `${OWNERSHIP_LABELS.instance}=${labels.instance}`,
    '--label',
    `${OWNERSHIP_LABELS.configRootHash}=${labels.configRootHash}`,
];

const inspectContainer = async (
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

const inspectVolume = async (
    volumeName: string
): Promise<DockerInspectVolume | null> => {
    const result = await runDocker(['volume', 'inspect', volumeName], true);
    if (result.code !== 0) {
        return null;
    }
    return parseInspect<DockerInspectVolume>(result.stdout);
};

const verifyDockerAvailable = async (): Promise<void> => {
    await runDocker(['--version']);

    const daemonResult = await runDocker(['info'], true);
    if (daemonResult.code !== 0) {
        throw new LauncherError(
            'environment',
            [
                'Docker daemon is not reachable.',
                'Start Docker Desktop (or Docker Engine) and retry `footnote start`.',
            ].join(' ')
        );
    }
};

const ensureManagedVolume = async (
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

const ensureManagedContainerForStart = async (
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

const ensureOwnedContainerForLifecycle = async (
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
    public async *logs(input: LogsInput): AsyncIterable<LogLine> {
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

        const args = ['logs'];
        if (input.follow) {
            args.push('--follow');
        }
        args.push(input.containerName);

        const child = spawn('docker', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const queue: Array<LogLine | null> = [];
        let resolveNext: (() => void) | null = null;
        let terminalError: unknown;

        const notify = (): void => {
            if (resolveNext) {
                resolveNext();
                resolveNext = null;
            }
        };

        const enqueue = (line: LogLine | null): void => {
            queue.push(line);
            notify();
        };

        const stdoutState = { buffered: '' };
        const stderrState = { buffered: '' };

        child.stdout.on('data', (chunk: Buffer) => {
            readLinesFromChunk(stdoutState, chunk, 'stdout', enqueue);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            readLinesFromChunk(stderrState, chunk, 'stderr', enqueue);
        });

        child.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                terminalError = new LauncherError(
                    'environment',
                    'Docker CLI was not found while streaming logs.',
                    error
                );
                enqueue(null);
                return;
            }
            terminalError = error;
            enqueue(null);
        });

        child.on('close', (code) => {
            if (stdoutState.buffered.length > 0) {
                enqueue({ text: stdoutState.buffered, stream: 'stdout' });
            }
            if (stderrState.buffered.length > 0) {
                enqueue({ text: stderrState.buffered, stream: 'stderr' });
            }
            if (code !== 0) {
                terminalError ??= new LauncherError(
                    'runtime',
                    `Docker command failed: docker ${args.join(' ')}\ndocker logs exited with status ${code ?? 1}`
                );
            }
            enqueue(null);
        });

        while (true) {
            if (queue.length === 0) {
                await new Promise<void>((resolve) => {
                    resolveNext = resolve;
                });
            }

            const item = queue.shift();
            if (item === null) {
                if (terminalError) {
                    throw terminalError;
                }
                return;
            }
            if (item) {
                yield item;
            }
        }
    }
}
