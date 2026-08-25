/**
 * @description: Provides a small typed HTTP client for the TrustGraph Librarian API.
 * It keeps repository-context ingestion separate from Footnote runtime and chat authority.
 * @footnote-scope: utility
 * @footnote-module: TrustGraphLibrarianClient
 * @footnote-risk: medium - Incorrect request shapes can leave external repository context incomplete or stale.
 * @footnote-ethics: high - Stored context and provenance metadata influence what outside evidence reviewers may inspect.
 */

import { TextDecoder } from 'node:util';

export type TrustGraphIriTerm = {
    t: 'i';
    i: string;
};

export type TrustGraphLiteralTerm = {
    t: 'l';
    v: string;
    d?: string;
    l?: string;
};

export type TrustGraphTerm = TrustGraphIriTerm | TrustGraphLiteralTerm;

export type TrustGraphTriple = {
    s: TrustGraphTerm;
    p: TrustGraphTerm;
    o: TrustGraphTerm;
};

export type TrustGraphDocumentMetadata = {
    id: string;
    time: number;
    kind: string;
    title: string;
    comments: string;
    metadata: TrustGraphTriple[];
    tags: string[];
    parentId?: string;
    documentType?: string;
};

export type TrustGraphProcessingMetadata = {
    id: string;
    documentId: string;
    time: number;
    flow: string;
    collection: string;
    tags: string[];
};

export type TrustGraphLibrarianClientOptions = {
    baseUrl: string;
    workspace: string;
    apiToken?: string;
    requestTimeoutMs: number;
};

type TrustGraphLibrarianRequest = {
    operation: string;
    workspace: string;
    [key: string]: unknown;
};

const MAX_ERROR_TEXT_LENGTH = 4_096;
const MAX_RESPONSE_TEXT_LENGTH = 5 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const readRequiredString = (value: unknown, fieldName: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(
            `TrustGraph Librarian response has invalid ${fieldName}.`
        );
    }
    return value;
};

const readOptionalString = (value: unknown): string =>
    typeof value === 'string' ? value : '';

const readOptionalNumber = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const readStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string');
};

const parseTerm = (value: unknown): TrustGraphTerm => {
    if (!isRecord(value)) {
        throw new Error('TrustGraph metadata term must be an object.');
    }

    if (value.t === 'i' && typeof value.i === 'string') {
        return { t: 'i', i: value.i };
    }
    if (value.t === 'l' && typeof value.v === 'string') {
        return {
            t: 'l',
            v: value.v,
            ...(typeof value.d === 'string' && { d: value.d }),
            ...(typeof value.l === 'string' && { l: value.l }),
        };
    }

    throw new Error(
        'TrustGraph metadata term must use the supported IRI or literal wire format.'
    );
};

const parseTriple = (value: unknown): TrustGraphTriple => {
    if (!isRecord(value)) {
        throw new Error('TrustGraph metadata triple must be an object.');
    }
    return {
        s: parseTerm(value.s),
        p: parseTerm(value.p),
        o: parseTerm(value.o),
    };
};

const parseDocumentMetadata = (value: unknown): TrustGraphDocumentMetadata => {
    if (!isRecord(value)) {
        throw new Error(
            'TrustGraph Librarian document metadata must be an object.'
        );
    }

    const metadata = Array.isArray(value.metadata)
        ? value.metadata.map(parseTriple)
        : [];

    return {
        id: readRequiredString(value.id, 'document id'),
        time: readOptionalNumber(value.time),
        kind: readOptionalString(value.kind),
        title: readOptionalString(value.title),
        comments: readOptionalString(value.comments),
        metadata,
        tags: readStringArray(value.tags),
        ...(typeof value['parent-id'] === 'string' && {
            parentId: value['parent-id'],
        }),
        ...(typeof value['document-type'] === 'string' && {
            documentType: value['document-type'],
        }),
    };
};

const parseProcessingMetadata = (
    value: unknown
): TrustGraphProcessingMetadata => {
    if (!isRecord(value)) {
        throw new Error(
            'TrustGraph Librarian processing metadata must be an object.'
        );
    }

    return {
        id: readRequiredString(value.id, 'processing id'),
        documentId: readRequiredString(
            value['document-id'],
            'processing document id'
        ),
        time: readOptionalNumber(value.time),
        flow: readOptionalString(value.flow),
        collection: readOptionalString(value.collection),
        tags: readStringArray(value.tags),
    };
};

const getErrorMessage = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
    if (isRecord(value)) {
        if (typeof value.message === 'string' && value.message.length > 0) {
            return value.message;
        }
        if (typeof value.type === 'string' && value.type.length > 0) {
            return value.type;
        }
    }
    return undefined;
};

const truncateErrorText = (value: string): string =>
    value.length <= MAX_ERROR_TEXT_LENGTH
        ? value
        : `${value.slice(0, MAX_ERROR_TEXT_LENGTH)}…`;

const makeOversizedResponseError = (): Error =>
    new Error('TrustGraph Librarian response exceeded the 5 MiB safety limit.');

