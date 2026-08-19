/**
 * @description: Tests launcher lifecycle output and its machine-readable shape.
 * @footnote-scope: test
 * @footnote-module: LauncherCliLifecycleTests
 * @footnote-risk: low - Output regressions can mislead operators about readiness.
 * @footnote-ethics: medium - Honest lifecycle output preserves operator control.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { writeRuntimeLifecycleEvent } from './lifecycle.js';
import type { CommandContext } from './types.js';

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
