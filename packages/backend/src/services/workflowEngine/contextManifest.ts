/**
 * @description: Derives a compact generation-facing summary of conversation, prompt, and retrieval state.
 * It renders authoritative workflow facts without becoming a second provenance store.
 * @footnote-scope: core
 * @footnote-module: GenerationContextManifest
 * @footnote-risk: high - Incorrect status projection can make unavailable evidence look retrieved.
 * @footnote-ethics: high - Source boundaries affect whether people can tell what Footnote actually checked.
 */
import type {
    ContextStepRequest,
    ContextStepResult,
    GenerationContextManifest,
    GenerationContextManifestEntry,
    GenerationContextManifestStatus,
} from '@footnote/contracts/policy';
import type { ConversationContextEnvelope } from '../conversationContextService.js';

type IntegrationMetadataStatus =
    'current' | 'partial' | 'stale' | 'unavailable';

type ContextStepManifestFailure = {
    integrationName: string;
    requested: boolean;
    status: 'unavailable' | 'failed' | 'skipped';
};

const INTEGRATION_SCOPES: Record<string, string> = {
    github_context: 'bounded GitHub repository metadata',
    project_context: 'approved project documents',
    web_search: 'provider web search results',
    trustgraph: 'scoped advisory external evidence',
};

const integrationScope = (integrationName: string): string =>
    INTEGRATION_SCOPES[integrationName] ??
    `bounded ${integrationName} integration results`;

const readMetadataStatus = (
    result: ContextStepResult
): IntegrationMetadataStatus | undefined => {
    const payload = result.integrationContext?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return undefined;
    }
    const metadata = (payload as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return undefined;
    }
    const status = (metadata as { status?: unknown }).status;
    return status === 'current' ||
        status === 'partial' ||
        status === 'stale' ||
        status === 'unavailable'
        ? status
        : undefined;
};

const hasEvidence = (result: ContextStepResult): boolean => {
    if (result.outcome !== 'executed') return false;
    return (
        (result.evidence?.content.length ?? 0) > 0 ||
        (result.sources?.length ?? 0) > 0
    );
};

const evidenceCount = (result: ContextStepResult): number | undefined => {
    if (result.outcome !== 'executed' || !hasEvidence(result)) return undefined;
    return (result.sources?.length ?? 0) > 0
        ? result.sources?.length
        : result.evidence?.content.length;
};

const resolveStepStatus = (
    result: ContextStepResult,
    nativeWebSearchRequested: boolean
): GenerationContextManifestStatus => {
    const metadataStatus = readMetadataStatus(result);
    if (metadataStatus === 'unavailable') return 'unavailable';
    if (metadataStatus === 'partial') return 'partial';
    if (metadataStatus === 'stale') return 'stale';

    if (result.outcome === 'failed') return 'failed';
    if (result.outcome === 'needs_clarification') return 'skipped';
    if (result.outcome === 'skipped') {
        if (result.executionContext.reasonCode === 'tool_not_requested') {
            return 'not_requested';
        }
        return result.executionContext.reasonCode === 'tool_unavailable'
            ? 'unavailable'
            : 'skipped';
    }

    if (
        nativeWebSearchRequested &&
        result.executionContext.toolName === 'web_search' &&
        !hasEvidence(result)
    ) {
        return 'requested';
    }

    return hasEvidence(result) ? 'retrieved' : 'empty';
};

const buildIntegrationEntry = (
    result: ContextStepResult,
    requested: boolean,
    nativeWebSearchRequested: boolean
): GenerationContextManifestEntry => ({
    source: result.executionContext.toolName,
    authority: 'advisory',
    requested,
    status: resolveStepStatus(result, nativeWebSearchRequested),
    scope: integrationScope(result.executionContext.toolName),
    ...(evidenceCount(result) !== undefined && {
        evidenceCount: evidenceCount(result),
    }),
});

/**
 * Builds source state from the canonical conversation envelope and workflow
 * results. It does not inspect or index message content.
 */