const readResponseText = async (response: Response): Promise<string> => {
    const declaredLength = Number(
        response.headers.get('content-length') ?? Number.NaN
    );
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_TEXT_LENGTH
    ) {
        throw makeOversizedResponseError();
    }

    if (response.body === null) {
        return '';
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            totalBytes += value.byteLength;
            if (totalBytes > MAX_RESPONSE_TEXT_LENGTH) {
                await reader.cancel().catch(() => undefined);
                throw makeOversizedResponseError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
};

const toLibrarianUrl = (baseUrl: string): URL => {
    const parsed = new URL(baseUrl);
    return new URL('/api/v1/librarian', parsed);
};

/**
 * Sends repository documents through TrustGraph's setup-time Librarian boundary.
 *
 * The public method names mirror the TrustGraph Python API. The processing
 * methods intentionally send the service operations `add-processing` and
 * `remove-processing`.
 */
export class TrustGraphLibrarianClient {
    private readonly endpointUrl: URL;
    private readonly workspace: string;
    private readonly apiToken: string | undefined;
    private readonly requestTimeoutMs: number;

    public constructor(options: TrustGraphLibrarianClientOptions) {
        if (options.workspace.trim().length === 0) {
            throw new Error('TrustGraph workspace is required.');
        }
        if (
            !Number.isInteger(options.requestTimeoutMs) ||
            options.requestTimeoutMs <= 0
        ) {
            throw new Error(
                'TrustGraph request timeout must be a positive integer.'
            );
        }

        this.endpointUrl = toLibrarianUrl(options.baseUrl);
        this.workspace = options.workspace;
        this.apiToken = options.apiToken;
        this.requestTimeoutMs = options.requestTimeoutMs;
    }

    public async listDocuments(): Promise<TrustGraphDocumentMetadata[]> {
        const response = await this.request({
            operation: 'list-documents',
            workspace: this.workspace,
            'include-children': false,
        });
        const documents = response['document-metadatas'];
        if (!Array.isArray(documents)) {
            throw new Error(
                'TrustGraph Librarian response is missing document-metadatas.'
            );
        }
        return documents.map(parseDocumentMetadata);
    }

    public async listProcessing(): Promise<TrustGraphProcessingMetadata[]> {
        const response = await this.request({
            operation: 'list-processing',
            workspace: this.workspace,
        });
        const processings = response['processing-metadatas'];
        if (!Array.isArray(processings)) {
            throw new Error(
                'TrustGraph Librarian response is missing processing-metadatas.'
            );
        }
        return processings.map(parseProcessingMetadata);
    }

    public async addDocument(input: {
        documentMetadata: TrustGraphDocumentMetadata;
        contentBase64: string;
    }): Promise<void> {
        await this.request({
            operation: 'add-document',
            workspace: this.workspace,
            'document-metadata': {
                id: input.documentMetadata.id,
                time: input.documentMetadata.time,
                kind: input.documentMetadata.kind,
                title: input.documentMetadata.title,
                comments: input.documentMetadata.comments,
                metadata: input.documentMetadata.metadata,
                tags: input.documentMetadata.tags,
            },
            content: input.contentBase64,
        });
    }

    public async removeDocument(documentId: string): Promise<void> {
        await this.request({
            operation: 'remove-document',
            workspace: this.workspace,
            'document-id': documentId,
        });
    }

    public async startProcessing(
        processingMetadata: TrustGraphProcessingMetadata
    ): Promise<void> {
        await this.request({
            operation: 'add-processing',
            workspace: this.workspace,
            'processing-metadata': {
                id: processingMetadata.id,
                'document-id': processingMetadata.documentId,
                time: processingMetadata.time,
                flow: processingMetadata.flow,
                collection: processingMetadata.collection,
                tags: processingMetadata.tags,
            },
        });
    }

    public async stopProcessing(processingId: string): Promise<void> {
        await this.request({
            operation: 'remove-processing',
            workspace: this.workspace,
            'processing-id': processingId,
        });
    }

    private async request(
        payload: TrustGraphLibrarianRequest
    ): Promise<Record<string, unknown>> {
        const controller = new AbortController();
        let didTimeout = false;
        const timeoutHandle = setTimeout(() => {
            didTimeout = true;
            controller.abort();
        }, this.requestTimeoutMs);
        timeoutHandle.unref?.();

        try {
            const response = await fetch(this.endpointUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(this.apiToken !== undefined && {
                        authorization: `Bearer ${this.apiToken}`,
                    }),
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            const responseText = await readResponseText(response);

            let responseBody: unknown = {};
            if (responseText.trim().length > 0) {
                try {
                    responseBody = JSON.parse(responseText) as unknown;
                } catch (error) {
                    throw new Error(
                        `TrustGraph Librarian returned invalid JSON: ${truncateErrorText(responseText)}`,
                        { cause: error }
                    );
                }
            }

            if (!isRecord(responseBody)) {
                throw new Error(
                    'TrustGraph Librarian response must be a JSON object.'
                );
            }

            const remoteError = getErrorMessage(responseBody.error);
            if (!response.ok || remoteError !== undefined) {
                const detail =
                    remoteError ??
                    (responseText.trim().length > 0
                        ? truncateErrorText(responseText.trim())
                        : response.statusText);
                throw new Error(
                    `TrustGraph Librarian request failed: ${response.status} ${detail}`.trim()
                );
            }

            return responseBody;
        } catch (error) {
            if (didTimeout) {
                throw new Error(
                    `TrustGraph Librarian request timed out after ${this.requestTimeoutMs}ms.`,
                    { cause: error }
                );
            }
            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }
}
