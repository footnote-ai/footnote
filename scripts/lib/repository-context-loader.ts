/**
 * @description: Loads the repository-owned context allowlist into TrustGraph through its Librarian API.
 * It uses stable identities and content hashes so repeated setup runs are safe and inspectable.
 * @footnote-scope: utility
 * @footnote-module: RepositoryContextLoader
 * @footnote-risk: medium - Incorrect reconciliation can leave external repository context incomplete or stale.
 * @footnote-ethics: high - Repository context selection and provenance affect evidence available to human reviewers.
 */

import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import {
    DEFAULT_REPOSITORY_CONTEXT_LIMITS,
    resolveRepositoryContextFiles,
    type RepositoryContextLimits,
} from './repository-context-files.js';
import {
    TrustGraphLibrarianClient,
    type TrustGraphDocumentMetadata,
    type TrustGraphProcessingMetadata,
    type TrustGraphTriple,
} from './trustgraph-librarian-client.js';

export const DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID =
    'https://github.com/footnote-ai/footnote';
export const DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS = 30_000;
export const REPOSITORY_CONTEXT_REPOSITORY_PREDICATE =
    'urn:footnote:repository-context:repository';
export const REPOSITORY_CONTEXT_PATH_PREDICATE =
    'urn:footnote:repository-context:path';
export const REPOSITORY_CONTEXT_SHA256_PREDICATE =
    'urn:footnote:repository-context:sha256';

const DOCUMENT_ID_PREFIX = 'urn:footnote:repository-context:document:';
const PROCESSING_ID_PREFIX = 'urn:footnote:repository-context:processing:';
const REPOSITORY_CONTEXT_TAGS = ['footnote', 'repository-context'];
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export type RepositoryContextLoadStatus =
    | 'added'
    | 'changed'
    | 'unchanged'
    | 'skipped'
    | 'failed';

export type RepositoryContextLoadInput = {
    repositoryRoot: string;
    trustGraphBaseUrl: string;
    apiToken?: string;
    workspace: string;
    flowId: string;
    collection: string;
    repositoryId: string;
    requestTimeoutMs: number;
    limits?: Partial<RepositoryContextLimits>;
};

export type RepositoryContextLoadItemResult = {
    path: string;
    status: RepositoryContextLoadStatus;
    sizeBytes?: number;
    contentSha256?: string;
    documentId?: string;
    processingId?: string;
    reason?: string;
};

export type RepositoryContextLoadCounts = {
    added: number;
    changed: number;
    unchanged: number;
    skipped: number;
    failed: number;
};

export type RepositoryContextLoadResult = {
    repositoryId: string;
    workspace: string;
    flowId: string;
    collection: string;
    startedAt: string;
    completedAt: string;
    selectedFileCount: number;
    selectedBytes: number;
    counts: RepositoryContextLoadCounts;
    items: RepositoryContextLoadItemResult[];
};

type ReadableRepositoryDocument = {
    path: string;
    sizeBytes: number;
    contentSha256: string;
    contentBase64: string;
    documentId: string;
    processingId: string;
};

type ReadRepositoryDocumentResult =
    | {
          document: ReadableRepositoryDocument;
      }
    | {
          item: RepositoryContextLoadItemResult;
      };

type ManagedRemoteDocument = {
    document: TrustGraphDocumentMetadata;
    path: string;
    contentSha256: string;
};

const comparePaths = (
    left: RepositoryContextLoadItemResult,
    right: RepositoryContextLoadItemResult
): number => left.path.localeCompare(right.path, 'en');

