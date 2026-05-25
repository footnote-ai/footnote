/**
 * @description: Public entry point for shared env metadata and canonical defaults.
 * @footnote-scope: interface
 * @footnote-module: ConfigSpecIndex
 * @footnote-risk: medium - Incorrect exports can create config drift across packages.
 * @footnote-ethics: medium - Central config metadata influences safety-related defaults and operator understanding.
 */

export {
    defineEnv,
    derived,
    literal,
    noDefault,
    runtime,
} from './env-factories.js';
export {
    envConfigSourceByKey,
    envDefaultValues,
    envEntries,
    envSpec,
    envSpecByKey,
} from './env-spec.js';
export {
    envPathSourceEntries,
    settingsSpecEntries,
    toKebabCase,
} from './settings-spec.js';
export {
    buildSettingsTemplateModel,
    renderSettingsTemplateYaml,
    resolveTemplateTarget,
} from './settings-template.js';
export type {
    EnvPathSourceEntry,
    SettingsDefaultValue,
    SettingsSpecEntry,
    SettingsValueKind,
} from './settings-spec.js';
export type {
    ResolvedTemplateTarget,
    TemplateField,
    TemplateModel,
    TemplateRenderedDefault,
    TemplateTarget,
} from './settings-template.js';
export type {
    ConfigSource,
    EnvDefault,
    EnvLiteralValue,
    EnvOwner,
    EnvSpecEntry,
    EnvStage,
    EnvValueKind,
} from './types.js';