export const buildGenerationContextManifest = (input: {
    contextEnvelope: ConversationContextEnvelope;
    contextStepRequests: ContextStepRequest[];
    contextStepResults: ContextStepResult[];
    contextStepFailures?: ContextStepManifestFailure[];
    webSearchRequested?: boolean;
    webSearchAvailable?: boolean;
}): GenerationContextManifest => {
    const resultIndexes = new Set<number>();
    const failuresByIntegration = new Map(
        input.contextStepFailures?.map((failure) => [
            failure.integrationName,
            failure,
        ]) ?? []
    );
    const nativeWebSearchRequested = input.webSearchRequested === true;

    const buildMissingResultEntry = (
        request: ContextStepRequest
    ): GenerationContextManifestEntry => {
        const failure = failuresByIntegration.get(request.integrationName);
        const status =
            failure?.status ??
            (request.requested
                ? request.eligible
                    ? 'requested'
                    : 'skipped'
                : 'not_requested');
        return {
            source: request.integrationName,
            authority: 'advisory',
            requested: request.requested,
            status,
            scope: integrationScope(request.integrationName),
        };
    };

    const integrationEntries = input.contextStepRequests.map((request) => {
        const resultIndex = input.contextStepResults.findIndex(
            (result, index) =>
                !resultIndexes.has(index) &&
                result.executionContext.toolName === request.integrationName
        );
        if (resultIndex < 0) return buildMissingResultEntry(request);

        resultIndexes.add(resultIndex);
        return buildIntegrationEntry(
            input.contextStepResults[resultIndex]!,
            request.requested,
            nativeWebSearchRequested
        );
    });

    const unmatchedResultEntries = input.contextStepResults.flatMap(
        (result, index) =>
            resultIndexes.has(index)
                ? []
                : [
                      buildIntegrationEntry(
                          result,
                          true,
                          nativeWebSearchRequested
                      ),
                  ]
    );
    const unmatchedFailureEntries = (input.contextStepFailures ?? []).flatMap(
        (failure) =>
            input.contextStepRequests.some(
                (request) => request.integrationName === failure.integrationName
            )
                ? []
                : [
                      {
                          source: failure.integrationName,
                          authority: 'advisory' as const,
                          requested: failure.requested,
                          status: failure.status,
                          scope: integrationScope(failure.integrationName),
                      },
                  ]
    );
    const conversationTurnCount = input.contextEnvelope.turns.filter(
        (turn) => turn.visibility === 'model_visible'
    ).length;
    const entries: GenerationContextManifestEntry[] = [
        {
            source: 'conversation',
            authority: 'conversation',
            requested: true,
            status: conversationTurnCount > 0 ? 'available' : 'empty',
            scope: 'direct conversation messages',
            evidenceCount: conversationTurnCount,
        },
        {
            source: 'prompt',
            authority: 'instructional',
            requested: true,
            status: 'available',
            scope: 'system, profile, and persona guidance',
        },
        ...integrationEntries,
        ...unmatchedResultEntries,
        ...unmatchedFailureEntries,
    ];

    const webSearchEntryPresent = entries.some(
        (entry) => entry.source === 'web_search'
    );
    if (nativeWebSearchRequested && !webSearchEntryPresent) {
        entries.push({
            source: 'web_search',
            authority: 'advisory',
            requested: true,
            status:
                input.webSearchAvailable === false
                    ? 'unavailable'
                    : 'requested',
            scope: integrationScope('web_search'),
        });
    }

    return { version: 'v1', entries };
};

/** Renders backend-owned source state without presenting it as retrieved text. */
export const renderGenerationContextManifest = (
    manifest: GenerationContextManifest
): string => {
    const sourceLines = manifest.entries.map((entry) => {
        const evidenceCount =
            entry.evidenceCount === undefined
                ? ''
                : `; evidence_items=${entry.evidenceCount}`;
        return `- ${entry.source}: status=${entry.status}; authority=${entry.authority}; scope=${entry.scope}${evidenceCount}`;
    });

    return [
        'FOOTNOTE CONTEXT MANIFEST: backend-generated source and status facts, not project or user-provided text.',
        ...sourceLines,
        'Use direct conversation messages as evidence of what was said. Treat system/profile/persona context as instructions, not retrieved repository evidence.',
        'Treat only returned retrieval evidence as checked. An empty, skipped, unavailable, failed, or unlisted source is not evidence that the source was checked, and a missing retrieval record is not evidence that a name was absent from the conversation.',
        'A repository or project question does not mean source files were inspected unless a source explicitly provides source-file evidence.',
    ].join('\n');
};