const isPathInside = (rootPath: string, candidatePath: string): boolean => {
    const relativePath = path.relative(rootPath, candidatePath);
    return (
        relativePath.length > 0 &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
};

const formatError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const makeIdentityHash = (repositoryId: string, filePath: string): string =>
    createHash('sha256')
        .update(`${repositoryId}\n${filePath}`, 'utf8')
        .digest('hex');

const makeDocumentIdentity = (
    repositoryId: string,
    filePath: string
): { documentId: string; processingId: string } => {
    const identityHash = makeIdentityHash(repositoryId, filePath);
    return {
        documentId: `${DOCUMENT_ID_PREFIX}${identityHash}`,
        processingId: `${PROCESSING_ID_PREFIX}${identityHash}`,
    };
};

const makeItem = (
    document: ReadableRepositoryDocument,
    status: RepositoryContextLoadStatus,
    reason?: string
): RepositoryContextLoadItemResult => ({
    path: document.path,
    status,
    sizeBytes: document.sizeBytes,
    contentSha256: document.contentSha256,
    documentId: document.documentId,
    processingId: document.processingId,
    ...(reason !== undefined && { reason }),
});

const hasStableStats = (before: Stats, after: Stats): boolean =>
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs;

const readRepositoryDocument = async (input: {
    repositoryRoot: string;
    realRepositoryRoot: string;
    repositoryId: string;
    filePath: string;
    maxFileBytes: number;
}): Promise<ReadRepositoryDocumentResult> => {
    const identity = makeDocumentIdentity(input.repositoryId, input.filePath);
    const baseItem = {
        path: input.filePath,
        documentId: identity.documentId,
        processingId: identity.processingId,
    };
    const absolutePath = path.resolve(input.repositoryRoot, input.filePath);

    if (!isPathInside(input.repositoryRoot, absolutePath)) {
        return {
            item: {
                ...baseItem,
                status: 'failed',
                reason: 'resolved path escapes the repository',
            },
        };
    }

    let fileHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
        const pathStats = await fs.lstat(absolutePath);
        if (pathStats.isSymbolicLink()) {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    reason: 'symbolic link',
                },
            };
        }
        if (!pathStats.isFile()) {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    reason: 'not a regular file',
                },
            };
        }

        const realFilePath = await fs.realpath(absolutePath);
        if (!isPathInside(input.realRepositoryRoot, realFilePath)) {
            return {
                item: {
                    ...baseItem,
                    status: 'failed',
                    reason: 'real path escapes the repository',
                },
            };
        }

        fileHandle = await fs.open(realFilePath, 'r');
        const beforeStats = await fileHandle.stat();
        if (!beforeStats.isFile()) {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    reason: 'not a regular file',
                },
            };
        }
        if (beforeStats.size > input.maxFileBytes) {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    sizeBytes: beforeStats.size,
                    reason: `larger than ${input.maxFileBytes} bytes`,
                },
            };
        }

        const content = await fileHandle.readFile();
        const afterStats = await fileHandle.stat();
        if (!hasStableStats(beforeStats, afterStats)) {
            return {
                item: {
                    ...baseItem,
                    status: 'failed',
                    reason: 'file changed while it was being read',
                },
            };
        }
        if (content.byteLength > input.maxFileBytes) {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    sizeBytes: content.byteLength,
                    reason: `larger than ${input.maxFileBytes} bytes`,
                },
            };
        }

        let decodedContent: string;
        try {
            decodedContent = UTF8_DECODER.decode(content);
        } catch {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    sizeBytes: content.byteLength,
                    reason: 'not valid UTF-8 text',
                },
            };
        }
        if (decodedContent.includes('\0')) {
            return {
                item: {
                    ...baseItem,
                    status: 'skipped',
                    sizeBytes: content.byteLength,
                    reason: 'contains a NUL byte',
                },
            };
        }

        return {
            document: {
                ...baseItem,
                sizeBytes: content.byteLength,
                contentSha256: createHash('sha256')
                    .update(content)
                    .digest('hex'),
                contentBase64: content.toString('base64'),
            },
        };
    } catch (error) {
        return {
            item: {
                ...baseItem,
                status: 'failed',
                reason: `could not read file: ${formatError(error)}`,
            },
        };
    } finally {
        await fileHandle?.close().catch(() => undefined);
    }
};

const metadataLiteralValues = (
    document: TrustGraphDocumentMetadata,
    predicate: string
): string[] =>
    document.metadata
        .filter(
            (triple) =>
                triple.p.t === 'i' &&
                triple.p.i === predicate &&
                triple.o.t === 'l'
        )
        .map((triple) => (triple.o.t === 'l' ? triple.o.v : ''));

