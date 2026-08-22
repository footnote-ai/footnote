/**
 * @description: Backend chat helpers for repo-aware search instructions and response hints.
 * @footnote-scope: core
 * @footnote-module: ChatGenerationHints
 * @footnote-risk: medium - Bad hint construction can degrade retrieval quality or mislead the model.
 * @footnote-ethics: medium - Repo-aware hints affect how accurately Footnote explains itself.
 */
import type { GenerationSearchRequest } from '@footnote/agent-runtime';
import {
    chatTopicHintQueryTerms,
    PROJECT_CONTEXT_CANONICAL_REPOSITORY,
} from '@footnote/contracts';
import type {
    ChatGenerationGitHubContext,
    ChatGenerationPlan,
    ChatRepoSearchHint,
} from './chatGenerationTypes.js';

const DEEPWIKI_FOOTNOTE_URL = 'https://deepwiki.com/footnote-ai/footnote';

/**
 * Canonical Footnote repository used for Footnote-self project-context routing.
 */
export { PROJECT_CONTEXT_CANONICAL_REPOSITORY };

export type ChatGenerationProjectContextRoute = {
    repository: string;
    query: string;
};

/**
 * Explicit Footnote-self acceptance seam.
 *
 * `repo_explainer` planner intent is the signal that a user is asking about
 * Footnote itself. This routes to the canonical repository without requiring
 * the slug to appear in user text, so questions like "what work is currently
 * open?" reach project context.
 */
export const buildProjectContextRouteFromPlan = (
    generation: Pick<ChatGenerationPlan, 'search'>
): ChatGenerationProjectContextRoute | undefined => {
    if (generation.search?.intent !== 'repo_explainer') return undefined;
    const query = generation.search.query.trim();
    if (!query) return undefined;
    return {
        repository: PROJECT_CONTEXT_CANONICAL_REPOSITORY,
        query,
    };
};

const CURRENT_PROJECT_QUERY_PATTERN =
    /\b(current(?:ly)?|now|open|latest|recent|activity|release|releases|issues?|pull requests?|status|work(?:ing)?|team)\b/iu;

/**
 * Builds a backend-owned GitHub request for current Footnote-self questions.
 * Generic repository requests still require an exact user-authored slug; this
 * route is limited to the fixed Footnote repository and repo-explainer intent.
 */
export const buildFootnoteGitHubContextRouteFromPlan = (
    generation: Pick<ChatGenerationPlan, 'search'>
): ChatGenerationGitHubContext | undefined => {
    if (generation.search?.intent !== 'repo_explainer') return undefined;
    const query = generation.search.query.trim();
    if (!query || !CURRENT_PROJECT_QUERY_PATTERN.test(query)) return undefined;

    const sections: ChatGenerationGitHubContext['sections'] = [];
    if (/\b(open|issues?)\b/iu.test(query)) {
        sections.push('issues', 'pulls');
    }
    if (/\b(pull requests?|prs?)\b/iu.test(query)) {
        sections.push('pulls');
    }
    if (/\b(release|releases|latest)\b/iu.test(query)) {
        sections.push('releases');
    }
    if (
        /\b(recent|activity|current(?:ly)?|now|status|work(?:ing)?|team)\b/iu.test(
            query
        )
    ) {
        sections.push('commits');
    }

    const uniqueSections = [...new Set(sections)];
    if (uniqueSections.length === 0) return undefined;

    return {
        repository: PROJECT_CONTEXT_CANONICAL_REPOSITORY,
        sections: uniqueSections,
    };
};

const REPO_HINT_QUERY_TERMS: Record<ChatRepoSearchHint, string[]> = {
    architecture: ['architecture'],
    backend: ['backend'],
    contracts: ['contracts'],
    discord: ['discord'],
    images: ['image generation'],
    onboarding: ['onboarding', 'getting started'],
    web: ['web'],
    observability: ['observability'],
    openapi: ['openapi'],
    prompts: ['prompts'],
    provenance: ['provenance'],
    chat: ['chat'],
    traces: ['traces'],
    voice: ['voice'],
};

const isChatRepoSearchHint = (hint: string): hint is ChatRepoSearchHint =>
    hint in REPO_HINT_QUERY_TERMS;

const dedupeSearchTerms = (terms: string[]): string[] => {
    const seen = new Set<string>();
    const uniqueTerms: string[] = [];

    for (const term of terms) {
        const normalized = term.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        uniqueTerms.push(term.trim());
    }

    return uniqueTerms;
};

export const buildRepoExplainerQuery = (
    search: Pick<GenerationSearchRequest, 'query' | 'repoHints' | 'topicHints'>
): string =>
    dedupeSearchTerms([
        PROJECT_CONTEXT_CANONICAL_REPOSITORY,
        ...PROJECT_CONTEXT_CANONICAL_REPOSITORY.split('/'),
        'DeepWiki',
        ...(search.repoHints?.flatMap((hint) =>
            isChatRepoSearchHint(hint) ? REPO_HINT_QUERY_TERMS[hint] : [hint]
        ) ?? []),
        ...(search.topicHints?.flatMap((hint) => {
            const normalized = hint.trim().toLowerCase();
            return chatTopicHintQueryTerms[normalized] ?? [];
        }) ?? []),
        search.query.trim(),
    ]).join(' ');

export const buildWebSearchInstruction = (
    search: GenerationSearchRequest
): string => {
    if (search.intent === 'repo_explainer') {
        const repoQuery = buildRepoExplainerQuery(search);
        const hintText =
            (search.repoHints?.length ?? 0) > 0
                ? ` Focus areas: ${search.repoHints?.join(', ')}.`
                : '';
        const topicHintText =
            (search.topicHints?.length ?? 0) > 0
                ? ` Topic hints: ${search.topicHints?.join(', ')}.`
                : '';

        return [
            'The planner marked this as a Footnote repository explanation lookup.',
            `Treat ${PROJECT_CONTEXT_CANONICAL_REPOSITORY} as the canonical repo identity for this search.`,
            `Prefer DeepWiki results from ${DEEPWIKI_FOOTNOTE_URL} when they are relevant.`,
            'If DeepWiki coverage is thin, use broader web context instead of getting stuck.',
            `Search query: ${repoQuery}.${hintText}${topicHintText}`.trim(),
            `Original planner query: ${search.query.trim()}.`,
        ].join(' ');
    }

    const topicHintText =
        (search.topicHints?.length ?? 0) > 0
            ? ` Focus areas: ${search.topicHints?.join(', ')}.`
            : '';

    return `The planner instructed you to perform a web search for: ${search.query.trim()}.${topicHintText}`.trim();
};

export const buildRepoExplainerResponseHint = (
    generation: ChatGenerationPlan
): string | null => {
    if (generation.search?.intent !== 'repo_explainer') {
        return null;
    }

    return [
        'Planner note: this is a Footnote repo-explanation lookup.',
        'Prefer DeepWiki-backed explanation when available.',
        'Use broader web context if the wiki is thin.',
    ].join(' ');
};
