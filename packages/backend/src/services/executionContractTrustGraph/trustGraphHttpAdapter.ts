/**
 * @description: Calls TrustGraph 2.8 Graph RAG and maps source-backed answers into advisory evidence.
 * This adapter owns transport validation only; Footnote remains authoritative for policy and execution.
 * @footnote-scope: interface
 * @footnote-module: ExecutionContractTrustGraphHttpAdapter
 * @footnote-risk: high - Untrusted Graph RAG responses can corrupt advisory evidence or provenance if accepted too broadly.
 * @footnote-ethics: high - Honest source attribution is required before generated context can influence a human-facing answer.
 */

import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

import type {
    Budget,
    EvidenceBundle,
    ScopeTuple,
    TrustGraphEvidenceAdapter,
    TrustGraphTargetConfig,
} from './trustGraphEvidenceTypes.js';

export type TrustGraphGraphRagLimits = {
    maxQueryChars: number;
    entityLimit: number;
    tripleLimit: number;
    maxSubgraphSize: number;
    maxPathLength: number;
    maxResponseChars: number;
    maxSources: number;
    maxSourceUriChars: number;
    maxSourceTitleChars: number;
};

export type HttpTrustGraphAdapterConfig = {
    baseUrl: string;
    targets: readonly TrustGraphTargetConfig[];
    apiToken: string;
    /**
     * @description: Workspace used by TrustGraph to route the request to its flow.
     * @footnote-scope: interface
     * @footnote-module: HttpTrustGraphEvidenceAdapter
     * @footnote-risk: medium - Incorrect workspace routing changes retrieval scope.
     * @footnote-ethics: medium - Incorrect workspace routing can affect tenant isolation.
     */
    workspaceRef?: string | null;
    limits: TrustGraphGraphRagLimits;
    onTargetFailure?: (target: TrustGraphTargetConfig, error: unknown) => void;
    onTargetResponseTruncated?: (
        target: TrustGraphTargetConfig,
        details: {
            originalResponseChars: number;
            retainedResponseChars: number;
        }
    ) => void;
};

type GraphRagSource = {
    uri: string;
    title?: string;
};

const GRAPH_RAG_ADAPTER_VERSION = 'trustgraph-graph-rag-v1';
const GRAPH_RAG_SOURCE_REF_PREFIX = 'trustgraph://graph-rag/collection/';
// TrustGraph 2.8's native client sends these bounded reranking controls. Keep
// them explicit so the HTTP adapter uses the same retrieval path across 2.8
// deployments instead of relying on server-side defaults.
const GRAPH_RAG_EDGE_SCORE_LIMIT = 30;
const GRAPH_RAG_EDGE_LIMIT = 25;
const GRAPH_RAG_MAX_RERANKER_INPUT = 350;
const MAX_RESPONSE_TEXT_LENGTH = 1_048_576;
const AGGREGATE_RESPONSE_LIMIT_MULTIPLIER = 2;
const RESPONSE_TRUNCATION_SUFFIX =
    '\n\n[TrustGraph response truncated by Footnote bounds.]';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const hasControlCharacters = (value: string): boolean => {
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (codePoint <= 0x1f || codePoint === 0x7f) {
            return true;
        }
    }
    return false;
};

const requirePositiveLimit = (value: number, name: string): number => {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`trustgraph_graph_rag_invalid_${name}`);
    }
    return value;
};

