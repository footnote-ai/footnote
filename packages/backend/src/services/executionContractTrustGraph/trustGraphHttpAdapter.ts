/**
 * @description: Calls TrustGraph 2.8 Graph RAG and maps source-backed answers into advisory evidence.
 * This adapter owns transport validation only; Footnote remains authoritative for policy and execution.
 * @footnote-scope: interface
 * @footnote-module: ExecutionContractTrustGraphHttpAdapter
 * @footnote-risk: high - Untrusted Graph RAG responses can corrupt advisory evidence or provenance if accepted too broadly.
 * @footnote-ethics: high - Honest source attribution is required before generated context can influence a human-facing answer.
 */

import { randomUUID } from 'node:crypto';

import type {
    Budget,
    EvidenceBundle,
    ScopeTuple,
    TrustGraphEvidenceAdapter,
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
    flow: string;
    collection: string;
    apiToken: string;
    /** Workspace used by TrustGraph to route the request to its flow. */
    workspaceRef?: string | null;
    limits: TrustGraphGraphRagLimits;
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

const parseGraphRagPayload = (
    payload: unknown,
    limits: TrustGraphGraphRagLimits
): { response: string; sources: GraphRagSource[] } => {
    if (!isRecord(payload) || !isNonEmptyString(payload.response)) {
        throw new Error('trustgraph_graph_rag_invalid_response_payload');
    }

    const response = payload.response.trim();
    if (
        response.length > limits.maxResponseChars ||
        hasControlCharacters(response)
    ) {
        throw new Error('trustgraph_graph_rag_response_too_large');
    }

    return { response, sources: parseSources(payload.sources, limits) };
};

const buildEndpointUrl = (config: HttpTrustGraphAdapterConfig): string => {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/u, '');
    const flow = encodeURIComponent(config.flow.trim());
    return `${baseUrl}/api/v1/flow/${flow}/service/graph-rag`;
};

const buildProvenancePathRefs = (sources: GraphRagSource[]): string[] => {
    const refs: string[] = [];
    for (const source of sources) {
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
    collection: string;
    flow: string;
    response: string;
    sources: GraphRagSource[];
}): EvidenceBundle => ({
    bundleId: `trustgraph_graph_rag_${randomUUID()}`,
    queryIntent: input.queryIntent,
    items: [
        {
            evidenceId: `trustgraph_graph_rag_evidence_${randomUUID()}`,
            claimText: input.response,
            sourceRef: `${GRAPH_RAG_SOURCE_REF_PREFIX}${encodeURIComponent(input.collection)}`,
            provenancePathRef: buildProvenancePathRefs(input.sources),
            retrievalReason: 'trustgraph_graph_rag_source_backed_response',
            // Graph RAG does not expose a Footnote confidence score. Keep this
            // neutral and outside backend policy rather than treating ranking as confidence.
            confidenceScore: 0,
            confidenceMethodId: 'trustgraph_graph_rag_confidence_not_provided',
            retrievedAt: new Date().toISOString(),
            collectionScope: input.collection,
            adapterVersion: GRAPH_RAG_ADAPTER_VERSION,
        },
    ],
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
        `${GRAPH_RAG_SOURCE_REF_PREFIX}${encodeURIComponent(input.collection)}/flow/${encodeURIComponent(input.flow)}`,
    ],
    scopeTuple: input.scopeTuple,
    adapterVersion: GRAPH_RAG_ADAPTER_VERSION,
});

export class HttpTrustGraphEvidenceAdapter implements TrustGraphEvidenceAdapter {
    private readonly endpointUrl: string;
    private readonly apiToken: string;
    private readonly workspaceRef: string | undefined;
    private readonly collection: string;
    private readonly flow: string;
    private readonly limits: TrustGraphGraphRagLimits;

    public constructor(config: HttpTrustGraphAdapterConfig) {
        if (
            !isNonEmptyString(config.baseUrl) ||
            !isNonEmptyString(config.flow)
        ) {
            throw new Error('trustgraph_graph_rag_missing_endpoint_config');
        }
        if (!isNonEmptyString(config.collection)) {
            throw new Error('trustgraph_graph_rag_missing_collection');
        }
        if (!isNonEmptyString(config.apiToken)) {
            throw new Error('trustgraph_graph_rag_missing_api_token');
        }

        this.endpointUrl = buildEndpointUrl(config);
        this.apiToken = config.apiToken.trim();
        this.workspaceRef = isNonEmptyString(config.workspaceRef)
            ? config.workspaceRef.trim()
            : undefined;
        this.collection = config.collection.trim();
        this.flow = config.flow.trim();
        this.limits = validateLimits(config.limits);
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

        const response = await fetch(this.endpointUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiToken}`,
            },
            body: JSON.stringify({
                ...(this.workspaceRef !== undefined && {
                    workspace: this.workspaceRef,
                }),
                query,
                collection: this.collection,
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
        });

        if (!response.ok) {
            throw new Error(
                `trustgraph_graph_rag_http_status_${response.status}`
            );
        }

        const payload: unknown = await response.json();
        const parsed = parseGraphRagPayload(payload, this.limits);
        return toEvidenceBundle({
            queryIntent: query,
            scopeTuple: input.scopeTuple,
            collection: this.collection,
            flow: this.flow,
            response: parsed.response,
            sources: parsed.sources,
        });
    }
}

export const createHttpTrustGraphEvidenceAdapter = (
    config: HttpTrustGraphAdapterConfig
): TrustGraphEvidenceAdapter => new HttpTrustGraphEvidenceAdapter(config);
