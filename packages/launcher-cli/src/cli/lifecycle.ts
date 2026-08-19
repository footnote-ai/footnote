/**
 * @description: Emits launcher lifecycle events alongside concise CLI output.
 * @footnote-scope: interface
 * @footnote-module: LauncherCliLifecycle
 * @footnote-risk: medium - Incorrect lifecycle output can mislead operators about runtime availability.
 * @footnote-ethics: medium - Honest readiness reporting supports informed operator decisions.
 */

import {
    createRuntimeLifecycleEvent,
    type RuntimeLifecyclePhase,
    type RuntimeReadinessBoundary,
} from '@footnote/launcher-core';
import type { CommandContext } from './types.js';
import { writeLine } from './writeLine.js';

/**
 * Writes one machine-readable lifecycle event. The command's normal success
 * message remains the human-readable companion to the ready event.
 */
export const writeRuntimeLifecycleEvent = (
    context: CommandContext,
    phase: RuntimeLifecyclePhase,
    readiness?: RuntimeReadinessBoundary
): void => {
    writeLine(
        context,
        JSON.stringify(
            createRuntimeLifecycleEvent(
                { service: 'launcher' },
                phase,
                readiness
            )
        )
    );
};