const validateLimits = (
    limits: TrustGraphGraphRagLimits
): TrustGraphGraphRagLimits => {
    const maxQueryChars = requirePositiveLimit(
        limits.maxQueryChars,
        'max_query_chars'
    );
    const entityLimit = requirePositiveLimit(
        limits.entityLimit,
        'entity_limit'
    );
    const tripleLimit = requirePositiveLimit(
        limits.tripleLimit,
        'triple_limit'
    );
    const maxSubgraphSize = requirePositiveLimit(
        limits.maxSubgraphSize,
        'max_subgraph_size'
    );
    const maxPathLength = requirePositiveLimit(
        limits.maxPathLength,
        'max_path_length'
    );
    const maxResponseChars = requirePositiveLimit(
        limits.maxResponseChars,
        'max_response_chars'
    );
    const maxSources = requirePositiveLimit(limits.maxSources, 'max_sources');
    const maxSourceUriChars = requirePositiveLimit(
        limits.maxSourceUriChars,
        'max_source_uri_chars'
    );
    const maxSourceTitleChars = requirePositiveLimit(
        limits.maxSourceTitleChars,
        'max_source_title_chars'
    );

    if (
        entityLimit > 200 ||
        tripleLimit > 100 ||
        maxSubgraphSize > 5000 ||
        maxPathLength > 5
    ) {
        throw new Error('trustgraph_graph_rag_native_limit_exceeded');
    }

    return {
        maxQueryChars,
        entityLimit,
        tripleLimit,
        maxSubgraphSize,
        maxPathLength,
        maxResponseChars,
        maxSources,
        maxSourceUriChars,
        maxSourceTitleChars,
    };
};

const parseSources = (
    value: unknown,
    limits: TrustGraphGraphRagLimits
): GraphRagSource[] => {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > limits.maxSources
    ) {
        throw new Error('trustgraph_graph_rag_invalid_sources');
    }

    return value.map((source): GraphRagSource => {
        if (!isRecord(source) || !isNonEmptyString(source.uri)) {
            throw new Error('trustgraph_graph_rag_invalid_source');
        }

        const uri = source.uri.trim();
        if (
            uri.length > limits.maxSourceUriChars ||
            hasControlCharacters(uri)
        ) {
            throw new Error('trustgraph_graph_rag_source_uri_too_large');
        }

        if (source.title !== undefined && typeof source.title !== 'string') {
            throw new Error('trustgraph_graph_rag_invalid_source_title');
        }

        const title =
            typeof source.title === 'string' ? source.title.trim() : undefined;
        if (
            title !== undefined &&
            (title.length > limits.maxSourceTitleChars ||
                hasControlCharacters(title))
        ) {
            throw new Error('trustgraph_graph_rag_source_title_too_large');
        }

        return { uri, ...(title !== undefined && { title }) };
    });
};

const truncateResponse = (
    response: string,
    maxChars: number
): { response: string; truncated: boolean } => {
    if (response.length <= maxChars) {
        return { response, truncated: false };
    }

    if (maxChars <= RESPONSE_TRUNCATION_SUFFIX.length) {
        return {
            response: RESPONSE_TRUNCATION_SUFFIX.slice(0, maxChars),
            truncated: true,
        };
    }

    const contentLimit = maxChars - RESPONSE_TRUNCATION_SUFFIX.length;
    const candidate = response.slice(0, contentLimit);
    const boundary = Math.max(
        candidate.lastIndexOf('\n'),
        candidate.lastIndexOf('. '),
        candidate.lastIndexOf('! '),
        candidate.lastIndexOf('? ')
    );
    const content =
        boundary >= Math.floor(contentLimit / 2)
            ? candidate.slice(0, boundary + 1)
            : candidate;

    return {
        response: `${content.trimEnd()}${RESPONSE_TRUNCATION_SUFFIX}`,
        truncated: true,
    };
};

const parseGraphRagPayload = (
    payload: unknown,
    limits: TrustGraphGraphRagLimits
): {
    response: string;
    sources: GraphRagSource[];
    originalResponseChars: number;
    responseTruncated: boolean;
} => {
    if (!isRecord(payload) || !isNonEmptyString(payload.response)) {
        throw new Error('trustgraph_graph_rag_invalid_response_payload');
    }

    const response = payload.response.trim();
    if (hasControlCharacters(response)) {
        throw new Error(
            'trustgraph_graph_rag_invalid_response_control_characters'
        );
    }

    const bounded = truncateResponse(response, limits.maxResponseChars);
    return {
        response: bounded.response,
        sources: parseSources(payload.sources, limits),
        originalResponseChars: response.length,
        responseTruncated: bounded.truncated,
    };
};

