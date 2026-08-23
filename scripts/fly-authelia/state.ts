/**
 * @description: Reads and writes the sanitized local deployment state used to make Authelia reruns deterministic.
 * @footnote-scope: utility
 * @footnote-module: FlyAutheliaState
 * @footnote-risk: high - State mistakes can cause credential rotation, orphaned resources, or unsafe recovery guesses.
 * @footnote-ethics: high - State files make identity ownership and recovery inspectable without retaining plaintext secrets.
 */

import fs from 'node:fs';
import { readText, writeText } from './runtime.js';
import type { ExistingState, SafeState } from './types.js';

export const buildSafeState = (input: SafeState): SafeState => ({ ...input });

export const loadState = async (statePath: string): Promise<ExistingState> => {
    const parsed: unknown = JSON.parse(await readText(statePath));
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        (parsed as { provider?: unknown }).provider !== 'authelia' ||
        (parsed as { version?: unknown }).version !== 1
    ) {
        throw new Error(`Invalid Authelia deployment state: ${statePath}`);
    }
    return parsed as ExistingState;
};

export const hasState = (statePath: string): boolean =>
    fs.existsSync(statePath);

export const saveState = async (
    statePath: string,
    state: SafeState
): Promise<void> => {
    await writeText(statePath, `${JSON.stringify(state, null, 2)}\n`);
};
