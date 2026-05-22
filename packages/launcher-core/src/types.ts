/**
 * @description: Shared launcher runtime contracts and lifecycle payload types.
 * @footnote-scope: interface
 * @footnote-module: LauncherCoreTypes
 * @footnote-risk: medium - Incorrect contracts can break CLI/runtime lifecycle coordination.
 * @footnote-ethics: low - Contract typing improves predictable operator behavior without changing governance semantics.
 */

import type { SetupBootstrapEvent } from './setupEvent.js';

export type RuntimeKind = 'docker' | 'local';

export type RuntimeState = 'running' | 'stopped' | 'not_found';

export type ManagedResourceLabels = {
    managed: 'true';
    launcher: string;
    instance: string;
    configRootHash: string;
};

export type StartInput = {
    configRoot: string;
    configRootHash: string;
    instance: string;
    launcherId: string;
    containerName: string;
    volumeName: string;
    imageRepository: string;
    defaultTag: string;
    tagOverride?: string;
    digestByTag?: Readonly<Record<string, string>>;
    preferredPort: number;
    envFilePath: string;
    settingsFilePath: string;
    settingsMountMode?: 'file' | 'directory';
    headless: boolean;
    readinessTimeoutMs: number;
};

export type StartResult = {
    state: RuntimeState;
    url: string;
    port: number;
    tag: string;
    imageRef: string;
    containerId: string;
    volumeName: string;
    warnings: string[];
};

export type StopInput = {
    configRoot: string;
    configRootHash: string;
    instance: string;
    launcherId: string;
    containerName: string;
    volumeName: string;
};

export type StopResult = {
    stopped: boolean;
    removed: boolean;
    message: string;
};

export type StatusInput = {
    configRoot: string;
    configRootHash: string;
    instance: string;
    launcherId: string;
    containerName: string;
    volumeName: string;
};

export type StatusResult = {
    state: RuntimeState;
    containerName: string;
    containerId?: string;
    url?: string;
    port?: number;
    imageRef?: string;
    tag?: string;
    configRoot: string;
    volumeName: string;
    ownershipMatches: boolean;
};

export type LogsInput = {
    configRoot: string;
    configRootHash: string;
    instance: string;
    launcherId: string;
    containerName: string;
    follow: boolean;
};

export type LogLine = {
    text: string;
    stream: 'stdout' | 'stderr' | 'unknown';
};

export interface FootnoteRuntime {
    start(input: StartInput): Promise<StartResult>;
    stop(input: StopInput): Promise<StopResult>;
    status(input: StatusInput): Promise<StatusResult>;
    logs(input: LogsInput): AsyncIterable<LogLine>;
}

export type LauncherMetadata = {
    version: 1;
    runtime: RuntimeKind;
    instance: string;
    imageRepository: string;
    defaultTag: string;
    digestByTag?: Record<string, string>;
    lastKnown?: {
        url: string;
        port: number;
        tag: string;
        imageRef: string;
        containerName: string;
        volumeName: string;
        updatedAtIso: string;
    };
    setup?: {
        lastBootstrapEvent?: SetupBootstrapEvent & {
            capturedAtIso: string;
        };
    };
};

export type BootstrapResult = {
    createdPaths: string[];
    metadata: LauncherMetadata;
};

export type LauncherConfigPaths = {
    configRoot: string;
    envFilePath: string;
    settingsFilePath: string;
    launcherMetadataPath: string;
};
