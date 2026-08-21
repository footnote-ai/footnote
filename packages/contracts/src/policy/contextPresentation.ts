/**
 * @description: Builds short, reader-facing summaries for project and GitHub context metadata.
 * The summaries keep source status and result limits visible without exposing provider or auth details.
 * @footnote-scope: utility
 * @footnote-module: ContextPresentation
 * @footnote-risk: low - Incorrect summaries could make bounded evidence look complete.
 * @footnote-ethics: high - Clear freshness and coverage wording supports informed trust.
 */
import type { GitHubContextMetadata } from './types.js';
import type { ProjectContextMetadata } from './projectContext.js';

const STATUS_LABELS: Record<ProjectContextMetadata['status'], string> = {
    current: 'current',
    partial: 'partial',
    stale: 'stale',
    unavailable: 'unavailable',
};

const GITHUB_SECTION_LABELS: Record<string, string> = {
    repository: 'repository records',
    issues: 'issues',
    pulls: 'pull requests',
    releases: 'releases',
    commits: 'commits',
};

const totalProjectMatches = (metadata: ProjectContextMetadata): number =>
    Object.values(metadata.returnedCounts).reduce(
        (total, count) => total + (count ?? 0),
        0
    );

const formatTimestamp = (value: string | undefined): string =>
    value ? ` at ${value}` : '';

export const formatProjectContextSummary = (
    metadata: ProjectContextMetadata
): string => {
    const count = totalProjectMatches(metadata);
    const evidence = `${count} document excerpt${count === 1 ? '' : 's'} retrieved`;
    const coverage = Object.values(metadata.returnedCounts).some(
        (value) => (value ?? 0) >= metadata.topKPerCategory
    )
        ? ' Results may be limited; counts are bounded excerpts, not document totals.'
        : '';
    return `Project documents: ${STATUS_LABELS[metadata.status]}; ${evidence}${formatTimestamp(metadata.indexedAt)}.${coverage}`;
};

export const formatGitHubContextSummary = (
    metadata: GitHubContextMetadata
): string => {
    const records = metadata.requestedSections.flatMap((section) => {
        const count = metadata.returnedCounts[section];
        return count === undefined
            ? []
            : [`${count} ${GITHUB_SECTION_LABELS[section] ?? section}`];
    });
    const coverage =
        metadata.maxRecordsPerSection !== undefined &&
        metadata.requestedSections.some(
            (section) =>
                (metadata.returnedCounts[section] ?? 0) >=
                metadata.maxRecordsPerSection!
        )
            ? ' Results may be limited; counts are not repository totals.'
            : '';
    const recordSummary =
        records.length > 0 ? records.join(', ') : 'no records';
    return `GitHub: ${metadata.status}; ${recordSummary} retrieved${formatTimestamp(metadata.fetchTimestamp)}.${coverage}`;
};

export const buildContextPresentationSummary = (input: {
    projectContext?: ProjectContextMetadata;
    githubContext?: GitHubContextMetadata;
}): string[] => [
    ...(input.projectContext
        ? [formatProjectContextSummary(input.projectContext)]
        : []),
    ...(input.githubContext
        ? [formatGitHubContextSummary(input.githubContext)]
        : []),
];