const hasInvalidIdentitySubject = (
    document: TrustGraphDocumentMetadata
): boolean => {
    const identityPredicates = new Set([
        REPOSITORY_CONTEXT_REPOSITORY_PREDICATE,
        REPOSITORY_CONTEXT_PATH_PREDICATE,
        REPOSITORY_CONTEXT_SHA256_PREDICATE,
    ]);
    return document.metadata.some(
        (triple) =>
            triple.p.t === 'i' &&
            identityPredicates.has(triple.p.i) &&
            (triple.s.t !== 'i' || triple.s.i !== document.id)
    );
};

const isSafeRepositoryPath = (filePath: string): boolean =>
    filePath.length > 0 &&
    !filePath.includes('\\') &&
    !path.posix.isAbsolute(filePath) &&
    filePath !== '..' &&
    !filePath.startsWith('../') &&
    path.posix.normalize(filePath) === filePath;

const inspectManagedRemoteDocuments = (
    documents: TrustGraphDocumentMetadata[],
    repositoryId: string
): {
    byPath: Map<string, ManagedRemoteDocument[]>;
    blockedPaths: Set<string>;
    failures: RepositoryContextLoadItemResult[];
} => {
    const byPath = new Map<string, ManagedRemoteDocument[]>();
    const blockedPaths = new Set<string>();
    const failures: RepositoryContextLoadItemResult[] = [];

    for (const document of documents) {
        const repositoryValues = metadataLiteralValues(
            document,
            REPOSITORY_CONTEXT_REPOSITORY_PREDICATE
        );
        if (!repositoryValues.includes(repositoryId)) {
            continue;
        }

        const pathValues = metadataLiteralValues(
            document,
            REPOSITORY_CONTEXT_PATH_PREDICATE
        );
        const hashValues = metadataLiteralValues(
            document,
            REPOSITORY_CONTEXT_SHA256_PREDICATE
        );
        const remotePath = pathValues[0] ?? document.title ?? document.id;
        if (
            repositoryValues.length !== 1 ||
            pathValues.length !== 1 ||
            hashValues.length !== 1 ||
            hasInvalidIdentitySubject(document) ||
            !isSafeRepositoryPath(remotePath) ||
            !/^[a-f0-9]{64}$/u.test(hashValues[0] ?? '')
        ) {
            if (isSafeRepositoryPath(remotePath)) {
                blockedPaths.add(remotePath);
            }
            failures.push({
                path: remotePath,
                status: 'failed',
                documentId: document.id,
                reason: 'managed remote document has malformed identity metadata',
            });
            continue;
        }

        const entries = byPath.get(remotePath) ?? [];
        entries.push({
            document,
            path: remotePath,
            contentSha256: hashValues[0],
        });
        byPath.set(remotePath, entries);
    }

    return { byPath, blockedPaths, failures };
};

const makeTriple = (
    documentId: string,
    predicate: string,
    value: string
): TrustGraphTriple => ({
    s: { t: 'i', i: documentId },
    p: { t: 'i', i: predicate },
    o: { t: 'l', v: value },
});

const makeDocumentMetadata = (
    document: ReadableRepositoryDocument,
    repositoryId: string,
    time: number
): TrustGraphDocumentMetadata => ({
    id: document.documentId,
    time,
    kind: 'text/plain',
    title: document.path,
    comments:
        'Footnote repository context selected by .footnote/context-files.',
    metadata: [
        makeTriple(
            document.documentId,
            REPOSITORY_CONTEXT_REPOSITORY_PREDICATE,
            repositoryId
        ),
        makeTriple(
            document.documentId,
            REPOSITORY_CONTEXT_PATH_PREDICATE,
            document.path
        ),
        makeTriple(
            document.documentId,
            REPOSITORY_CONTEXT_SHA256_PREDICATE,
            document.contentSha256
        ),
    ],
    tags: [...REPOSITORY_CONTEXT_TAGS],
});

const makeProcessingMetadata = (
    document: ReadableRepositoryDocument,
    flowId: string,
    collection: string,
    time: number
): TrustGraphProcessingMetadata => ({
    id: document.processingId,
    documentId: document.documentId,
    time,
    flow: flowId,
    collection,
    tags: [...REPOSITORY_CONTEXT_TAGS],
});

