/**
 * @description: Re-exports canonical footnote.yaml spec mapping from shared config-spec authority.
 * @footnote-scope: interface
 * @footnote-module: FootnoteSettingsSpec
 * @footnote-risk: low - Thin re-export keeps backend and template path semantics aligned.
 * @footnote-ethics: low - Shared spec authority improves operator-facing consistency.
 */

export {
    envPathSourceEntries,
    settingsSpecEntries,
} from '@footnote/config-spec';

export type {
    SettingsSpecEntry,
    SettingsValueKind,
} from '@footnote/config-spec';
