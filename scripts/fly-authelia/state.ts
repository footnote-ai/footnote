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

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const isExistingState = (value: unknown): value is ExistingState => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const state = value as Record<string, unknown>;
    const requiredStringFields = [
        'providerVersion',
        'image',
        'authAppName',
        'footnoteAppName',
        'region',
        'issuerUrl',
        'redirectUri',
        'username',
        'displayName',
        'email',
        'passwordHash',
        'clientSecretHash',
        'manifestPath',
        'configurationPath',
        'usersPath',
    ];
    return (
        state.provider === 'authelia' &&
        state.version === 1 &&
        requiredStringFields.every((field) => isNonEmptyString(state[field])) &&
        Array.isArray(state.secretNames) &&
        state.secretNames.every(isNonEmptyString)
    );
};

export const loadState = async (statePath: string): Promise<ExistingState> => {
    const parsed: unknown = JSON.parse(await readText(statePath));
    if (!isExistingState(parsed)) {
        throw new Error(`Invalid Authelia deployment state: ${statePath}`);
    }
    return parsed;
};

export const hasState = (statePath: string): boolean =>
    fs.existsSync(statePath);

export const saveState = async (
    statePath: string,
    state: SafeState
): Promise<void> => {
    await writeText(statePath, `${JSON.stringify(state, null, 2)}\n`);
};