const readResponseTextBounded = async (response: Response): Promise<string> => {
    const declaredLength = response.headers.get('content-length');
    const parsedLength = declaredLength === null ? NaN : Number(declaredLength);
    if (
        Number.isSafeInteger(parsedLength) &&
        parsedLength > MAX_RESPONSE_TEXT_LENGTH
    ) {
        throw new Error('trustgraph_graph_rag_response_body_too_large');
    }

    if (response.body === null) {
        throw new Error('trustgraph_graph_rag_missing_response_body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }

            totalBytes += chunk.value.byteLength;
            if (totalBytes > MAX_RESPONSE_TEXT_LENGTH) {
                try {
                    await reader.cancel();
                } catch {
                    // Preserve the bounded-response error even if the peer
                    // closes the stream before cancellation completes.
                }
                throw new Error('trustgraph_graph_rag_response_body_too_large');
            }
            chunks.push(decoder.decode(chunk.value, { stream: true }));
        }
        chunks.push(decoder.decode());
        return chunks.join('');
    } finally {
        reader.releaseLock();
    }
};

const buildEndpointUrl = (baseUrlInput: string, flowInput: string): string => {
    const baseUrl = baseUrlInput.trim().replace(/\/+$/u, '');
    const flow = encodeURIComponent(flowInput.trim());
    return `${baseUrl}/api/v1/flow/${flow}/service/graph-rag`;
};

const buildProvenancePathRefs = (input: {
    target: TrustGraphTargetConfig;
    sources: GraphRagSource[];
}): string[] => {
    const refs: string[] = [`target:${input.target.id}`];
    for (const source of input.sources) {
        refs.push(source.uri);
        if (source.title !== undefined && source.title.length > 0) {
            refs.push(`title:${source.title}`);
        }
    }
    return refs;
};

const toEvidenceBundle = (input: {
    queryIntent: string;
    scopeTuple: ScopeTuple;
    results: Array<{
        target: TrustGraphTargetConfig;
        response: string;
        sources: GraphRagSource[];
        responseTruncated: boolean;
    }>;
}): EvidenceBundle => {
    const items = input.results.map((result) => ({
        evidenceId: `trustgraph_graph_rag_evidence_${randomUUID()}`,
        claimText: result.response,
        sourceRef: `${GRAPH_RAG_SOURCE_REF_PREFIX}${encodeURIComponent(result.target.collection)}`,
        provenancePathRef: buildProvenancePathRefs(result),
        retrievalReason: result.responseTruncated
            ? 'trustgraph_graph_rag_source_backed_response_truncated'
            : 'trustgraph_graph_rag_source_backed_response',
        // Graph RAG does not expose a Footnote confidence score. Keep this
        // neutral and outside backend policy rather than treating ranking as confidence.
        confidenceScore: 0,
        confidenceMethodId: 'trustgraph_graph_rag_confidence_not_provided',
        retrievedAt: new Date().toISOString(),
        collectionScope: result.target.collection,
        adapterVersion: GRAPH_RAG_ADAPTER_VERSION,
        targetId: result.target.id,
    }));

    return {
        bundleId: `trustgraph_graph_rag_${randomUUID()}`,
        queryIntent: input.queryIntent,
        items,
        coverageEstimate: {
            evaluationUnit: 'source',
            scoreRange: '0..1',
            value: 0,
            computationBasis: ['trustgraph_graph_rag_source_count_only'],
            comparableAcrossVersions: false,
            adapterVersion: GRAPH_RAG_ADAPTER_VERSION,
        },
        conflictSignals: [],
        traceRefs: [
            ...input.results.map(
                (result) =>
                    `${GRAPH_RAG_SOURCE_REF_PREFIX}${encodeURIComponent(result.target.collection)}/target/${encodeURIComponent(result.target.id)}/flow/${encodeURIComponent(result.target.flow)}`
            ),
        ],
        scopeTuple: input.scopeTuple,
        adapterVersion: GRAPH_RAG_ADAPTER_VERSION,
    };
};

