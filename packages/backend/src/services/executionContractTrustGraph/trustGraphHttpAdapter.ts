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

import { logger } from '../../utils/logger.js';
import type {
    Budget,
    EvidenceBundle,
    ScopeTuple,
    EvidenceItem,
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
};

type GraphRagSource = {
    uri: string;
    title?: string;
};

type DocumentRagEvidence = {
    chunkId: string;
    text: string;
    textTruncated: boolean;
    rank: number;
    score?: number;
    pageId?: string;
    pageNumber?: number;
    documentId?: string;
    sourceTitle?: string;
    sourceUri: string;
};

const GRAPH_RAG_ADAPTER_VERSION = 'trustgraph-graph-rag-v1';
const DOCUMENT_RAG_ADAPTER_VERSION = 'trustgraph-document-rag-evidence-v1';
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

const MAX_LOGGED_FAILURE_DETAIL_LENGTH = 256;

const normalizeFailureDetail = (value: unknown): string => {
    if (typeof value !== 'string') {
        return '';
    }

    let normalized = '';
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        normalized += codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
    }

    return normalized.trim().slice(0, MAX_LOGGED_FAILURE_DETAIL_LENGTH);
};

const describeTargetFailure = (
    error: unknown
): { errorName: string; reason: string } => {
    if (error instanceof Error) {
        const errorName = normalizeFailureDetail(error.name) || 'Error';
        const reason = normalizeFailureDetail(error.message) || errorName;
        return { errorName, reason };
    }

    if (typeof error === 'object' && error !== null) {
        const errorRecord = error as Record<string, unknown>;
        const errorName =
            normalizeFailureDetail(errorRecord.name) || 'UnknownError';
        const reason = normalizeFailureDetail(errorRecord.message) || errorName;
        return { errorName, reason };
    }

    const reason = normalizeFailureDetail(error) || 'unknown_error';
    const errorName =
        reason === 'trustgraph_adapter_aborted_by_signal'
            ? 'AbortError'
            : 'UnknownError';
    return { errorName, reason };
};

const logTargetFailure = (
    target: TrustGraphTargetConfig,
    error: unknown
): void => {
    const failure = describeTargetFailure(error);
    const event = 'chat.execution_contract_trustgraph.target_failed';
    logger.warn(
        `${event} (targetId=${target.id}, flow=${target.flow}, collection=${target.collection}, errorName=${failure.errorName}, reason=${failure.reason})`,
        {
            event,
            targetId: target.id,
            flow: target.flow,
            collection: target.collection,
            errorName: failure.errorName,
            reason: failure.reason,
        }
    );
};

const logTargetResponseTruncated = (
    target: TrustGraphTargetConfig,
    details: { originalResponseChars: number; retainedResponseChars: number }
): void => {
    const event =
        'chat.execution_contract_trustgraph.target_response_truncated';
    logger.warn(
        `${event} (targetId=${target.id}, flow=${target.flow}, collection=${target.collection}, originalResponseChars=${details.originalResponseChars}, retainedResponseChars=${details.retainedResponseChars})`,
        {
            event,
            targetId: target.id,
            flow: target.flow,
            collection: target.collection,
            originalResponseChars: details.originalResponseChars,
            retainedResponseChars: details.retainedResponseChars,
        }
    );
};

const logTargetSourcesTruncated = (
    target: TrustGraphTargetConfig,
    details: { originalSourceCount: number; retainedSourceCount: number }
): void => {
    const event = 'chat.execution_contract_trustgraph.target_sources_truncated';
    logger.warn(
        `${event} (targetId=${target.id}, flow=${target.flow}, collection=${target.collection}, originalSourceCount=${details.originalSourceCount}, retainedSourceCount=${details.retainedSourceCount})`,
        {
            event,
            targetId: target.id,
            flow: target.flow,
            collection: target.collection,
            originalSourceCount: details.originalSourceCount,
            retainedSourceCount: details.retainedSourceCount,
        }
    );
};

const hasControlCharacters = (value: string): boolean => {
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (codePoint <= 0x1f || codePoint === 0x7f) {
            return true;
        }
    }
    return false;
};

