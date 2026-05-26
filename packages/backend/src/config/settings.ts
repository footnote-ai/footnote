/**
 * @description: Loads canonical footnote.yaml settings and enforces source boundaries.
 * @footnote-scope: core
 * @footnote-module: BackendSettingsLoader
 * @footnote-risk: high - Misparsed settings can route runtime controls to unintended behavior.
 * @footnote-ethics: medium - Clear secret/runtime boundaries protect operator intent and governance posture.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { envConfigSourceByKey, envDefaultValues } from '@footnote/config-spec';
import {
    envPathSourceEntries,
    settingsSpecEntries,
    type SettingsValueKind,
} from './settings-spec.js';
import type { WarningSink } from './types.js';

type YamlModule = { load(input: string): unknown };
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as YamlModule;

const DEFAULT_SETTINGS_PATH = '/data/config/footnote.yaml';
const KEBAB_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const JSON_SETTINGS_POINTERS = new Set(
    envPathSourceEntries
        .filter(
            (entry) => entry.source === 'settings_yaml' && entry.kind === 'json'
        )
        .map((entry) => `root.${entry.path.join('.')}`)
);

type SettingsScalar = string | number | boolean | string[];
type SettingsMap = Record<string, SettingsScalar>;

type CanonicalDiscordBot = {
    id?: string;
    enabled?: boolean;
    required?: boolean;
    credentials?: {
        discordTokenEnv?: string;
        discordClientIdEnv?: string;
        discordGuildIdsEnv?: string;
        discordUserIdEnv?: string;
        incidentSecretEnv?: string;
    };
    profile?: {
        id?: string;
        displayName?: string;
        overlayPath?: string;
        mentionAliases?: string[];
    };
};

export type FootnoteSettings = {
    version: number;
    'discord-bots': CanonicalDiscordBot[];
    settingsEnv: SettingsMap;
};

export type ServerSettingsValidationErrorCategory =
    | 'yaml_parse_error'
    | 'invalid_root'
    | 'legacy_shape_removed'
    | 'invalid_key_format'
    | 'unsupported_key'
    | 'secret_key_forbidden'
    | 'bootstrap_key_forbidden'
    | 'invalid_version'
    | 'type_mismatch';

export class ServerSettingsValidationError extends Error {
    category: ServerSettingsValidationErrorCategory;
    pointer: string | null;

    constructor(args: {
        message: string;
        category: ServerSettingsValidationErrorCategory;
        pointer?: string | null;
        cause?: unknown;
    }) {
        super(args.message, args.cause ? { cause: args.cause } : undefined);
        this.name = 'ServerSettingsValidationError';
        this.category = args.category;
        this.pointer = args.pointer ?? null;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const resolveSettingsPath = (value: string | undefined): string =>
    value?.trim() || DEFAULT_SETTINGS_PATH;

const validateKebabCaseKeys = (value: unknown, pointer = 'root'): void => {
    if (JSON_SETTINGS_POINTERS.has(pointer)) {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) =>
            validateKebabCaseKeys(entry, `${pointer}[${index}]`)
        );
        return;
    }
    if (!isRecord(value)) {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (!KEBAB_KEY_PATTERN.test(key)) {
            throw new ServerSettingsValidationError({
                message: `Invalid key "${key}" at ${pointer}. Use kebab-case keys in footnote.yaml.`,
                category: 'invalid_key_format',
                pointer: pointer === 'root' ? key : `${pointer}.${key}`,
            });
        }
        validateKebabCaseKeys(child, `${pointer}.${key}`);
    }
};

const getNestedValue = (root: unknown, path: readonly string[]): unknown => {
    let current: unknown = root;
    for (const segment of path) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
};

const validateSettingValue = (
    kind: SettingsValueKind,
    value: unknown,
    keyPath: string
): SettingsScalar => {
    switch (kind) {
        case 'boolean':
            if (typeof value !== 'boolean') {
                throw new ServerSettingsValidationError({
                    message: `${keyPath} must be a boolean.`,
                    category: 'type_mismatch',
                    pointer: keyPath,
                });
            }
            return value;
        case 'integer':
            if (
                typeof value !== 'number' ||
                Number.isNaN(value) ||
                !Number.isInteger(value)
            ) {
                throw new ServerSettingsValidationError({
                    message: `${keyPath} must be an integer.`,
                    category: 'type_mismatch',
                    pointer: keyPath,
                });
            }
            return value;
        case 'number':
            if (typeof value !== 'number' || Number.isNaN(value)) {
                throw new ServerSettingsValidationError({
                    message: `${keyPath} must be a number.`,
                    category: 'type_mismatch',
                    pointer: keyPath,
                });
            }
            return value;
        case 'csv':
            if (Array.isArray(value)) {
                if (!value.every((entry) => typeof entry === 'string')) {
                    throw new ServerSettingsValidationError({
                        message: `${keyPath} array entries must be strings.`,
                        category: 'type_mismatch',
                        pointer: keyPath,
                    });
                }
                return value;
            }
            if (typeof value !== 'string') {
                throw new ServerSettingsValidationError({
                    message: `${keyPath} must be a comma-separated string or string array.`,
                    category: 'type_mismatch',
                    pointer: keyPath,
                });
            }
            return value;
        case 'json':
            if (!isRecord(value)) {
                throw new ServerSettingsValidationError({
                    message: `${keyPath} must be an object.`,
                    category: 'type_mismatch',
                    pointer: keyPath,
                });
            }
            return JSON.stringify(value);
        default:
            if (typeof value !== 'string') {
                throw new ServerSettingsValidationError({
                    message: `${keyPath} must be a string.`,
                    category: 'type_mismatch',
                    pointer: keyPath,
                });
            }
            return value;
    }
};

const serializeSettingValue = (value: SettingsScalar): string =>
    Array.isArray(value) ? value.join(',') : String(value);

type SourceNode = {
    children: Map<string, SourceNode>;
    envKey?: string;
    source?: 'secret_env' | 'settings_yaml' | 'bootstrap_env';
    kind?: SettingsValueKind;
};

const createSourceTree = (): SourceNode => {
    const root: SourceNode = { children: new Map() };

    for (const entry of envPathSourceEntries) {
        let cursor = root;
        for (const segment of entry.path) {
            const next = cursor.children.get(segment) ?? {
                children: new Map(),
            };
            cursor.children.set(segment, next);
            cursor = next;
        }
        cursor.envKey = entry.envKey;
        cursor.source = entry.source;
        cursor.kind = entry.kind;
    }

    return root;
};

const SOURCE_TREE = createSourceTree();

const validateSupportedSettingsKeys = (
    root: Record<string, unknown>,
    pointer = 'root',
    node: SourceNode = SOURCE_TREE
): void => {
    for (const [key, value] of Object.entries(root)) {
        if (
            pointer === 'root' &&
            (key === 'version' || key === 'discord-bots')
        ) {
            continue;
        }

        const path = pointer === 'root' ? key : `${pointer}.${key}`;
        const next = node.children.get(key);
        if (!next) {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML: ${path} is not a supported key.`,
                category: 'unsupported_key',
                pointer: path,
            });
        }

        if (next.source === 'secret_env') {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML: ${path} maps to secret env key ${next.envKey} and is not YAML-configurable.`,
                category: 'secret_key_forbidden',
                pointer: path,
            });
        }

        if (next.source === 'bootstrap_env') {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML: ${path} maps to bootstrap env key ${next.envKey} and is not YAML-configurable.`,
                category: 'bootstrap_key_forbidden',
                pointer: path,
            });
        }

        if (next.children.size > 0) {
            if (!isRecord(value)) {
                throw new ServerSettingsValidationError({
                    message: `Invalid server settings YAML: ${path} must be an object.`,
                    category: 'type_mismatch',
                    pointer: path,
                });
            }
            validateSupportedSettingsKeys(value, path, next);
            continue;
        }

        if (isRecord(value) && next.kind !== 'json') {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML: ${path} must be a scalar or array value.`,
                category: 'type_mismatch',
                pointer: path,
            });
        }
    }
};

const normalizeDiscordBots = (value: unknown, settingsPath: string) => {
    if (value === undefined) {
        return [] as CanonicalDiscordBot[];
    }
    if (!Array.isArray(value)) {
        throw new ServerSettingsValidationError({
            message: `Invalid server settings YAML at ${settingsPath}: discord-bots must be an array when provided.`,
            category: 'type_mismatch',
            pointer: 'discord-bots',
        });
    }

    return value.map((entry, index): CanonicalDiscordBot => {
        const botPointer = `discord-bots[${index}]`;
        if (!isRecord(entry)) {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML at ${settingsPath}: ${botPointer} must be an object.`,
                category: 'type_mismatch',
                pointer: botPointer,
            });
        }
        const allowedBotKeys = new Set([
            'id',
            'enabled',
            'required',
            'credentials',
            'profile',
        ]);
        for (const key of Object.keys(entry)) {
            if (!allowedBotKeys.has(key)) {
                throw new ServerSettingsValidationError({
                    message: `Invalid server settings YAML at ${settingsPath}: ${botPointer} contains unsupported key "${key}".`,
                    category: 'unsupported_key',
                    pointer: `${botPointer}.${key}`,
                });
            }
        }

        const credentialsSource = entry['credentials'];
        const profileSource = entry['profile'];
        const credentialsRecord = isRecord(credentialsSource)
            ? credentialsSource
            : undefined;
        const profileRecord = isRecord(profileSource)
            ? profileSource
            : undefined;
        const allowedCredentialKeys = new Set([
            'discord-token-env',
            'discord-client-id-env',
            'discord-guild-ids-env',
            'discord-user-id-env',
            'incident-secret-env',
        ]);
        if (credentialsSource !== undefined) {
            if (!isRecord(credentialsSource)) {
                throw new ServerSettingsValidationError({
                    message: `Invalid server settings YAML at ${settingsPath}: ${botPointer}.credentials must be an object.`,
                    category: 'type_mismatch',
                    pointer: `${botPointer}.credentials`,
                });
            }
            for (const key of Object.keys(credentialsSource)) {
                if (!allowedCredentialKeys.has(key)) {
                    throw new ServerSettingsValidationError({
                        message: `Invalid server settings YAML at ${settingsPath}: ${botPointer}.credentials contains unsupported key "${key}".`,
                        category: 'unsupported_key',
                        pointer: `${botPointer}.credentials.${key}`,
                    });
                }
            }
        }
        const allowedProfileKeys = new Set([
            'id',
            'display-name',
            'overlay-path',
            'mention-aliases',
        ]);
        if (profileSource !== undefined) {
            if (!isRecord(profileSource)) {
                throw new ServerSettingsValidationError({
                    message: `Invalid server settings YAML at ${settingsPath}: ${botPointer}.profile must be an object.`,
                    category: 'type_mismatch',
                    pointer: `${botPointer}.profile`,
                });
            }
            for (const key of Object.keys(profileSource)) {
                if (!allowedProfileKeys.has(key)) {
                    throw new ServerSettingsValidationError({
                        message: `Invalid server settings YAML at ${settingsPath}: ${botPointer}.profile contains unsupported key "${key}".`,
                        category: 'unsupported_key',
                        pointer: `${botPointer}.profile.${key}`,
                    });
                }
            }
        }
        const mentionAliases = isRecord(profileSource)
            ? profileSource['mention-aliases']
            : undefined;
        if (
            mentionAliases !== undefined &&
            (!Array.isArray(mentionAliases) ||
                !mentionAliases.every((entry) => typeof entry === 'string'))
        ) {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML at ${settingsPath}: ${botPointer}.profile.mention-aliases must be an array of strings.`,
                category: 'type_mismatch',
                pointer: `${botPointer}.profile.mention-aliases`,
            });
        }

        const credentialsObj = {
            discordTokenEnv:
                typeof credentialsRecord?.['discord-token-env'] === 'string'
                    ? credentialsRecord['discord-token-env']
                    : undefined,
            discordClientIdEnv:
                typeof credentialsRecord?.['discord-client-id-env'] === 'string'
                    ? credentialsRecord['discord-client-id-env']
                    : undefined,
            discordGuildIdsEnv:
                typeof credentialsRecord?.['discord-guild-ids-env'] === 'string'
                    ? credentialsRecord['discord-guild-ids-env']
                    : undefined,
            discordUserIdEnv:
                typeof credentialsRecord?.['discord-user-id-env'] === 'string'
                    ? credentialsRecord['discord-user-id-env']
                    : undefined,
            incidentSecretEnv:
                typeof credentialsRecord?.['incident-secret-env'] === 'string'
                    ? credentialsRecord['incident-secret-env']
                    : undefined,
        };
        const hasCredentials = Object.values(credentialsObj).some(
            (value) => value !== undefined
        );

        const profileObj = {
            id:
                typeof profileRecord?.['id'] === 'string'
                    ? profileRecord['id']
                    : undefined,
            displayName:
                typeof profileRecord?.['display-name'] === 'string'
                    ? profileRecord['display-name']
                    : undefined,
            overlayPath:
                typeof profileRecord?.['overlay-path'] === 'string'
                    ? profileRecord['overlay-path']
                    : undefined,
            mentionAliases:
                Array.isArray(mentionAliases) && mentionAliases.length > 0
                    ? (mentionAliases as string[])
                    : undefined,
        };
        const hasProfile = Object.values(profileObj).some(
            (value) => value !== undefined
        );

        return {
            id: typeof entry.id === 'string' ? entry.id : undefined,
            enabled:
                typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
            required:
                typeof entry.required === 'boolean'
                    ? entry.required
                    : undefined,
            ...(hasCredentials ? { credentials: credentialsObj } : {}),
            ...(hasProfile ? { profile: profileObj } : {}),
        };
    });
};

/**
 * `parseServerSettingsYaml` is a pure boundary validator and normalizer for server settings YAML.
 *
 * Inputs:
 * - `rawText`: YAML source text to parse and validate.
 * - `settingsPath`: source path used for actionable validation error messages.
 *
 * Outputs:
 * - `yamlSettings`: canonical `FootnoteSettings` (normalized version, discord-bots, and settings map).
 * - `yamlEnv`: `NodeJS.ProcessEnv` projection of YAML-configurable non-secret keys.
 *
 * Fail-closed behavior:
 * - Throws on malformed YAML, invalid root/shape, unsupported keys, forbidden secret/bootstrap keys,
 *   type mismatches, or invalid version.
 * - Secrets/bootstrap credentials in YAML are rejected by source-boundary validation, not projected.
 *
 * Authority and side effects:
 * - No external I/O or mutations; this function only parses/validates and returns derived objects.
 * - `yamlEnv` is produced from validated setting specs so downstream runtime config can consume
 *   YAML-backed values through env-shaped interfaces.
 */
