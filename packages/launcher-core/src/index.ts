/**
 * @description: Public exports for launcher-core runtime-agnostic utilities and contracts.
 * @footnote-scope: interface
 * @footnote-module: LauncherCore
 * @footnote-risk: medium - Export drift can break launcher consumers and runtime wiring.
 * @footnote-ethics: low - Shared exports improve consistency and maintainability.
 */

export { bootstrapConfigFiles, createDefaultMetadata } from './bootstrap.js';
export { resolveConfigPaths, resolveDefaultConfigRoot } from './configRoot.js';
export {
    LauncherError,
    isLauncherError,
    type LauncherErrorKind,
} from './errors.js';
export { openInBrowser } from './browser.js';
export {
    computeConfigRootHash,
    DEFAULT_IMAGE_REPOSITORY,
    DEFAULT_IMAGE_TAG,
    DEFAULT_INSTANCE_NAME,
    DEFAULT_METADATA,
    readLauncherMetadata,
    writeLauncherMetadata,
} from './metadata.js';
export { formatMessage, formatSteps, type MessageTone } from './messages.js';
export { selectAvailablePort } from './port.js';
export { ensureWebLocalUrlInSettings } from './settings.js';
export type {
    BootstrapResult,
    FootnoteRuntime,
    LauncherConfigPaths,
    LauncherMetadata,
    LogLine,
    LogsInput,
    ManagedResourceLabels,
    RuntimeKind,
    RuntimeState,
    StartInput,
    StartResult,
    StatusInput,
    StatusResult,
    StopInput,
    StopResult,
} from './types.js';