type GraphRagTargetResult = {
    target: TrustGraphTargetConfig;
    response: string;
    sources: GraphRagSource[];
    originalResponseChars: number;
    responseTruncated: boolean;
};

const applyAggregateResponseLimit = (
    results: readonly GraphRagTargetResult[],
    maxResponseChars: number
): GraphRagTargetResult[] => {
    const aggregateLimit =
        maxResponseChars * AGGREGATE_RESPONSE_LIMIT_MULTIPLIER;
    const totalResponseChars = results.reduce(
        (total, result) => total + result.response.length,
        0
    );
    if (totalResponseChars <= aggregateLimit) {
        return [...results];
    }

    let remainingChars = aggregateLimit;
    return results.map((result, index) => {
        const remainingResults = results.length - index;
        const allocation = Math.max(
            1,
            Math.floor(remainingChars / remainingResults)
        );
        const bounded = truncateResponse(result.response, allocation);
        remainingChars = Math.max(0, remainingChars - bounded.response.length);
        return {
            ...result,
            response: bounded.response,
            responseTruncated: result.responseTruncated || bounded.truncated,
        };
    });
};

export class HttpTrustGraphEvidenceAdapter implements TrustGraphEvidenceAdapter {
    private readonly baseUrl: string;
    private readonly apiToken: string;
    private readonly workspaceRef: string | undefined;
    private readonly targets: readonly TrustGraphTargetConfig[];
    private readonly limits: TrustGraphGraphRagLimits;
    private readonly onTargetFailure:
        HttpTrustGraphAdapterConfig['onTargetFailure'] | undefined;
    private readonly onTargetResponseTruncated:
        HttpTrustGraphAdapterConfig['onTargetResponseTruncated'] | undefined;

    public constructor(config: HttpTrustGraphAdapterConfig) {
        if (!isNonEmptyString(config.baseUrl)) {
            throw new Error('trustgraph_graph_rag_missing_endpoint_config');
        }
        if (config.targets.length === 0) {
            throw new Error('trustgraph_graph_rag_missing_targets');
        }
        if (!isNonEmptyString(config.apiToken)) {
            throw new Error('trustgraph_graph_rag_missing_api_token');
        }

        this.baseUrl = config.baseUrl.trim();
        this.apiToken = config.apiToken.trim();
        this.workspaceRef = isNonEmptyString(config.workspaceRef)
            ? config.workspaceRef.trim()
            : undefined;
        this.targets = config.targets.map((target) => {
            if (
                !isNonEmptyString(target.id) ||
                !isNonEmptyString(target.flow) ||
                !isNonEmptyString(target.collection)
            ) {
                throw new Error('trustgraph_graph_rag_invalid_target');
            }
            return {
                id: target.id.trim(),
                flow: target.flow.trim(),
                collection: target.collection.trim(),
                ...(target.workspaceRef === null
                    ? { workspaceRef: null }
                    : isNonEmptyString(target.workspaceRef)
                      ? { workspaceRef: target.workspaceRef.trim() }
                      : {}),
            };
        });
        this.limits = validateLimits(config.limits);
        this.onTargetFailure = config.onTargetFailure;
        this.onTargetResponseTruncated = config.onTargetResponseTruncated;
    }