export const parseServerSettingsYaml = ({
    rawText,
    settingsPath,
}: {
    rawText: string;
    settingsPath: string;
}): {
    yamlSettings: FootnoteSettings;
    yamlEnv: NodeJS.ProcessEnv;
} => {
    let parsed: unknown;
    try {
        parsed = yaml.load(rawText);
    } catch (error) {
        throw new ServerSettingsValidationError({
            message: `Invalid server settings YAML at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
            category: 'yaml_parse_error',
            cause: error,
        });
    }

    if (!isRecord(parsed)) {
        throw new ServerSettingsValidationError({
            message: `Invalid server settings YAML at ${settingsPath}: root must be an object.`,
            category: 'invalid_root',
            pointer: 'root',
        });
    }

    if ('settings' in parsed) {
        if (
            isRecord(parsed.settings) &&
            isRecord(parsed.settings['localNodes']) &&
            parsed.settings['localNodes']['configPath'] !== undefined
        ) {
            throw new ServerSettingsValidationError({
                message: `Invalid server settings YAML at ${settingsPath}: settings.localNodes.configPath is removed. Configure bots under top-level discord-bots.`,
                category: 'legacy_shape_removed',
                pointer: 'settings.localNodes.configPath',
            });
        }
        throw new ServerSettingsValidationError({
            message: `Invalid server settings YAML at ${settingsPath}: legacy settings.* shape is removed. Use top-level kebab-case keys in footnote.yaml.`,
            category: 'legacy_shape_removed',
            pointer: 'settings',
        });
    }

    validateKebabCaseKeys(parsed);
    validateSupportedSettingsKeys(parsed);

    const version = parsed.version;
    if (version !== 1) {
        throw new ServerSettingsValidationError({
            message: `Invalid server settings YAML at ${settingsPath}: version must be 1.`,
            category: 'invalid_version',
            pointer: 'version',
        });
    }

    const settingsEnv: SettingsMap = {};
    const yamlEnv: NodeJS.ProcessEnv = {};
    for (const specEntry of settingsSpecEntries) {
        const rawValue = getNestedValue(parsed, specEntry.path);
        if (rawValue === undefined) {
            continue;
        }
        const keyPath = specEntry.path.join('.');
        const normalized = validateSettingValue(
            specEntry.kind,
            rawValue,
            keyPath
        );
        settingsEnv[keyPath] = normalized;
        yamlEnv[specEntry.envKey] = serializeSettingValue(normalized);
    }

    const discordBots = normalizeDiscordBots(
        parsed['discord-bots'],
        settingsPath
    );
    return {
        yamlSettings: {
            version: 1,
            'discord-bots': discordBots,
            settingsEnv,
        },
        yamlEnv,
    };
};

/**
 * `loadServerSettings` reads the canonical `footnote.yaml` settings plane and
 * converts YAML-backed non-secret keys into an env-like map for downstream
 * config builders.
 *
 * Source boundary:
 * - `env` is trusted only for bootstrap path selection (`FOOTNOTE_SETTINGS_PATH`)
 * - YAML is trusted for non-secret runtime settings only
 * - secret/bootstrap settings inside YAML are rejected as invalid
 *
 * Behavior:
 * - Missing YAML file (`ENOENT`): fail-open, calls `warn`, returns defaults-only shape
 * - Present but invalid YAML/schema: fail-closed by throwing actionable errors
 *
 * Side effects:
 * - Reads a file from disk
 * - Emits warnings through `warn` for missing optional settings file
 *
 * @param env Process environment used only for bootstrap path resolution.
 * @param warn Warning sink for fail-open missing-file notices.
 * @returns `{ settingsPath, yamlSettings, yamlEnv }` where `yamlEnv` contains
 * env-key/value projections for YAML-configurable non-secret settings.
 */
export const loadServerSettings = (
    env: NodeJS.ProcessEnv,
    warn: WarningSink
): {
    settingsPath: string;
    yamlSettings: FootnoteSettings | null;
    yamlEnv: NodeJS.ProcessEnv;
} => {
    const settingsPath = resolveSettingsPath(env.FOOTNOTE_SETTINGS_PATH);
    let rawText: string;
    try {
        rawText = fs.readFileSync(settingsPath, 'utf8');
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
            if (env.NODE_ENV !== 'test') {
                warn(
                    `Server settings YAML not found at ${settingsPath}. Starting with defaults and env-only secrets/bootstrap wiring.`
                );
            }
            return { settingsPath, yamlSettings: null, yamlEnv: {} };
        }
        throw new Error(
            `Failed to read server settings YAML at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        );
    }
    const { yamlSettings, yamlEnv } = parseServerSettingsYaml({
        rawText,
        settingsPath,
    });
    return { settingsPath, yamlSettings, yamlEnv };
};

/**
 * `buildEffectiveConfigEnv` assembles the runtime env snapshot used by config
 * section builders after source-boundary enforcement.
 *
 * Source boundary:
 * - includes process env values for `secret_env` and `bootstrap_env` keys only
 * - applies YAML-projected values for `settings_yaml` keys only
 *
 * @param processEnv Raw process env snapshot.
 * @param yamlEnv YAML-projected non-secret settings keyed by env variable name.
 * @returns Effective env snapshot for downstream config section parsing.
 */
export const buildEffectiveConfigEnv = (
    processEnv: NodeJS.ProcessEnv,
    yamlEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
    const effectiveEnv: NodeJS.ProcessEnv = {};

    for (const [key, source] of Object.entries(envConfigSourceByKey)) {
        if (source === 'settings_yaml') {
            continue;
        }
        const value = processEnv[key];
        if (typeof value === 'string') {
            effectiveEnv[key] = value;
        }
    }

    for (const [key, value] of Object.entries(yamlEnv)) {
        effectiveEnv[key] = value;
    }

    effectiveEnv.FOOTNOTE_SETTINGS_PATH =
        processEnv.FOOTNOTE_SETTINGS_PATH ??
        envDefaultValues.FOOTNOTE_SETTINGS_PATH;

    return effectiveEnv;
};