const addAndProcessDocument = async (
    client: TrustGraphLibrarianClient,
    document: ReadableRepositoryDocument,
    input: RepositoryContextLoadInput
): Promise<void> => {
    const time = Math.floor(Date.now() / 1000);
    await client.addDocument({
        documentMetadata: makeDocumentMetadata(
            document,
            input.repositoryId,
            time
        ),
        contentBase64: document.contentBase64,
    });
    await client.startProcessing(
        makeProcessingMetadata(document, input.flowId, input.collection, time)
    );
};

const reconcileDocument = async (input: {
    client: TrustGraphLibrarianClient;
    local: ReadableRepositoryDocument;
    remote: ManagedRemoteDocument | undefined;
    processingIds: Set<string>;
    loadInput: RepositoryContextLoadInput;
}): Promise<RepositoryContextLoadItemResult> => {
    const hasProcessing = input.processingIds.has(input.local.processingId);

    try {
        if (input.remote === undefined) {
            if (hasProcessing) {
                await input.client.stopProcessing(input.local.processingId);
            }
            await addAndProcessDocument(
                input.client,
                input.local,
                input.loadInput
            );
            return makeItem(
                input.local,
                hasProcessing ? 'changed' : 'added',
                hasProcessing
                    ? 'replaced orphaned processing submission'
                    : undefined
            );
        }

        if (input.remote.document.id !== input.local.documentId) {
            return makeItem(
                input.local,
                'failed',
                'managed remote document has an unexpected stable id'
            );
        }

        if (input.remote.contentSha256 === input.local.contentSha256) {
            if (hasProcessing) {
                return makeItem(input.local, 'unchanged');
            }
            await input.client.startProcessing(
                makeProcessingMetadata(
                    input.local,
                    input.loadInput.flowId,
                    input.loadInput.collection,
                    Math.floor(Date.now() / 1000)
                )
            );
            return makeItem(
                input.local,
                'changed',
                'repaired missing processing submission'
            );
        }

        if (hasProcessing) {
            await input.client.stopProcessing(input.local.processingId);
        }
        await input.client.removeDocument(input.local.documentId);
        await addAndProcessDocument(input.client, input.local, input.loadInput);
        return makeItem(input.local, 'changed', 'content hash changed');
    } catch (error) {
        return makeItem(input.local, 'failed', formatError(error));
    }
};

const makeCounts = (
    items: RepositoryContextLoadItemResult[]
): RepositoryContextLoadCounts => {
    const counts: RepositoryContextLoadCounts = {
        added: 0,
        changed: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
    };
    for (const item of items) {
        counts[item.status] += 1;
    }
    return counts;
};

const assertLoadInput = (
    input: RepositoryContextLoadInput
): RepositoryContextLimits => {
    for (const [name, value] of [
        ['workspace', input.workspace],
        ['flowId', input.flowId],
        ['collection', input.collection],
        ['repositoryId', input.repositoryId],
    ] as const) {
        if (value.trim().length === 0) {
            throw new Error(`${name} is required.`);
        }
    }
    if (
        !Number.isInteger(input.requestTimeoutMs) ||
        input.requestTimeoutMs <= 0
    ) {
        throw new Error('requestTimeoutMs must be a positive integer.');
    }

    const limits: RepositoryContextLimits = {
        ...DEFAULT_REPOSITORY_CONTEXT_LIMITS,
        ...input.limits,
    };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`${name} must be a positive integer.`);
        }
    }
    if (limits.maxFileBytes > DEFAULT_REPOSITORY_CONTEXT_LIMITS.maxFileBytes) {
        throw new Error(
            `maxFileBytes cannot exceed ${DEFAULT_REPOSITORY_CONTEXT_LIMITS.maxFileBytes}; repository context uses one add-document request per file.`
        );
    }
    return limits;
};

/**
 * Reconciles selected repository text files with one TrustGraph workspace.
 *
 * File and request failures remain isolated to their item whenever possible.
 * The result is serializable and never includes source contents or credentials.
 */
