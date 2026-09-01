/**
 * @description: Canonical footnote.yaml path and source mapping derived from shared env metadata.
 * @footnote-scope: interface
 * @footnote-module: SettingsSpec
 * @footnote-risk: medium - Incorrect mapping can misclassify YAML keys or break source-boundary validation.
 * @footnote-ethics: medium - Correct mapping preserves operator control while keeping secrets out of YAML.
 */

import { envConfigSourceByKey, envEntries } from './env-spec.js';
import type { EnvLiteralValue } from './types.js';

export type SettingsValueKind =
    'string' | 'boolean' | 'integer' | 'number' | 'csv' | 'enum' | 'json';

export type SettingsDefaultValue =
    string | number | boolean | readonly string[];

export type SettingsSpecEntry = {
    envKey: string;
    section: string;
    path: readonly string[];
    kind: SettingsValueKind;
    description: string;
    defaultValue?: SettingsDefaultValue;
    templateDefaultValue?: EnvLiteralValue;
    defaultKind: 'literal' | 'derived' | 'none' | 'runtime';
    derivedDescription?: string;
    allowedValues?: readonly string[];
};

export type EnvPathSourceEntry = {
    envKey: string;
    path: readonly string[];
    source: 'secret_env' | 'settings_yaml' | 'bootstrap_env';
    kind: SettingsValueKind;
};

const toKebabCase = (value: string): string =>
    value.replace(/_/g, '-').replace(/\s+/g, '-').toLowerCase();

const ENV_PATH_OVERRIDES: Record<string, string[]> = {
    HOST: ['server', 'host'],
    PORT: ['server', 'port'],
    DATA_DIR: ['server', 'data-dir'],
    WEB_TRUST_PROXY: ['server', 'trust-proxy'],
    ALLOWED_ORIGINS: ['web', 'allowed-origins'],
    FRAME_ANCESTORS: ['web', 'frame-ancestors'],
    CHAT_WORKFLOW_MAX_TOKENS_TOTAL_OVERRIDE: [
        'chat-workflow',
        'max-tokens-total-override',
    ],
};

const resolveEnvPath = (entry: { key: string; section: string }): string[] =>
    ENV_PATH_OVERRIDES[entry.key] ?? [
        toKebabCase(entry.section),
        toKebabCase(entry.key),
    ];

const resolveConfigSource = (
    key: string
): 'secret_env' | 'settings_yaml' | 'bootstrap_env' => {
    const source =
        envConfigSourceByKey[key as keyof typeof envConfigSourceByKey];
    if (!source) {
        throw new Error(
            `Missing env config source mapping for key "${key}" in envConfigSourceByKey.`
        );
    }
    return source;
};

const freezeStringArray = (value: readonly string[]): readonly string[] =>
    Object.freeze([...value]);

const resolveFrozenDefaultValue = (
    value: EnvLiteralValue
): SettingsDefaultValue | undefined => {
    if (Array.isArray(value)) {
        return freezeStringArray(value);
    }
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }
    return undefined;
};

export const envPathSourceEntries: ReadonlyArray<EnvPathSourceEntry> =
    Object.freeze(
        envEntries
            .filter(
                (entry) => !('isPattern' in entry && entry.isPattern === true)
            )
            .filter((entry) => entry.section !== 'discord-bot')
            .map((entry) => {
                const path = freezeStringArray(resolveEnvPath(entry));
                return Object.freeze({
                    envKey: entry.key,
                    path,
                    source: resolveConfigSource(entry.key),
                    kind: entry.kind as SettingsValueKind,
                });
            })
    );

export const settingsSpecEntries: ReadonlyArray<SettingsSpecEntry> =
    Object.freeze(
        envEntries
            .filter(
                (entry) => !('isPattern' in entry && entry.isPattern === true)
            )
            .filter((entry) => entry.section !== 'discord-bot')
            .filter(
                (entry) => resolveConfigSource(entry.key) === 'settings_yaml'
            )
            .map((entry) => {
                const path = freezeStringArray(resolveEnvPath(entry));
                const literalDefaultValue =
                    entry.defaultValue.kind === 'literal'
                        ? resolveFrozenDefaultValue(entry.defaultValue.value)
                        : undefined;
                const allowedValues =
                    'allowedValues' in entry &&
                    Array.isArray(entry.allowedValues)
                        ? freezeStringArray(entry.allowedValues)
                        : undefined;

                return Object.freeze({
                    envKey: entry.key,
                    section: toKebabCase(entry.section),
                    path,
                    kind: entry.kind as SettingsValueKind,
                    description: entry.description,
                    defaultValue: literalDefaultValue,
                    templateDefaultValue:
                        entry.defaultValue.kind === 'literal'
                            ? entry.defaultValue.value
                            : undefined,
                    defaultKind: entry.defaultValue.kind,
                    derivedDescription:
                        entry.defaultValue.kind === 'derived'
                            ? entry.defaultValue.description
                            : undefined,
                    allowedValues,
                });
            })
            .sort((left, right) =>
                left.path.join('.').localeCompare(right.path.join('.'))
            )
    );

export { toKebabCase };
