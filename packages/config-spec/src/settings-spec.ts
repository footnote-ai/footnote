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
    | 'string'
    | 'boolean'
    | 'integer'
    | 'number'
    | 'csv'
    | 'enum'
    | 'json';

export type SettingsDefaultValue =
    | string
    | number
    | boolean
    | readonly string[];

export type SettingsSpecEntry = {
    envKey: string;
    section: string;
    path: string[];
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
    path: string[];
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

export const envPathSourceEntries: EnvPathSourceEntry[] = envEntries
    .filter((entry) => !('isPattern' in entry && entry.isPattern === true))
    .filter((entry) => entry.section !== 'discord-bot')
    .map((entry) => {
        return {
            envKey: entry.key,
            path: resolveEnvPath(entry),
            source: resolveConfigSource(entry.key),
            kind: entry.kind as SettingsValueKind,
        };
    });

export const settingsSpecEntries: SettingsSpecEntry[] = envEntries
    .filter((entry) => !('isPattern' in entry && entry.isPattern === true))
    .filter((entry) => entry.section !== 'discord-bot')
    .filter((entry) => resolveConfigSource(entry.key) === 'settings_yaml')
    .map((entry) => ({
        envKey: entry.key,
        section: toKebabCase(entry.section),
        path: resolveEnvPath(entry),
        kind: entry.kind as SettingsValueKind,
        description: entry.description,
        defaultValue:
            entry.defaultValue.kind === 'literal'
                ? Array.isArray(entry.defaultValue.value)
                    ? (entry.defaultValue.value as readonly string[])
                    : typeof entry.defaultValue.value === 'string' ||
                        typeof entry.defaultValue.value === 'number' ||
                        typeof entry.defaultValue.value === 'boolean'
                      ? (entry.defaultValue.value as SettingsDefaultValue)
                      : undefined
                : undefined,
        templateDefaultValue:
            entry.defaultValue.kind === 'literal'
                ? entry.defaultValue.value
                : undefined,
        defaultKind: entry.defaultValue.kind,
        derivedDescription:
            entry.defaultValue.kind === 'derived'
                ? entry.defaultValue.description
                : undefined,
        allowedValues:
            'allowedValues' in entry ? entry.allowedValues : undefined,
    }))
    .sort((left, right) =>
        left.path.join('.').localeCompare(right.path.join('.'))
    );

export { toKebabCase };
