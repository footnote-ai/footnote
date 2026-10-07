/**
 * @description: Persists provenance traces in SQLite with retry handling and validation.
 * @footnote-scope: utility
 * @footnote-module: SqliteTraceStore
 * @footnote-risk: high - SQLite now also holds anonymous page snapshots and hashed publish capabilities.
 * @footnote-ethics: high - Storage governs public response exposure and limited session-scoped revocation.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import {
    TRACE_ASSESS_FINAL_TEMPERAMENT_SIGNAL_KEYS,
    type Citation,
    type ResponseMetadata,
} from '@footnote/contracts/policy';
import type {
    PublicResponseProjection,
    ResponseCandidate,
    TraceDisplayMetadata,
} from '@footnote/contracts/web';
import {
    GetPublicResponseResponseSchema,
    normalizePresentationMetadataForCompatibility,
    ResponseCandidateSchema,
    ResponseMetadataSchema,
} from '@footnote/contracts/web/schemas';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { traceStoreJsonReplacer } from './traceStoreUtils.js';
import { projectTraceMetadataForDisplay } from './traceDisplayProjection.js';

const BUSY_MAX_ATTEMPTS = 5;
const BUSY_RETRY_DELAY_MS = 50;
const PUBLIC_RESPONSE_TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_RESPONSE_CLEANUP_INTERVAL_MS = 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const traceLogger =
    typeof logger.child === 'function'
        ? logger.child({ module: 'sqliteTraceStore' })
        : logger;
const TRACE_ASSESS_FINAL_AXIS_SIGNAL_KEYS = Object.values(
    TRACE_ASSESS_FINAL_TEMPERAMENT_SIGNAL_KEYS
);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;

const hasFinalTemperamentAxisSignals = (
    signals: Record<string, unknown>
): boolean =>
    TRACE_ASSESS_FINAL_AXIS_SIGNAL_KEYS.some((axisKey) => {
        const score = signals[axisKey];
        return (
            typeof score === 'number' &&
            Number.isInteger(score) &&
            score >= 1 &&
            score <= 5
        );
    });

const normalizeAssessSignalsForCompatibility = (
    signals: Record<string, unknown>
): Record<string, unknown> => {
    const normalizedSignals: Record<string, unknown> = { ...signals };
    const reviewDecision = normalizedSignals.reviewDecision;
    const reviewReason = normalizedSignals.reviewReason;
    if (
        (reviewDecision === 'finalize' || reviewDecision === 'revise') &&
        (typeof reviewReason !== 'string' || reviewReason.trim().length === 0)
    ) {
        normalizedSignals.reviewReason =
            'Compatibility fallback: assess reason unavailable.';
    }
    if (reviewDecision === 'revise') {
        const revisionInstruction = normalizedSignals.revisionInstruction;
        if (
            typeof revisionInstruction !== 'string' ||
            revisionInstruction.trim().length === 0
        ) {
            normalizedSignals.revisionInstruction =
                'Compatibility fallback: revision instruction unavailable.';
        }
    }

    const traceAlignment = normalizedSignals.traceAlignment;
    const hasTraceAlignment =
        traceAlignment === 'aligned' || traceAlignment === 'misaligned';
    if (!hasTraceAlignment) {
        normalizedSignals.traceAlignment = 'aligned';
        return normalizedSignals;
    }

    if (traceAlignment === 'misaligned') {
        const traceAlignmentReason = normalizedSignals.traceAlignmentReason;
        const hasReason =
            typeof traceAlignmentReason === 'string' &&
            traceAlignmentReason.trim().length > 0;
        if (!hasReason || !hasFinalTemperamentAxisSignals(normalizedSignals)) {
            normalizedSignals.traceAlignment = 'aligned';
            delete normalizedSignals.traceAlignmentReason;
        }
    }

    return normalizedSignals;
};

const repairTraceMetadataForCompatibility = (metadata: unknown): unknown => {
    if (!isPlainObject(metadata)) {
        return metadata;
    }

    const root = { ...metadata };
    if (isPlainObject(root.presentation)) {
        root.presentation = normalizePresentationMetadataForCompatibility(
            root.presentation
        );
    }
    if (!isPlainObject(root.workflow)) {
        return root;
    }

    const workflow = { ...root.workflow };
    if (!Array.isArray(workflow.steps)) {
        root.workflow = workflow;
        return root;
    }

    workflow.steps = workflow.steps.map((step): unknown => {
        if (!isPlainObject(step)) {
            return step;
        }
        if (step.stepKind !== 'assess') {
            return step;
        }
        if (!isPlainObject(step.outcome)) {
            return step;
        }
        if (step.outcome.status !== 'executed') {
            return step;
        }
        const outcome = { ...step.outcome };
        const existingSignals = isPlainObject(outcome.signals)
            ? outcome.signals
            : {};
        outcome.signals =
            normalizeAssessSignalsForCompatibility(existingSignals);

        return {
            ...step,
            outcome,
        };
    });

    root.workflow = workflow;
    return root;
};

export interface SqliteTraceStoreConfig {
    dbPath: string;
}

type PublicResponseState = 'published' | 'expired' | 'revoked' | 'unavailable';
type PublicResponseResult =
    | {
          status: 'published';
          responseId: string;
          projection: PublicResponseProjection;
      }
    | { status: Exclude<PublicResponseState, 'published'> | 'not_found' };

type PublicationSource = {
    responseId: string;
    answer: string;
    publicationToken: string;
    expiresAt: string;
    metadata: ResponseMetadata;
};

const sha256 = (value: string): string =>
    createHash('sha256').update(value, 'utf8').digest('hex');

const hashesMatch = (expected: string, actual: string): boolean => {
    const expectedBytes = Buffer.from(expected, 'hex');
    const actualBytes = Buffer.from(actual, 'hex');
    return (
        expectedBytes.length === 32 &&
        actualBytes.length === 32 &&
        timingSafeEqual(expectedBytes, actualBytes)
    );
};

export class SqliteTraceStore {
    private readonly db: Database.Database;
    private readonly upsertStatement: Database.Statement;
    private readonly retrieveStatement: Database.Statement;
    private readonly retrieveTraceForPublicationStatement: Database.Statement;
    private readonly traceExistsStatement: Database.Statement;
    private readonly deleteStatement: Database.Statement;
    private readonly upsertTraceCardStatement: Database.Statement;
    private readonly retrieveTraceCardStatement: Database.Statement;
    private readonly deleteResponseCandidatesStatement: Database.Statement;
    private readonly insertResponseCandidateStatement: Database.Statement;
    private readonly retrieveResponseCandidatesStatement: Database.Statement;
    private readonly createPublicationSourceStatement: Database.Statement;
    private readonly retrievePublicationSourceStatement: Database.Statement;
    private readonly deletePublicationSourceStatement: Database.Statement;
    private readonly insertPublicResponseStatement: Database.Statement;
    private readonly retrievePublicResponseStatement: Database.Statement;
    private readonly updatePublicResponseStateStatement: Database.Statement;
    private readonly revokePublicResponseStatement: Database.Statement;
    private readonly cleanupExpiredPublicResponsesStatement: Database.Statement;
    private readonly deleteRetainedPublicResponseTombstonesStatement: Database.Statement;
    private readonly invalidatePublicResponsesByTraceStatement: Database.Statement;
    private readonly publicResponseCleanupTimer: NodeJS.Timeout;

    constructor(config: SqliteTraceStoreConfig) {
        const resolvedPath = path.resolve(config.dbPath);
        const dir = path.dirname(resolvedPath); // Ensure the parent directory exists before opening the database.
        fs.mkdirSync(dir, { recursive: true });

        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL'); // WAL (Write-Ahead Logging) is a journaling mode that allows for concurrent writes to the database.
        this.db.pragma('foreign_keys = ON'); // Foreign keys are enabled to enforce referential integrity.

        this.db.exec(`
      CREATE TABLE IF NOT EXISTS provenance_traces (
        response_id TEXT PRIMARY KEY,
        metadata_json TEXT NOT NULL,
        stale_after TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provenance_traces_stale_after ON provenance_traces (stale_after);
      CREATE TABLE IF NOT EXISTS provenance_trace_cards (
        response_id TEXT PRIMARY KEY REFERENCES provenance_traces(response_id) ON DELETE CASCADE,
        trace_card_svg TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provenance_response_candidates (
        candidate_id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL REFERENCES provenance_traces(response_id) ON DELETE CASCADE,
        parent_candidate_id TEXT,
        workflow_step_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        stage TEXT NOT NULL,
        selection_state TEXT NOT NULL,
        text TEXT NOT NULL,
        UNIQUE(response_id, sequence_number)
      );
      CREATE INDEX IF NOT EXISTS idx_provenance_response_candidates_response_sequence
        ON provenance_response_candidates (response_id, sequence_number);
      CREATE TABLE IF NOT EXISTS response_publication_sources (
        response_id TEXT PRIMARY KEY REFERENCES provenance_traces(response_id) ON DELETE CASCADE,
        answer_sha256 TEXT NOT NULL,
        publication_token_sha256 TEXT NOT NULL,
        metadata_sha256 TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS public_response_publications (
        public_id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL REFERENCES provenance_traces(response_id) ON DELETE CASCADE,
        projection_json TEXT,
        publication_token_sha256 TEXT NOT NULL,
        published_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('published', 'expired', 'revoked', 'unavailable'))
      );
      CREATE INDEX IF NOT EXISTS idx_public_response_publications_expiry
        ON public_response_publications (expires_at);
    `);
        this.ensureTraceCardForeignKey();

        this.upsertStatement = this.db.prepare(`
      INSERT INTO provenance_traces (response_id, metadata_json, stale_after, created_at, updated_at)
      VALUES (@response_id, @metadata_json, @stale_after, @created_at, @updated_at)
      ON CONFLICT(response_id) DO UPDATE SET
        metadata_json = excluded.metadata_json,
        stale_after = excluded.stale_after,
        updated_at = excluded.updated_at
    `);
        this.retrieveStatement = this.db.prepare(
            `SELECT metadata_json FROM provenance_traces WHERE response_id = ? LIMIT 1`
        );
        this.retrieveTraceForPublicationStatement = this.db.prepare(
            `SELECT metadata_json, stale_after FROM provenance_traces WHERE response_id = ? LIMIT 1`
        );
        this.traceExistsStatement = this.db.prepare(
            `SELECT 1 AS present FROM provenance_traces WHERE response_id = ? LIMIT 1`
        );
        this.deleteStatement = this.db.prepare(
            `DELETE FROM provenance_traces WHERE response_id = ?`
        );
        this.upsertTraceCardStatement = this.db.prepare(`
      INSERT INTO provenance_trace_cards (response_id, trace_card_svg)
      VALUES (@response_id, @trace_card_svg)
      ON CONFLICT(response_id) DO UPDATE SET
        trace_card_svg = excluded.trace_card_svg
    `);
        this.retrieveTraceCardStatement = this.db.prepare(
            `SELECT trace_card_svg FROM provenance_trace_cards WHERE response_id = ? LIMIT 1`
        );
        this.deleteResponseCandidatesStatement = this.db.prepare(
            `DELETE FROM provenance_response_candidates WHERE response_id = ?`
        );
        this.insertResponseCandidateStatement = this.db.prepare(`
            INSERT INTO provenance_response_candidates (
                candidate_id, response_id, parent_candidate_id, workflow_step_id,
                sequence_number, stage, selection_state, text
            ) VALUES (
                @candidate_id, @response_id, @parent_candidate_id, @workflow_step_id,
                @sequence_number, @stage, @selection_state, @text
            )
        `);
        this.retrieveResponseCandidatesStatement = this.db.prepare(`
            SELECT candidate_id, parent_candidate_id, workflow_step_id,
                   sequence_number, stage, selection_state, text
            FROM provenance_response_candidates
            WHERE response_id = ?
            ORDER BY sequence_number ASC
        `);
        this.createPublicationSourceStatement = this.db.prepare(`
            INSERT INTO response_publication_sources (
                response_id, answer_sha256, publication_token_sha256, metadata_sha256, expires_at
            ) VALUES (@response_id, @answer_sha256, @publication_token_sha256, @metadata_sha256, @expires_at)
            ON CONFLICT(response_id) DO UPDATE SET
                answer_sha256 = excluded.answer_sha256,
                publication_token_sha256 = excluded.publication_token_sha256,
                metadata_sha256 = excluded.metadata_sha256,
                expires_at = excluded.expires_at
        `);
        this.retrievePublicationSourceStatement = this.db.prepare(`
            SELECT answer_sha256, publication_token_sha256, metadata_sha256, expires_at
            FROM response_publication_sources WHERE response_id = ? LIMIT 1
        `);
        this.deletePublicationSourceStatement = this.db.prepare(
            `DELETE FROM response_publication_sources WHERE response_id = ?`
        );
        this.insertPublicResponseStatement = this.db.prepare(`
            INSERT INTO public_response_publications (
                public_id, response_id, projection_json, publication_token_sha256,
                published_at, expires_at, state
            ) VALUES (@public_id, @response_id, @projection_json, @publication_token_sha256,
                      @published_at, @expires_at, 'published')
        `);
        this.retrievePublicResponseStatement = this.db.prepare(`
            SELECT public_id, response_id, projection_json, publication_token_sha256,
                   published_at, expires_at, state
            FROM public_response_publications WHERE public_id = ? LIMIT 1
        `);
        this.updatePublicResponseStateStatement = this.db.prepare(`
            UPDATE public_response_publications
            SET state = @state, projection_json = NULL
            WHERE public_id = @public_id
        `);
        this.revokePublicResponseStatement = this.db.prepare(`
            UPDATE public_response_publications
            SET state = 'revoked', projection_json = NULL
            WHERE public_id = ? AND state = 'published'
        `);
        this.cleanupExpiredPublicResponsesStatement = this.db.prepare(`
            UPDATE public_response_publications
            SET state = 'expired', projection_json = NULL
            WHERE state = 'published' AND expires_at <= ?
        `);
        this.deleteRetainedPublicResponseTombstonesStatement = this.db.prepare(`
            DELETE FROM public_response_publications
            WHERE state IN ('expired', 'revoked', 'unavailable') AND expires_at <= ?
        `);
        this.invalidatePublicResponsesByTraceStatement = this.db.prepare(`
            UPDATE public_response_publications
            SET state = 'unavailable', projection_json = NULL
            WHERE response_id = ? AND state = 'published'
        `);
        this.cleanupPublicResponses(new Date().toISOString());
        this.publicResponseCleanupTimer = setInterval(() => {
            try {
                this.cleanupPublicResponses(new Date().toISOString());
            } catch {
                traceLogger.warn(
                    'Public response cleanup failed; it will retry on the next interval.'
                );
            }
        }, PUBLIC_RESPONSE_CLEANUP_INTERVAL_MS);
        this.publicResponseCleanupTimer.unref();
        this.db
            .prepare(
                `DELETE FROM response_publication_sources WHERE expires_at <= ?`
            )
            .run(new Date().toISOString());
        traceLogger.info(`Initialized SQLite trace store at ${resolvedPath}`);
    }

    /** Keeps unavailable-link tombstones for one week after their public expiry. */
    private cleanupPublicResponses(now: string): void {
        this.cleanupExpiredPublicResponsesStatement.run(now);
        const tombstoneCutoff = new Date(
            Date.parse(now) - PUBLIC_RESPONSE_TOMBSTONE_RETENTION_MS
        ).toISOString();
        this.deleteRetainedPublicResponseTombstonesStatement.run(
            tombstoneCutoff
        );
    }

    /** Stores hashes only; the exact answer is kept only after explicit publication. */
    async createPublicResponseSource(source: PublicationSource): Promise<void> {
        await this.withRetry(() => {
            const now = new Date().toISOString();
            this.cleanupPublicResponses(now);
            this.db
                .prepare(
                    `DELETE FROM response_publication_sources WHERE expires_at <= ?`
                )
                .run(now);
            this.createPublicationSourceStatement.run({
                response_id: source.responseId,
                answer_sha256: sha256(source.answer),
                publication_token_sha256: sha256(source.publicationToken),
                metadata_sha256: sha256(
                    JSON.stringify(
                        this.normalizeMetadata(source.metadata),
                        traceStoreJsonReplacer
                    )
                ),
                expires_at: source.expiresAt,
            });
        });
    }

    /** Creates one immutable, allowlisted publication after checking the backend capability. */
    async publishPublicResponse(input: {
        responseId: string;
        answer: string;
        publicationToken: string;
        expectedMetadataSha256: string;
        publicId: string;
        projection: PublicResponseProjection;
        publishedAt: string;
        expiresAt: string;
    }): Promise<'published' | 'invalid' | 'expired'> {
        return this.withRetry(() => {
            const publish = this.db.transaction(() => {
                const now = new Date().toISOString();
                this.cleanupPublicResponses(now);
                const source = this.retrievePublicationSourceStatement.get(
                    input.responseId
                ) as
                    | {
                          answer_sha256: string;
                          publication_token_sha256: string;
                          metadata_sha256: string;
                          expires_at: string;
                      }
                    | undefined;
                if (!source) {
                    return 'invalid' as const;
                }
                if (source.expires_at <= now) {
                    this.deletePublicationSourceStatement.run(input.responseId);
                    return 'expired' as const;
                }
                const trace = this.retrieveTraceForPublicationStatement.get(
                    input.responseId
                ) as
                    | { metadata_json: string; stale_after: string | null }
                    | undefined;
                if (!trace) {
                    return 'invalid' as const;
                }
                const staleAfterMs = Date.parse(trace.stale_after ?? '');
                if (
                    !Number.isFinite(staleAfterMs) ||
                    staleAfterMs <= Date.parse(now)
                ) {
                    return 'expired' as const;
                }
                const currentMetadataSha256 = sha256(trace.metadata_json);
                if (
                    !hashesMatch(source.answer_sha256, sha256(input.answer)) ||
                    !hashesMatch(
                        source.publication_token_sha256,
                        sha256(input.publicationToken)
                    ) ||
                    !hashesMatch(
                        source.metadata_sha256,
                        input.expectedMetadataSha256
                    ) ||
                    !hashesMatch(source.metadata_sha256, currentMetadataSha256)
                ) {
                    return 'invalid' as const;
                }
                this.insertPublicResponseStatement.run({
                    public_id: input.publicId,
                    response_id: input.responseId,
                    projection_json: JSON.stringify(input.projection),
                    publication_token_sha256: source.publication_token_sha256,
                    published_at: input.publishedAt,
                    expires_at: input.expiresAt,
                });
                this.deletePublicationSourceStatement.run(input.responseId);
                return 'published' as const;
            });
            return publish();
        });
    }

    /** Reads a publication without exposing its internal response reference. */
    async getPublicResponse(
        publicId: string,
        now = new Date().toISOString()
    ): Promise<PublicResponseResult> {
        return this.withRetry(() => {
            this.cleanupPublicResponses(now);
            const row = this.retrievePublicResponseStatement.get(publicId) as
                | {
                      response_id: string;
                      projection_json: string | null;
                      expires_at: string;
                      state: string;
                  }
                | undefined;
            if (!row) {
                return { status: 'not_found' } as const;
            }
            if (row.state !== 'published' || row.expires_at <= now) {
                if (row.state === 'published') {
                    this.updatePublicResponseStateStatement.run({
                        public_id: publicId,
                        state: 'expired',
                    });
                    return { status: 'expired' } as const;
                }
                return {
                    status:
                        row.state === 'expired' || row.state === 'revoked'
                            ? row.state
                            : 'unavailable',
                } as const;
            }
            if (!row.projection_json) {
                this.updatePublicResponseStateStatement.run({
                    public_id: publicId,
                    state: 'unavailable',
                });
                return { status: 'unavailable' } as const;
            }
            let candidate: unknown;
            try {
                candidate = JSON.parse(row.projection_json) as unknown;
            } catch {
                candidate = null;
            }
            const parsed = GetPublicResponseResponseSchema.safeParse(candidate);
            if (!parsed.success) {
                this.updatePublicResponseStateStatement.run({
                    public_id: publicId,
                    state: 'unavailable',
                });
                return { status: 'unavailable' } as const;
            }
            return {
                status: 'published',
                responseId: row.response_id,
                projection: parsed.data,
            } as const;
        });
    }

    /** Revokes a published response only with the original backend-issued capability. */
    async revokePublicResponse(
        publicId: string,
        publicationToken: string,
        now = new Date().toISOString()
    ): Promise<'revoked' | 'invalid' | 'expired' | 'unavailable'> {
        return this.withRetry(() => {
            const revoke = this.db.transaction(() => {
                this.cleanupPublicResponses(now);
                const row = this.retrievePublicResponseStatement.get(
                    publicId
                ) as
                    | {
                          publication_token_sha256: string;
                          expires_at: string;
                          state: string;
                      }
                    | undefined;
                if (
                    !row ||
                    !hashesMatch(
                        row.publication_token_sha256,
                        sha256(publicationToken)
                    )
                ) {
                    return 'invalid' as const;
                }
                if (row.expires_at <= now || row.state === 'expired') {
                    return 'expired' as const;
                }
                if (row.state !== 'published') {
                    return 'unavailable' as const;
                }
                this.revokePublicResponseStatement.run(publicId);
                return 'revoked' as const;
            });
            return revoke();
        });
    }

    /** Invalidates the answer snapshot when its trace is missing, malformed, or stale. */
    async invalidatePublicResponse(publicId: string): Promise<void> {
        await this.withRetry(() =>
            this.updatePublicResponseStateStatement.run({
                public_id: publicId,
                state: 'unavailable',
            })
        );
    }

    private ensureTraceCardForeignKey(): void {
        type ForeignKeyRow = {
            table: string;
            from: string;
            to: string;
            on_delete: string;
        };

        const foreignKeys = this.db
            .prepare(`PRAGMA foreign_key_list(provenance_trace_cards)`)
            .all() as ForeignKeyRow[];
        const hasExpectedForeignKey = foreignKeys.some(
            (foreignKey) =>
                foreignKey.table === 'provenance_traces' &&
                foreignKey.from === 'response_id' &&
                foreignKey.to === 'response_id' &&
                foreignKey.on_delete.toUpperCase() === 'CASCADE'
        );
        if (hasExpectedForeignKey) {
            return;
        }

        const migrateTraceCardsTable = this.db.transaction(() => {
            this.db.exec(`
                CREATE TABLE provenance_trace_cards_new (
                    response_id TEXT PRIMARY KEY REFERENCES provenance_traces(response_id) ON DELETE CASCADE,
                    trace_card_svg TEXT NOT NULL
                );
            `);
            this.db.exec(`
                INSERT INTO provenance_trace_cards_new (response_id, trace_card_svg)
                SELECT cards.response_id, cards.trace_card_svg
                FROM provenance_trace_cards AS cards
                INNER JOIN provenance_traces AS traces
                    ON traces.response_id = cards.response_id;
            `);
            this.db.exec(`DROP TABLE provenance_trace_cards;`);
            this.db.exec(
                `ALTER TABLE provenance_trace_cards_new RENAME TO provenance_trace_cards;`
            );
        });

        migrateTraceCardsTable();
        traceLogger.info(
            'Migrated provenance_trace_cards to enforce ON DELETE CASCADE foreign key constraint.'
        );
    }

    private normalizeMetadata(metadata: ResponseMetadata): ResponseMetadata {
        const normalizedCitations = metadata.citations.map(
            (citation: Citation) => {
                if (!citation || typeof citation !== 'object') {
                    throw new Error(
                        `Invalid citation entry for response "${metadata.responseId}".`
                    );
                }

                let url: string;
                if (typeof citation.url === 'string') {
                    // Include response context when URL parsing fails so broken traces are easier to debug.
                    try {
                        url = new URL(citation.url).toString();
                    } catch (error) {
                        throw new Error(
                            `Cannot serialize citation URL "${citation.url}" for response "${metadata.responseId}": ${error instanceof Error ? error.message : String(error)}`,
                            { cause: error }
                        );
                    }
                } else {
                    throw new Error(
                        `Cannot serialize citation URL for response "${metadata.responseId}". Expected a string URL.`
                    );
                }

                return {
                    ...citation,
                    url,
                };
            }
        );

        return {
            ...metadata,
            citations: normalizedCitations,
        };
    }

    private isBusyError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        const code = (error as { code?: string }).code;
        return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
    }

    private async withRetry<T>(operation: () => T): Promise<T> {
        for (let attempt = 1; attempt <= BUSY_MAX_ATTEMPTS; attempt++) {
            try {
                return operation();
            } catch (error) {
                if (this.isBusyError(error) && attempt < BUSY_MAX_ATTEMPTS) {
                    await sleep(BUSY_RETRY_DELAY_MS * attempt);
                    continue;
                }
                throw error;
            }
        }

        throw new Error('Failed to execute SQLite operation after retries.');
    }

    private parseTraceMetadataJson(
        metadataJson: string,
        responseId: string
    ): ResponseMetadata | null {
        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(metadataJson) as unknown;
        } catch (error) {
            traceLogger.warn(
                `Trace record "${responseId}" failed JSON parsing; returning null fail-open.`,
                {
                    responseId,
                    reasonCode: 'trace_json_parse_error',
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return null;
        }

        const strictParsed = ResponseMetadataSchema.safeParse(parsedJson);
        if (strictParsed.success) {
            if (strictParsed.data.responseId !== responseId) {
                traceLogger.warn(
                    `Trace record "${responseId}" has mismatched responseId "${strictParsed.data.responseId}"; returning null fail-open.`
                );
                return null;
            }
            return strictParsed.data;
        }

        const repairedPayload = repairTraceMetadataForCompatibility(parsedJson);
        const repairedParsed =
            ResponseMetadataSchema.safeParse(repairedPayload);
        if (repairedParsed.success) {
            if (repairedParsed.data.responseId !== responseId) {
                traceLogger.warn(
                    `Compatibility-repaired trace "${responseId}" still has mismatched responseId "${repairedParsed.data.responseId}"; returning null fail-open.`
                );
                return null;
            }
            traceLogger.warn(
                `Trace record "${responseId}" required compatibility repair to satisfy metadata schema.`
            );
            return repairedParsed.data;
        }

        const firstIssue = repairedParsed.error.issues[0];
        const issuePath =
            firstIssue && firstIssue.path.length > 0
                ? firstIssue.path.join('.')
                : 'root';
        const issueMessage =
            firstIssue?.message ?? 'Invalid trace metadata payload.';
        traceLogger.warn(
            `Trace record "${responseId}" remains invalid after compatibility repair (${issuePath}: ${issueMessage}); returning null fail-open.`
        );
        return null;
    }

    private upsertMetadataSync(metadata: ResponseMetadata): void {
        const normalized = this.normalizeMetadata(metadata);
        const serialized = JSON.stringify(normalized, traceStoreJsonReplacer);
        const now = new Date().toISOString();

        this.upsertStatement.run({
            response_id: normalized.responseId,
            metadata_json: serialized,
            stale_after: normalized.staleAfter,
            created_at: now,
            updated_at: now,
        });
    }

    private replaceResponseCandidatesSync(
        responseId: string,
        candidates: readonly ResponseCandidate[]
    ): void {
        const normalizedCandidates = candidates.map((candidate) => {
            const parsed = ResponseCandidateSchema.parse(candidate);
            return {
                candidate_id: parsed.id,
                response_id: responseId,
                parent_candidate_id: parsed.parentCandidateId ?? null,
                workflow_step_id: parsed.workflowStepId,
                sequence_number: parsed.sequence,
                stage: parsed.stage,
                selection_state: parsed.state,
                text: parsed.text,
            };
        });
        const selectedCount = normalizedCandidates.filter(
            (candidate) => candidate.selection_state === 'selected'
        ).length;
        if (normalizedCandidates.length > 0 && selectedCount !== 1) {
            throw new Error(
                `Response candidate chain for "${responseId}" must have exactly one selected candidate.`
            );
        }

        this.deleteResponseCandidatesStatement.run(responseId);
        for (const candidate of normalizedCandidates) {
            this.insertResponseCandidateStatement.run(candidate);
        }
    }

    async upsert(
        metadata: ResponseMetadata,
        candidates?: readonly ResponseCandidate[]
    ): Promise<void> {
        await this.withRetry(() => {
            const upsertTrace = this.db.transaction(
                (
                    traceMetadata: ResponseMetadata,
                    traceCandidates: readonly ResponseCandidate[] | undefined
                ) => {
                    this.upsertMetadataSync(traceMetadata);
                    this.invalidatePublicResponsesByTraceStatement.run(
                        traceMetadata.responseId
                    );
                    if (traceCandidates !== undefined) {
                        this.replaceResponseCandidatesSync(
                            traceMetadata.responseId,
                            traceCandidates
                        );
                    }
                }
            );
            upsertTrace(metadata, candidates);
        });
        traceLogger.info(`Trace stored in SQLite: ${metadata.responseId}`);
    }

    async retrieve(responseId: string): Promise<ResponseMetadata | null> {
        const row = await this.withRetry(
            () =>
                this.retrieveStatement.get(responseId) as
                    { metadata_json: string } | undefined
        );
        if (!row) {
            return null;
        }

        return this.parseTraceMetadataJson(row.metadata_json, responseId);
    }

    /**
     * Reports whether a trace row exists, even when its metadata is not
     * currently readable. Callers use this to distinguish corruption from an
     * absent parent row without exposing invalid metadata.
     */
    async has(responseId: string): Promise<boolean> {
        const row = await this.withRetry(
            () =>
                this.traceExistsStatement.get(responseId) as
                    { present: number } | undefined
        );
        return row !== undefined;
    }

    /**
     * Reads a trace through the backend-owned display projection. Strict trace
     * writes and canonical internal reads remain unchanged.
     */
    async retrieveForDisplay(
        responseId: string
    ): Promise<TraceDisplayMetadata | null> {
        const result = await this.retrieveForDisplayWithRevision(responseId);
        return result?.metadata ?? null;
    }

    /** Reads the safe display projection and its hash from the same stored version. */
    async retrieveForDisplayWithRevision(responseId: string): Promise<{
        metadata: TraceDisplayMetadata;
        metadataSha256: string;
    } | null> {
        const row = await this.withRetry(
            () =>
                this.retrieveStatement.get(responseId) as
                    { metadata_json: string } | undefined
        );
        if (!row) {
            return null;
        }

        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(row.metadata_json) as unknown;
        } catch (error) {
            traceLogger.warn(
                `Trace record "${responseId}" failed JSON parsing for display; returning null fail-open.`,
                {
                    responseId,
                    reasonCode: 'trace_json_parse_error',
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            );
            return null;
        }

        const metadata = projectTraceMetadataForDisplay(parsedJson, responseId);
        if (!metadata) {
            return null;
        }
        return {
            metadata,
            metadataSha256: sha256(row.metadata_json),
        };
    }

    async delete(responseId: string): Promise<void> {
        await this.withRetry(() => {
            const deleteTrace = this.deleteStatement;
            const transaction = this.db.transaction((id: string) => {
                deleteTrace.run(id);
            });
            transaction(responseId);
        });
    }

    /**
     * Stores the canonical trace-card SVG for a response id.
     * Upserts so callers can refresh the card without deleting first.
     */
    async upsertTraceCardSvg(responseId: string, svg: string): Promise<void> {
        await this.withRetry(() =>
            this.upsertTraceCardStatement.run({
                response_id: responseId,
                trace_card_svg: svg,
            })
        );
    }

    /**
     * Stores a trace-card SVG while atomically ensuring its parent trace row.
     * Existing unreadable rows are preserved because existence is checked by
     * response id rather than by parsing metadata.
     */
    async upsertTraceCardSvgWithPlaceholder(
        responseId: string,
        svg: string,
        placeholder: ResponseMetadata
    ): Promise<boolean> {
        return this.withRetry(() => {
            const writeTraceCard = this.db.transaction(
                (
                    id: string,
                    traceCardSvg: string,
                    placeholderMetadata: ResponseMetadata
                ): boolean => {
                    const existingTrace = this.traceExistsStatement.get(id) as
                        { present: number } | undefined;
                    const createdPlaceholder = existingTrace === undefined;
                    if (createdPlaceholder) {
                        this.upsertMetadataSync(placeholderMetadata);
                    }
                    this.upsertTraceCardStatement.run({
                        response_id: id,
                        trace_card_svg: traceCardSvg,
                    });
                    return createdPlaceholder;
                }
            );

            return writeTraceCard(responseId, svg, placeholder);
        });
    }

    /**
     * Loads a trace-card SVG by response id.
     * Returns null when no card is stored yet.
     */
    async getTraceCardSvg(responseId: string): Promise<string | null> {
        const row = await this.withRetry(
            () =>
                this.retrieveTraceCardStatement.get(responseId) as
                    { trace_card_svg: string } | undefined
        );

        return row?.trace_card_svg ?? null;
    }

    /** Loads ordered candidate history without exposing it through normal trace reads. */
    async retrieveResponseCandidates(
        responseId: string
    ): Promise<ResponseCandidate[]> {
        const rows = await this.withRetry(
            () =>
                this.retrieveResponseCandidatesStatement.all(
                    responseId
                ) as Array<{
                    candidate_id: string;
                    parent_candidate_id: string | null;
                    workflow_step_id: string;
                    sequence_number: number;
                    stage: string;
                    selection_state: string;
                    text: string;
                }>
        );
        const candidates: ResponseCandidate[] = [];
        for (const row of rows) {
            const parsed = ResponseCandidateSchema.safeParse({
                id: row.candidate_id,
                ...(row.parent_candidate_id !== null && {
                    parentCandidateId: row.parent_candidate_id,
                }),
                workflowStepId: row.workflow_step_id,
                sequence: row.sequence_number,
                stage: row.stage,
                state: row.selection_state,
                text: row.text,
            });
            if (!parsed.success) {
                traceLogger.warn(
                    `Response candidate for trace "${responseId}" failed schema validation; returning no candidate history fail-open.`
                );
                return [];
            }
            candidates.push(parsed.data);
        }
        return candidates;
    }

    /**
     * Flushes and truncates the WAL file so shutdown leaves less recovery work
     * for Litestream snapshots and next process start.
     */
    checkpointWalTruncate(): void {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        traceLogger.info('Trace store WAL checkpoint completed (TRUNCATE).');
    }

    close(): void {
        // Close the SQLite handle so Windows can clean up temp DB files.
        clearInterval(this.publicResponseCleanupTimer);
        this.db.close();
    }
}