export const loadRepositoryContext = async (
    input: RepositoryContextLoadInput
): Promise<RepositoryContextLoadResult> => {
    const startedAt = new Date().toISOString();
    const limits = assertLoadInput(input);
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const realRepositoryRoot = await fs.realpath(repositoryRoot);
    const selection = await resolveRepositoryContextFiles({
        repositoryRoot,
        limits,
    });
    const items: RepositoryContextLoadItemResult[] = selection.skipped.map(
        (skipped) => ({
            path: skipped.path,
            status: 'skipped',
            reason: skipped.reason,
        })
    );
    const readableDocuments: ReadableRepositoryDocument[] = [];
    let selectedBytes = 0;

    for (const selectedFile of selection.files) {
        const readResult = await readRepositoryDocument({
            repositoryRoot,
            realRepositoryRoot,
            repositoryId: input.repositoryId,
            filePath: selectedFile.path,
            maxFileBytes: limits.maxFileBytes,
        });
        if ('item' in readResult) {
            items.push(readResult.item);
            continue;
        }
        if (
            selectedBytes + readResult.document.sizeBytes >
            limits.maxTotalBytes
        ) {
            items.push(
                makeItem(
                    readResult.document,
                    'skipped',
                    `combined readable content exceeds ${limits.maxTotalBytes} bytes`
                )
            );
            continue;
        }
        selectedBytes += readResult.document.sizeBytes;
        readableDocuments.push(readResult.document);
    }

    const client = new TrustGraphLibrarianClient({
        baseUrl: input.trustGraphBaseUrl,
        workspace: input.workspace,
        apiToken: input.apiToken,
        requestTimeoutMs: input.requestTimeoutMs,
    });
    const [remoteDocuments, remoteProcessings] = await Promise.all([
        client.listDocuments(),
        client.listProcessing(),
    ]);
    const inspectedRemote = inspectManagedRemoteDocuments(
        remoteDocuments,
        input.repositoryId
    );
    items.push(...inspectedRemote.failures);

    const processingById = new Map(
        remoteProcessings.map((processing) => [processing.id, processing])
    );
    const processingIds = new Set(processingById.keys());
    const selectedPaths = new Set(
        selection.files.map((selectedFile) => selectedFile.path)
    );

    for (const document of readableDocuments) {
        if (inspectedRemote.blockedPaths.has(document.path)) {
            continue;
        }
        const matchingRemote = inspectedRemote.byPath.get(document.path) ?? [];
        if (matchingRemote.length > 1) {
            items.push(
                makeItem(
                    document,
                    'failed',
                    'multiple managed remote documents share this path'
                )
            );
            continue;
        }

        const expectedProcessing = processingById.get(document.processingId);
        if (
            expectedProcessing !== undefined &&
            expectedProcessing.documentId !== document.documentId
        ) {
            items.push(
                makeItem(
                    document,
                    'failed',
                    'managed processing submission points to an unexpected document'
                )
            );
            continue;
        }

        items.push(
            await reconcileDocument({
                client,
                local: document,
                remote: matchingRemote[0],
                processingIds,
                loadInput: input,
            })
        );
    }

    const existingItemPaths = new Set(items.map((item) => item.path));
    for (const [remotePath, matchingRemote] of inspectedRemote.byPath) {
        if (
            selectedPaths.has(remotePath) ||
            existingItemPaths.has(remotePath)
        ) {
            continue;
        }
        items.push({
            path: remotePath,
            status: matchingRemote.length > 1 ? 'failed' : 'skipped',
            documentId:
                matchingRemote.length === 1
                    ? matchingRemote[0].document.id
                    : undefined,
            reason:
                matchingRemote.length > 1
                    ? 'multiple managed remote documents share this path'
                    : 'not selected locally; remote document left unchanged',
        });
    }

    items.sort(comparePaths);
    return {
        repositoryId: input.repositoryId,
        workspace: input.workspace,
        flowId: input.flowId,
        collection: input.collection,
        startedAt,
        completedAt: new Date().toISOString(),
        selectedFileCount: selection.files.length,
        selectedBytes,
        counts: makeCounts(items),
        items,
    };
};