    private async fetchTarget(input: {
        target: TrustGraphTargetConfig;
        query: string;
        abortSignal?: AbortSignal;
    }): Promise<GraphRagTargetResult> {
        const workspaceRef =
            input.target.workspaceRef !== undefined
                ? isNonEmptyString(input.target.workspaceRef)
                    ? input.target.workspaceRef.trim()
                    : undefined
                : this.workspaceRef;
        const response = await fetch(
            buildEndpointUrl(this.baseUrl, input.target.flow),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiToken}`,
                },
                body: JSON.stringify({
                    ...(workspaceRef !== undefined && {
                        workspace: workspaceRef,
                    }),
                    query: input.query,
                    collection: input.target.collection,
                    'entity-limit': this.limits.entityLimit,
                    'triple-limit': this.limits.tripleLimit,
                    'max-subgraph-size': this.limits.maxSubgraphSize,
                    'max-path-length': this.limits.maxPathLength,
                    'edge-score-limit': GRAPH_RAG_EDGE_SCORE_LIMIT,
                    'edge-limit': GRAPH_RAG_EDGE_LIMIT,
                    'max-reranker-input': GRAPH_RAG_MAX_RERANKER_INPUT,
                    streaming: false,
                }),
                signal: input.abortSignal,
            }
        );

        if (!response.ok) {
            throw new Error(
                `trustgraph_graph_rag_http_status_${response.status}`
            );
        }

        const responseText = await readResponseTextBounded(response);
        let payload: unknown;
        try {
            payload = JSON.parse(responseText) as unknown;
        } catch {
            throw new Error('trustgraph_graph_rag_invalid_json');
        }
        const parsed = parseGraphRagPayload(payload, this.limits);
        return { target: input.target, ...parsed };
    }

    public async getEvidenceBundle(input: {
        queryIntent: string;
        scopeTuple: ScopeTuple;
        budget: Budget;
        abortSignal?: AbortSignal;
    }): Promise<EvidenceBundle> {
        const query = input.queryIntent.trim();
        if (query.length === 0) {
            throw new Error('trustgraph_graph_rag_missing_query');
        }
        if (query.length > this.limits.maxQueryChars) {
            throw new Error('trustgraph_graph_rag_query_too_large');
        }

        const settled = await Promise.allSettled(
            this.targets.map((target) =>
                this.fetchTarget({
                    target,
                    query,
                    abortSignal: input.abortSignal,
                })
            )
        );
        const successful: GraphRagTargetResult[] = [];
        const failures: Array<{
            target: TrustGraphTargetConfig;
            error: unknown;
        }> = [];
        for (const [index, result] of settled.entries()) {
            const target = this.targets[index];
            if (result.status === 'fulfilled') {
                successful.push(result.value);
            } else if (target !== undefined) {
                failures.push({ target, error: result.reason });
                this.onTargetFailure?.(target, result.reason);
            }
        }

        if (successful.length === 0) {
            if (failures.length === 1) {
                throw failures[0].error;
            }
            throw new Error('trustgraph_graph_rag_all_targets_failed');
        }

        let remainingSources = this.limits.maxSources;
        const results: GraphRagTargetResult[] = [];
        for (const [index, result] of successful.entries()) {
            if (remainingSources === 0) {
                break;
            }
            const remainingTargets = successful.length - index;
            const sourceCount = Math.max(
                1,
                Math.floor(remainingSources / remainingTargets)
            );
            const sources = result.sources.slice(0, sourceCount);
            results.push({ ...result, sources });
            remainingSources -= sources.length;
        }

        const boundedResults = applyAggregateResponseLimit(
            results,
            this.limits.maxResponseChars
        );
        for (const result of boundedResults) {
            if (result.responseTruncated) {
                this.onTargetResponseTruncated?.(result.target, {
                    originalResponseChars: result.originalResponseChars,
                    retainedResponseChars: result.response.length,
                });
            }
        }

        return toEvidenceBundle({
            queryIntent: query,
            scopeTuple: input.scopeTuple,
            results: boundedResults,
        });
    }
}

export const createHttpTrustGraphEvidenceAdapter = (
    config: HttpTrustGraphAdapterConfig
): TrustGraphEvidenceAdapter => new HttpTrustGraphEvidenceAdapter(config);
