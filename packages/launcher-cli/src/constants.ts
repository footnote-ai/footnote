/**
 * @description: Shared launcher CLI constants for image/source defaults and resource names.
 * @footnote-scope: core
 * @footnote-module: LauncherCliConstants
 * @footnote-risk: medium - Constant drift can break managed resource ownership and runtime defaults.
 * @footnote-ethics: low - Stable defaults support transparent, predictable operations.
 */

export const LAUNCHER_ID: string = 'launcher-cli-v1';
export const DEFAULT_PREFERRED_PORT: number = 8080;
export const DEFAULT_READINESS_TIMEOUT_MS: number = 90_000;
export const DEFAULT_CONTAINER_NAME: string = 'footnote-server';
export const DEFAULT_VOLUME_NAME: string = 'footnote_data';
