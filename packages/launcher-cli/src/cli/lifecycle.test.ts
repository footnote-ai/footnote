/**
 * @description: Tests launcher lifecycle output and its machine-readable shape.
 * @footnote-scope: test
 * @footnote-module: LauncherCliLifecycleTests
 * @footnote-risk: low - Output regressions can mislead operators about readiness.
 * @footnote-ethics: medium - Honest lifecycle output preserves operator control.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    FootnoteRuntime,
    LauncherConfigPaths,
    LauncherMetadata,
} from '@footnote/launcher-core';
import { runCliWithDeps } from '../cli.js';
import { writeRuntimeLifecycleEvent } from './lifecycle.js';
import type { CommandContext } from './types.js';

const TEST_CONFIG_PATHS: LauncherConfigPaths = {
    configRoot: '/tmp/footnote-lifecycle-test',
    envFilePath: '/tmp/footnote-lifecycle-test/.env',
    settingsFilePath: '/tmp/footnote-lifecycle-test/footnote.yaml',
    launcherMetadataPath: '/tmp/footnote-lifecycle-test/launcher.metadata.json',
};

const TEST_METADATA: LauncherMetadata = {
    version: 1,
    runtime: 'docker',
    instance: 'default',
    imageRepository: 'ghcr.io/footnote-ai/footnote',
    defaultTag: 'stable',
    setup: {
        lastBootstrapEvent: {
            event: 'footnote.setup.bootstrap',
            setupPath: '/setup?token=test-token',
            setupUrl: 'http://localhost:8080/setup?token=test-token',
            expiresAt: '2099-01-01T00:00:00.000Z',
            capturedAtIso: '2026-08-19T00:00:00.000Z',
        },
    },
};

const createStartResult = () => ({
    state: 'running' as const,
    url: 'http://localhost:8080',
    port: 8080,
    tag: 'stable',
    imageRef: 'ghcr.io/footnote-ai/footnote:stable',
    containerId: 'container-lifecycle-test',
    volumeName: 'footnote_data',
    warnings: [],
});

const createLifecycleTestRuntime = (output: string[]): FootnoteRuntime => ({
    async start() {
        output.push('runtime.start:called');
        output.push('runtime.start:resolved');
        return createStartResult();
    },
    async stop() {
        output.push('runtime.stop');
        return {
            stopped: true,
            removed: true,
            message: 'runtime stopped',
        };
    },
    async status() {
        return {
            state: 'not_found' as const,
            containerName: 'footnote-server',
            configRoot: TEST_CONFIG_PATHS.configRoot,
            volumeName: 'footnote_data',
            ownershipMatches: false,
        };
    },
    async *logs() {
        // Setup uses the valid bootstrap event in launcher metadata.
    },
});

test('writes a launcher ready event after the Docker probe', () => {
    const output: string[] = [];
    const context = {
        dependencies: {
            writeStdout: (line: string) => output.push(line),
        },
    } as unknown as CommandContext;

    writeRuntimeLifecycleEvent(context, 'ready', 'docker_probe');

    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0]!), {
        event: 'footnote.runtime.ready',
        phase: 'ready',
        service: 'launcher',
        readiness: 'docker_probe',
    });
});

test('launcher commands write starting before start and ready after start resolves', async () => {
    const commands: ReadonlyArray<{
        argv: readonly string[];
        setupRequired: boolean;
    }> = [
        { argv: ['start', '--headless'], setupRequired: false },
        { argv: ['setup'], setupRequired: true },
        { argv: ['update'], setupRequired: false },
    ];

    for (const command of commands) {
        const output: string[] = [];
        const runtime = createLifecycleTestRuntime(output);
        const exitCode = await runCliWithDeps(command.argv, {
            createRuntime: () => runtime,
            resolveDefaultConfigRootFn: () => TEST_CONFIG_PATHS.configRoot,
            resolveConfigPathsFn: () => TEST_CONFIG_PATHS,
            computeConfigRootHashFn: () => 'test-config-root-hash',
            bootstrapConfigFilesFn: async () => ({
                createdPaths: [],
                metadata: TEST_METADATA,
            }),
            isSettingsFileMissingFn: async () => command.setupRequired,
            writeLauncherMetadataFn: async () => undefined,
            openInBrowserFn: async () => undefined,
            writeStdout: (text: string) => output.push(text.trimEnd()),
        });

        assert.equal(exitCode, 0, command.argv.join(' '));
        const startingIndex = output.findIndex((line) =>
            line.includes('footnote.runtime.starting')
        );
        const startCalledIndex = output.indexOf('runtime.start:called');
        const startResolvedIndex = output.indexOf('runtime.start:resolved');
        const readyIndex = output.findIndex((line) =>
            line.includes('footnote.runtime.ready')
        );

        assert.ok(startingIndex >= 0, command.argv.join(' '));
        assert.ok(startCalledIndex >= 0, command.argv.join(' '));
        assert.ok(startResolvedIndex >= 0, command.argv.join(' '));
        assert.ok(readyIndex >= 0, command.argv.join(' '));
        assert.ok(startingIndex < startCalledIndex, command.argv.join(' '));
        assert.ok(startResolvedIndex < readyIndex, command.argv.join(' '));
    }
});
