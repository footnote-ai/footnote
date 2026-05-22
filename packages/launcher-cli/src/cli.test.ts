/**
 * @description: Unit tests for launcher CLI command orchestration and menu behavior.
 * @footnote-scope: test
 * @footnote-module: LauncherCliTests
 * @footnote-risk: low - Tests verify command routing behavior without mutating real runtime resources.
 * @footnote-ethics: low - Behavior tests improve operator clarity and do not impact governance decisions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
    FootnoteRuntime,
    LauncherConfigPaths,
    LauncherMetadata,
} from '@footnote/launcher-core';
import { runCliWithDeps } from './cli.js';

const TEST_CONFIG_PATHS: LauncherConfigPaths = {
    configRoot: '/tmp/footnote-test',
    envFilePath: '/tmp/footnote-test/.env',
    settingsFilePath: '/tmp/footnote-test/footnote.yaml',
    launcherMetadataPath: '/tmp/footnote-test/launcher.metadata.json',
};

const createNoopRuntime = (): FootnoteRuntime => ({
    async start() {
        return {
            state: 'running',
            url: 'http://localhost:8080',
            port: 8080,
            tag: 'latest',
            imageRef: 'ghcr.io/footnote-ai/footnote:latest',
            containerId: 'container-1',
            volumeName: 'footnote_data',
            warnings: [],
        };
    },
    async stop() {
        return {
            stopped: true,
            removed: true,
            message: 'stopped',
        };
    },
    async status() {
        return {
            state: 'running',
            containerName: 'footnote-server',
            containerId: 'container-1',
            url: 'http://localhost:8080',
            port: 8080,
            imageRef: 'ghcr.io/footnote-ai/footnote:latest',
            configRoot: TEST_CONFIG_PATHS.configRoot,
            volumeName: 'footnote_data',
            ownershipMatches: true,
        };
    },
    async *logs() {
        yield { text: 'log-line', stream: 'stdout' };
    },
});

test('runCli info non-TTY prints read-only status/help snapshot and exits', async () => {
    const output: string[] = [];

    const exitCode = await runCliWithDeps(['info'], {
        createRuntime: createNoopRuntime,
        resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
        readLauncherMetadataFn: async () => null,
        isInteractiveTty: () => false,
        writeStdout: (text: string) => {
            output.push(text);
        },
    });

    const text = output.join('');
    assert.equal(exitCode, 0);
    assert.match(text, /\[info\] state: not_found/);
    assert.match(text, /Read-only launcher snapshot/);
    assert.match(text, /footnote update/);
});

test('runCli info non-TTY still prints snapshot when status path fails', async () => {
    const output: string[] = [];

    const exitCode = await runCliWithDeps(['info'], {
        resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
        readLauncherMetadataFn: async () => ({
            version: 1,
            runtime: 'docker',
            instance: 'default',
            imageRepository: 'ghcr.io/footnote-ai/footnote',
            defaultTag: 'stable',
        }),
        isInteractiveTty: () => false,
        writeStdout: (text: string) => {
            output.push(text);
        },
        createRuntime: () => ({
            ...createNoopRuntime(),
            async status() {
                throw new Error('status failed');
            },
        }),
    });

    const text = output.join('');
    assert.equal(exitCode, 0);
    assert.match(text, /\[warn\] status failed/);
    assert.match(text, /Read-only launcher snapshot/);
});

test('runCli info snapshot uses injected invocation formatter', async () => {
    const output: string[] = [];

    const exitCode = await runCliWithDeps(['info'], {
        createRuntime: createNoopRuntime,
        resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
        readLauncherMetadataFn: async () => null,
        isInteractiveTty: () => false,
        formatCommand: (command: string) => `custom-launcher ${command}`,
        writeStdout: (text: string) => {
            output.push(text);
        },
    });

    const text = output.join('');
    assert.equal(exitCode, 0);
    assert.match(text, /custom-launcher update/);
    assert.match(text, /custom-launcher logs --no-follow/);
});

test('runCli update fails with setup guidance when settings file is missing', async () => {
    const runtime = createNoopRuntime();

    await assert.rejects(
        async () =>
            runCliWithDeps(['update'], {
                createRuntime: () => runtime,
                resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
                bootstrapConfigFilesFn: async () => ({
                    createdPaths: [],
                    metadata: {
                        version: 1,
                        runtime: 'docker',
                        instance: 'default',
                        imageRepository: 'ghcr.io/footnote-ai/footnote',
                        defaultTag: 'stable',
                    },
                }),
                isSettingsFileMissingFn: async () => true,
                writeStdout: () => {
                    // Ignore output for this test.
                },
            }),
        /Run `footnote setup`/
    );
});

test('runCli update missing-settings guidance uses injected invocation formatter', async () => {
    const runtime = createNoopRuntime();

    await assert.rejects(
        async () =>
            runCliWithDeps(['update'], {
                createRuntime: () => runtime,
                resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
                bootstrapConfigFilesFn: async () => ({
                    createdPaths: [],
                    metadata: {
                        version: 1,
                        runtime: 'docker',
                        instance: 'default',
                        imageRepository: 'ghcr.io/footnote-ai/footnote',
                        defaultTag: 'stable',
                    },
                }),
                isSettingsFileMissingFn: async () => true,
                formatCommand: (command: string) =>
                    `custom-launcher ${command}`,
                writeStdout: () => {
                    // Ignore output for this test.
                },
            }),
        /Run `custom-launcher setup`/
    );
});

test('runCli update executes stop->start and writes refreshed metadata', async () => {
    const callOrder: string[] = [];
    const writes: LauncherMetadata[] = [];

    const runtime: FootnoteRuntime = {
        async start(input) {
            callOrder.push('start');
            assert.equal(input.defaultTag, 'stable');
            return {
                state: 'running',
                url: 'http://localhost:9090',
                port: 9090,
                tag: 'stable',
                imageRef: 'ghcr.io/footnote-ai/footnote:stable',
                containerId: 'container-2',
                volumeName: 'footnote_data',
                warnings: [],
            };
        },
        async stop() {
            callOrder.push('stop');
            return {
                stopped: true,
                removed: true,
                message:
                    'Stopped and removed launcher-managed container "footnote-server".',
            };
        },
        async status() {
            return {
                state: 'not_found',
                containerName: 'footnote-server',
                configRoot: TEST_CONFIG_PATHS.configRoot,
                volumeName: 'footnote_data',
                ownershipMatches: false,
            };
        },
        async *logs() {
            // No logs needed.
        },
    };

    const exitCode = await runCliWithDeps(['update'], {
        createRuntime: () => runtime,
        resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
        bootstrapConfigFilesFn: async () => ({
            createdPaths: [],
            metadata: {
                version: 1,
                runtime: 'docker',
                instance: 'default',
                imageRepository: 'ghcr.io/footnote-ai/footnote',
                defaultTag: 'stable',
            },
        }),
        isSettingsFileMissingFn: async () => false,
        writeLauncherMetadataFn: async (_path, metadata) => {
            writes.push(metadata);
        },
        writeStdout: () => {
            // Ignore output for this test.
        },
        nowIso: () => '2026-05-22T00:00:00.000Z',
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(callOrder, ['stop', 'start']);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.lastKnown?.url, 'http://localhost:9090');
    assert.equal(writes[0]?.lastKnown?.tag, 'stable');
    assert.equal(
        writes[0]?.lastKnown?.updatedAtIso,
        '2026-05-22T00:00:00.000Z'
    );
});

test('runCli info menu maps Start selection to start command flow', async () => {
    const calls = {
        start: 0,
        openInBrowser: 0,
    };

    const runtime: FootnoteRuntime = {
        async start() {
            calls.start += 1;
            return {
                state: 'running',
                url: 'http://localhost:8080',
                port: 8080,
                tag: 'stable',
                imageRef: 'ghcr.io/footnote-ai/footnote:stable',
                containerId: 'container-3',
                volumeName: 'footnote_data',
                warnings: [],
            };
        },
        async stop() {
            return {
                stopped: false,
                removed: false,
                message: 'nothing',
            };
        },
        async status() {
            return {
                state: 'not_found',
                containerName: 'footnote-server',
                configRoot: TEST_CONFIG_PATHS.configRoot,
                volumeName: 'footnote_data',
                ownershipMatches: false,
            };
        },
        async *logs() {
            // No logs needed.
        },
    };

    const menuSelections: Array<'start' | 'exit'> = ['start', 'exit'];

    const exitCode = await runCliWithDeps(['info'], {
        createRuntime: () => runtime,
        resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
        bootstrapConfigFilesFn: async () => ({
            createdPaths: [],
            metadata: {
                version: 1,
                runtime: 'docker',
                instance: 'default',
                imageRepository: 'ghcr.io/footnote-ai/footnote',
                defaultTag: 'stable',
            },
        }),
        isInteractiveTty: () => true,
        promptInfoMenuAction: async () => {
            const next = menuSelections.shift();
            return next ?? 'exit';
        },
        openInBrowserFn: async () => {
            calls.openInBrowser += 1;
        },
        writeLauncherMetadataFn: async () => {
            // Avoid filesystem writes in this test.
        },
        writeStdout: () => {
            // Ignore output for this test.
        },
    });

    assert.equal(exitCode, 0);
    assert.equal(calls.start, 1);
    assert.equal(calls.openInBrowser, 1);
});