const hasUnsafeResponseControlCharacters = (value: string): boolean => {
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        const isAllowedWhitespace =
            codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
        if ((codePoint <= 0x1f && !isAllowedWhitespace) || codePoint === 0x7f) {
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
): {
    sources: GraphRagSource[];
    originalSourceCount: number;
    sourceTruncated: boolean;
} => {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('trustgraph_graph_rag_invalid_sources');
    }

    const originalSourceCount = value.length;
    const retainedSources = value.slice(0, limits.maxSources);
    const sources = retainedSources.map((source): GraphRagSource => {
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

    return {
        sources,
        originalSourceCount,
        sourceTruncated: originalSourceCount > sources.length,
    };
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
    originalSourceCount: number;
    sourceTruncated: boolean;
    originalResponseChars: number;
    responseTruncated: boolean;
} => {
    if (!isRecord(payload) || !isNonEmptyString(payload.response)) {
        throw new Error('trustgraph_graph_rag_invalid_response_payload');
    }

    const response = payload.response.trim();
    if (hasUnsafeResponseControlCharacters(response)) {
        throw new Error(
            'trustgraph_graph_rag_invalid_response_control_characters'
        );
    }

    const bounded = truncateResponse(response, limits.maxResponseChars);
    const parsedSources = parseSources(payload.sources, limits);
    return {
        response: bounded.response,
        ...parsedSources,
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

const buildDocumentRagEndpointUrl = (
    baseUrlInput: string,
    flowInput: string
): string => {
    const baseUrl = baseUrlInput.trim().replace(/\/+$/u, '');
    const flow = encodeURIComponent(flowInput.trim());
    return `${baseUrl}/api/v1/flow/${flow}/service/document-rag`;
};

const isPositiveSafeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const appendPageReference = (sourceUri: string, pageNumber?: number): string =>
    pageNumber === undefined
        ? sourceUri
        : `${sourceUri}${sourceUri.includes('#') ? '&' : '#'}page=${pageNumber}`;

const parseDocumentRagPayload = (
    payload: unknown,
    limits: TrustGraphGraphRagLimits
): {
    evidence: DocumentRagEvidence[];
    originalEvidenceCount: number;
    evidenceTruncated: boolean;
} => {
    if (!isRecord(payload) || payload.message_type !== 'evidence') {
        throw new Error('trustgraph_document_rag_invalid_evidence_payload');
    }
    if (payload.response !== undefined && payload.response !== null) {
        throw new Error(
            'trustgraph_document_rag_synthesis_in_evidence_payload'
        );
    }
    if (!Array.isArray(payload.evidence)) {
        throw new Error('trustgraph_document_rag_invalid_evidence');
    }

    const originalEvidenceCount = payload.evidence.length;
    const retainedEvidence = payload.evidence.slice(0, limits.maxSources);
    const evidence = retainedEvidence.map((candidate): DocumentRagEvidence => {
        if (!isRecord(candidate)) {
            throw new Error('trustgraph_document_rag_invalid_evidence_item');
        }
        const chunkId = candidate['chunk-id'];
        const text = candidate.text;
        const rank = candidate.rank;
        const sourceUri = candidate['source-uri'];
        if (
            !isNonEmptyString(chunkId) ||
            !isNonEmptyString(text) ||
            !isPositiveSafeInteger(rank) ||
            !isNonEmptyString(sourceUri)
        ) {
            throw new Error('trustgraph_document_rag_invalid_evidence_item');
        }
        const normalizedText = text.trim();
        if (hasUnsafeResponseControlCharacters(normalizedText)) {
            throw new Error(
                'trustgraph_document_rag_invalid_evidence_control_characters'
            );
        }
        const boundedText = truncateResponse(
            normalizedText,
            limits.maxResponseChars
        );
        const normalizedSourceUri = sourceUri.trim();
        if (
            normalizedSourceUri.length > limits.maxSourceUriChars ||
            hasControlCharacters(normalizedSourceUri)
        ) {
            throw new Error('trustgraph_document_rag_source_uri_too_large');
        }
        const score = candidate.score;
        if (
            score !== undefined &&
            (typeof score !== 'number' || !Number.isFinite(score))
        ) {
            throw new Error('trustgraph_document_rag_invalid_evidence_score');
        }
        const pageId = candidate['page-id'];
        if (pageId !== undefined && !isNonEmptyString(pageId)) {
            throw new Error('trustgraph_document_rag_invalid_page_id');
        }
        const pageNumber = candidate['page-number'];
        if (pageNumber !== undefined && !isPositiveSafeInteger(pageNumber)) {
            throw new Error('trustgraph_document_rag_invalid_page_number');
        }
        const documentId = candidate['document-id'];
        if (documentId !== undefined && !isNonEmptyString(documentId)) {
            throw new Error('trustgraph_document_rag_invalid_document_id');
        }
        const normalizedDocumentId =
            documentId === undefined ? undefined : documentId.trim();
        const sourceTitle =
            normalizedDocumentId === undefined
                ? undefined
                : `${normalizedDocumentId}${
                      pageNumber === undefined ? '' : ` · page ${pageNumber}`
                  }`.slice(0, limits.maxSourceTitleChars);
        return {
            chunkId: chunkId.trim(),
            text: boundedText.response,
            textTruncated: boundedText.truncated,
            rank,
            ...(score !== undefined && { score }),
            ...(pageId !== undefined && { pageId: pageId.trim() }),
            ...(pageNumber !== undefined && { pageNumber }),
            ...(normalizedDocumentId !== undefined && {
                documentId: normalizedDocumentId,
                sourceTitle,
            }),
            sourceUri: normalizedSourceUri,
        };
    });

    return {
        evidence,
        originalEvidenceCount,
        evidenceTruncated: originalEvidenceCount > evidence.length,
    };
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
    partialTargetFailureIds?: string[];
    results: TargetResult[];
}): EvidenceBundle => {
    const items: EvidenceItem[] = input.results.flatMap(
        (result): EvidenceItem[] => {
            if (result.kind === 'document') {
                return result.evidence.map((evidence) => ({
                    evidenceId: `trustgraph_document_rag_evidence_${randomUUID()}`,
                    claimText: evidence.text,
                    sourceRef: appendPageReference(
                        evidence.sourceUri,
                        evidence.pageNumber
                    ),
                    provenancePathRef: [
                        `target:${result.target.id}`,
                        `chunk:${evidence.chunkId}`,
                        ...(evidence.documentId !== undefined
                            ? [`document:${evidence.documentId}`]
                            : []),
                        ...(evidence.pageId !== undefined
                            ? [`page:${evidence.pageId}`]
                            : []),
                        ...(evidence.pageNumber !== undefined
                            ? [`page-number:${evidence.pageNumber}`]
                            : []),
                        evidence.sourceUri,
                    ],
                    retrievalReason: result.evidenceTruncated
                        ? 'trustgraph_document_rag_evidence_truncated'
                        : evidence.textTruncated
                          ? 'trustgraph_document_rag_evidence_text_truncated'
                          : 'trustgraph_document_rag_source_evidence',
                    confidenceScore: 0,
                    confidenceMethodId:
                        'trustgraph_document_rag_rank_not_confidence',
                    retrievedAt: new Date().toISOString(),
                    collectionScope: result.target.collection,
                    adapterVersion: DOCUMENT_RAG_ADAPTER_VERSION,
                    targetId: result.target.id,
                    evidenceKind: 'source' as const,
                    ...(evidence.sourceTitle !== undefined && {
                        sourceTitle: evidence.sourceTitle,
                    }),
                }));
            }
            return [
                {
                    evidenceId: `trustgraph_graph_rag_evidence_${randomUUID()}`,
                    claimText: result.response,
                    sourceRef: `${GRAPH_RAG_SOURCE_REF_PREFIX}${encodeURIComponent(result.target.collection)}`,
                    provenancePathRef: buildProvenancePathRefs(result),
                    retrievalReason: result.sourceTruncated
                        ? 'trustgraph_graph_rag_source_backed_sources_truncated'
                        : result.responseTruncated
                          ? 'trustgraph_graph_rag_source_backed_response_truncated'
                          : 'trustgraph_graph_rag_source_backed_response',
                    // Graph RAG does not expose a Footnote confidence score. Keep
                    // this neutral and outside backend policy rather than treating
                    // ranking as confidence.
                    confidenceScore: 0,
                    confidenceMethodId:
                        'trustgraph_graph_rag_confidence_not_provided',
                    retrievedAt: new Date().toISOString(),
                    collectionScope: result.target.collection,
                    adapterVersion: GRAPH_RAG_ADAPTER_VERSION,
                    targetId: result.target.id,
                    evidenceKind: 'generated' as const,
                },
            ];
        }
    );
    const usesDocumentEvidence = input.results.some(
        (result) => result.kind === 'document'
    );
    const adapterVersion = usesDocumentEvidence
        ? DOCUMENT_RAG_ADAPTER_VERSION
        : GRAPH_RAG_ADAPTER_VERSION;

    return {
        bundleId: `trustgraph_evidence_${randomUUID()}`,
        queryIntent: input.queryIntent,
        items,
        coverageEstimate: {
            evaluationUnit: 'source',
            scoreRange: '0..1',
            value: 0,
            computationBasis: [
                usesDocumentEvidence
                    ? 'trustgraph_document_rag_evidence_count_only'
                    : 'trustgraph_graph_rag_source_count_only',
            ],
            comparableAcrossVersions: false,
            adapterVersion,
        },
        conflictSignals: [],
        traceRefs: [
            ...input.results.map(
                (result) =>
                    `${GRAPH_RAG_SOURCE_REF_PREFIX}${encodeURIComponent(result.target.collection)}/target/${encodeURIComponent(result.target.id)}/flow/${encodeURIComponent(result.target.flow)}`
            ),
        ],
        scopeTuple: input.scopeTuple,
        adapterVersion,
        ...(input.partialTargetFailureIds !== undefined &&
            input.partialTargetFailureIds.length > 0 && {
                partialTargetFailureIds: input.partialTargetFailureIds,
            }),
    };
};

type GraphRagTargetResult = {
    kind: 'graph';
    target: TrustGraphTargetConfig;
    response: string;
    sources: GraphRagSource[];
    originalSourceCount: number;
    sourceTruncated: boolean;
    originalResponseChars: number;
    responseTruncated: boolean;
};

type DocumentRagTargetResult = {
    kind: 'document';
    target: TrustGraphTargetConfig;
    evidence: DocumentRagEvidence[];
    originalEvidenceCount: number;
    evidenceTruncated: boolean;
};

type TargetResult = GraphRagTargetResult | DocumentRagTargetResult;

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
            if (
                target.service !== undefined &&
                target.service !== 'graph-rag' &&
                target.service !== 'document-rag'
            ) {
                throw new Error('trustgraph_graph_rag_invalid_target_service');
            }
            return {
                id: target.id.trim(),
                flow: target.flow.trim(),
                collection: target.collection.trim(),
                description: target.description.trim(),
                ...(target.service !== undefined && {
                    service: target.service,
                }),
                ...(target.workspaceRef === null
                    ? { workspaceRef: null }
                    : isNonEmptyString(target.workspaceRef)
                      ? { workspaceRef: target.workspaceRef.trim() }
                      : {}),
            };
        });
        this.limits = validateLimits(config.limits);
        if (this.targets.length > this.limits.maxSources) {
            throw new Error(
                'trustgraph_graph_rag_max_sources_below_target_count'
            );
        }
    }

    private async fetchTarget(input: {
        target: TrustGraphTargetConfig;
        query: string;
        abortSignal?: AbortSignal;
    }): Promise<TargetResult> {
        const workspaceRef =
            input.target.workspaceRef !== undefined
                ? isNonEmptyString(input.target.workspaceRef)
                    ? input.target.workspaceRef.trim()
                    : undefined
                : this.workspaceRef;
        const service = input.target.service ?? 'graph-rag';
        const response = await fetch(
            service === 'document-rag'
                ? buildDocumentRagEndpointUrl(this.baseUrl, input.target.flow)
                : buildEndpointUrl(this.baseUrl, input.target.flow),
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiToken}`,
                },
                body: JSON.stringify(
                    service === 'document-rag'
                        ? {
                              ...(workspaceRef !== undefined && {
                                  workspace: workspaceRef,
                              }),
                              query: input.query,
                              collection: input.target.collection,
                              'doc-limit': this.limits.maxSources,
                              streaming: false,
                              'evidence-only': true,
                          }
                        : {
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
                              'max-reranker-input':
                                  GRAPH_RAG_MAX_RERANKER_INPUT,
                              streaming: false,
                          }
                ),
                signal: input.abortSignal,
            }
        );

        if (!response.ok) {
            throw new Error(
                `trustgraph_${service}_http_status_${response.status}`
            );
        }

        const responseText = await readResponseTextBounded(response);
        let payload: unknown;
        try {
            payload = JSON.parse(responseText) as unknown;
        } catch {
            throw new Error(`trustgraph_${service}_invalid_json`);
        }
        if (service === 'document-rag') {
            return {
                kind: 'document',
                target: input.target,
                ...parseDocumentRagPayload(payload, this.limits),
            };
        }
        return {
            kind: 'graph',
            target: input.target,
            ...parseGraphRagPayload(payload, this.limits),
        };
    }

    public async getEvidenceBundle(input: {
        queryIntent: string;
        scopeTuple: ScopeTuple;
        budget: Budget;
        abortSignal?: AbortSignal;
        targetIds: readonly string[];
    }): Promise<EvidenceBundle> {
        const query = input.queryIntent.trim();
        if (query.length === 0) {
            throw new Error('trustgraph_graph_rag_missing_query');
        }
        if (query.length > this.limits.maxQueryChars) {
            throw new Error('trustgraph_graph_rag_query_too_large');
        }

        const requestedTargetIds = new Set(input.targetIds);
        const selectedTargets = this.targets.filter((target) =>
            requestedTargetIds.has(target.id)
        );
        const admittedTargetIds = new Set(
            selectedTargets.map((target) => target.id)
        );
        logger.info('chat.execution_contract_trustgraph.target_admission', {
            event: 'chat.execution_contract_trustgraph.target_admission',
            requestedTargetIds: input.targetIds,
            admittedTargetIds: selectedTargets.map((target) => target.id),
            notSelectedTargetIds: this.targets
                .filter((target) => !admittedTargetIds.has(target.id))
                .map((target) => target.id),
            rejectedTargetIds: input.targetIds.filter(
                (targetId) => !admittedTargetIds.has(targetId)
            ),
        });
        if (selectedTargets.length === 0) {
            throw new Error('trustgraph_graph_rag_no_admitted_targets');
        }

        const settled = await Promise.allSettled(
            selectedTargets.map((target) =>
                (async () => {
                    const startedAt = Date.now();
                    try {
                        const result = await this.fetchTarget({
                            target,
                            query,
                            abortSignal: input.abortSignal,
                        });
                        logger.info(
                            'chat.execution_contract_trustgraph.target_completed',
                            {
                                event: 'chat.execution_contract_trustgraph.target_completed',
                                targetId: target.id,
                                flow: target.flow,
                                collection: target.collection,
                                status: 'success',
                                durationMs: Math.max(0, Date.now() - startedAt),
                            }
                        );
                        return result;
                    } catch (error) {
                        logger.info(
                            'chat.execution_contract_trustgraph.target_completed',
                            {
                                event: 'chat.execution_contract_trustgraph.target_completed',
                                targetId: target.id,
                                flow: target.flow,
                                collection: target.collection,
                                status: 'failed',
                                durationMs: Math.max(0, Date.now() - startedAt),
                            }
                        );
                        throw error;
                    }
                })()
            )
        );
        const successful: TargetResult[] = [];
        const failures: Array<{
            target: TrustGraphTargetConfig;
            error: unknown;
        }> = [];
        for (const [index, result] of settled.entries()) {
            const target = selectedTargets[index];
            if (result.status === 'fulfilled') {
                successful.push(result.value);
            } else if (target !== undefined) {
                failures.push({ target, error: result.reason });
                logTargetFailure(target, result.reason);
            }
        }

        if (successful.length === 0) {
            if (failures.length === 1) {
                throw failures[0].error;
            }
            throw new Error('trustgraph_graph_rag_all_targets_failed');
        }

        let remainingSources = this.limits.maxSources;
        const results: TargetResult[] = [];
        for (const [index, result] of successful.entries()) {
            if (remainingSources === 0) {
                break;
            }
            const remainingTargets = successful.length - index;
            const itemCount = Math.max(
                1,
                Math.floor(remainingSources / remainingTargets)
            );
            if (result.kind === 'document') {
                const evidence = result.evidence.slice(0, itemCount);
                results.push({
                    ...result,
                    evidence,
                    evidenceTruncated:
                        result.evidenceTruncated ||
                        evidence.length < result.evidence.length,
                });
                remainingSources -= evidence.length;
            } else {
                const sources = result.sources.slice(0, itemCount);
                results.push({
                    ...result,
                    sources,
                    sourceTruncated:
                        result.sourceTruncated ||
                        sources.length < result.sources.length,
                });
                remainingSources -= sources.length;
            }
        }

        const graphResults = results.filter(
            (result): result is GraphRagTargetResult => result.kind === 'graph'
        );
        const boundedGraphResults = applyAggregateResponseLimit(
            graphResults,
            this.limits.maxResponseChars
        );
        let graphIndex = 0;
        const boundedResults: TargetResult[] = results.map((result) =>
            result.kind === 'graph'
                ? (boundedGraphResults[graphIndex++] ?? result)
                : result
        );
        for (const result of boundedResults) {
            if (result.kind === 'graph' && result.sourceTruncated) {
                logTargetSourcesTruncated(result.target, {
                    originalSourceCount: result.originalSourceCount,
                    retainedSourceCount: result.sources.length,
                });
            }
            if (result.kind === 'graph' && result.responseTruncated) {
                logTargetResponseTruncated(result.target, {
                    originalResponseChars: result.originalResponseChars,
                    retainedResponseChars: result.response.length,
                });
            }
        }

        return toEvidenceBundle({
            queryIntent: query,
            scopeTuple: input.scopeTuple,
            partialTargetFailureIds: failures.map(
                (failure) => failure.target.id
            ),
            results: boundedResults,
        });
    }
}

export const createHttpTrustGraphEvidenceAdapter = (
    config: HttpTrustGraphAdapterConfig
): TrustGraphEvidenceAdapter => new HttpTrustGraphEvidenceAdapter(config);
