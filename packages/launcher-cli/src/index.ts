/**
 * @description: CLI package export surface for launcher command orchestration.
 * @footnote-scope: interface
 * @footnote-module: LauncherCliExports
 * @footnote-risk: low - Export mistakes can break integration points but are easy to detect.
 * @footnote-ethics: low - Export-only module with no direct runtime or policy impact.
 */

export { runCli, runCliWithExitCode } from './cli.js';
