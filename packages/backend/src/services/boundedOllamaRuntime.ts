/**
 * @description: Adds a bounded, backend-owned admission queue around local Ollama generation.
 * @footnote-scope: core
 * @footnote-module: BoundedOllamaRuntime
 * @footnote-risk: high - Unbounded local generation can exhaust GPU memory and destabilize every bot process.
 * @footnote-ethics: medium - Queue and fallback outcomes must remain observable so operators can distinguish delay from model failure.
 */

import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { Logger } from 'winston';

export type BoundedOllamaRuntimeOptions = {
    runtime: GenerationRuntime;
    enabled: boolean;
    maxConcurrentGenerations: number;
    maxQueuedGenerations: number;
    logger: Logger;
};

export class OllamaGenerationQueueFullError extends Error {
    readonly retryable = true;

    readonly code = 'ollama_generation_queue_full';

    constructor(maxQueuedGenerations: number) {
        super(
            `Local Ollama generation queue is full (limit ${maxQueuedGenerations}).`
        );
        this.name = 'OllamaGenerationQueueFullError';
    }
}

type OllamaGenerationLease = {
    enqueuedAtMs: number;
    admittedAtMs: number;
    waitedMs: number;
    release: () => void;
};

const logSafely = (
    logger: Logger,
    level: 'debug' | 'info' | 'warn',
    message: string,
    metadata: Record<string, unknown>
): void => {
    try {
        logger[level](message, metadata);
    } catch {
        // Runtime logging must not change admission or release behavior.
    }
};

type QueueEntry = {
    enqueuedAtMs: number;
    model?: string;
    resolve: (lease: OllamaGenerationLease) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    removeAbortListener?: () => void;
};

class OllamaGenerationGate {
    private activeGenerations = 0;

    private readonly queue: QueueEntry[] = [];

    constructor(
        private readonly maxConcurrentGenerations: number,
        private readonly maxQueuedGenerations: number,
        private readonly logger: Logger
    ) {}

    async acquire(input: {
        model?: string;
        signal?: AbortSignal;
    }): Promise<OllamaGenerationLease> {
        if (input.signal?.aborted) {
            throw createAbortError();
        }

        if (this.activeGenerations < this.maxConcurrentGenerations) {
            return this.admit({
                enqueuedAtMs: Date.now(),
                model: input.model,
                signal: input.signal,
                resolve: () => undefined,
                reject: () => undefined,
            });
        }

        if (this.queue.length >= this.maxQueuedGenerations) {
            throw new OllamaGenerationQueueFullError(this.maxQueuedGenerations);
        }

        return new Promise<OllamaGenerationLease>((resolve, reject) => {
            const entry: QueueEntry = {
                enqueuedAtMs: Date.now(),
                model: input.model,
                resolve,
                reject,
                signal: input.signal,
            };
            const onAbort = (): void => {
                const index = this.queue.indexOf(entry);
                if (index >= 0) {
                    this.queue.splice(index, 1);
                }
                entry.removeAbortListener?.();
                reject(createAbortError());
            };
            if (input.signal) {
                input.signal.addEventListener('abort', onAbort, {
                    once: true,
                });
                entry.removeAbortListener = () =>
                    input.signal?.removeEventListener('abort', onAbort);
            }
            this.queue.push(entry);
            this.log('debug', 'ollama generation queued', {
                event: 'ollama.generation.queued',
                model: input.model,
                activeGenerations: this.activeGenerations,
                queueDepth: this.queue.length,
                maxConcurrentGenerations: this.maxConcurrentGenerations,
                maxQueuedGenerations: this.maxQueuedGenerations,
            });
        });
    }

    private admit(entry: QueueEntry): OllamaGenerationLease {
        entry.removeAbortListener?.();
        this.activeGenerations += 1;
        const admittedAtMs = Date.now();
        const waitedMs = Math.max(0, admittedAtMs - entry.enqueuedAtMs);
        let released = false;
        const release = (): void => {
            if (released) {
                return;
            }
            released = true;
            this.activeGenerations = Math.max(0, this.activeGenerations - 1);
            this.drain();
        };
        this.log('info', 'ollama generation admitted', {
            event: 'ollama.generation.admitted',
            model: entry.model,
            enqueuedAtMs: entry.enqueuedAtMs,
            admittedAtMs,
            waitedMs,
            activeGenerations: this.activeGenerations,
            queueDepth: this.queue.length,
        });
        return {
            enqueuedAtMs: entry.enqueuedAtMs,
            admittedAtMs,
            waitedMs,
            release,
        };
    }

    private log(
        level: 'debug' | 'info',
        message: string,
        metadata: Record<string, unknown>
    ): void {
        logSafely(this.logger, level, message, metadata);
    }

    private drain(): void {
        while (
            this.activeGenerations < this.maxConcurrentGenerations &&
            this.queue.length > 0
        ) {
            const entry = this.queue.shift();
            if (!entry) {
                return;
            }
            if (entry.signal?.aborted) {
                entry.removeAbortListener?.();
                entry.reject(createAbortError());
                continue;
            }
            entry.resolve(
                this.admit({
                    ...entry,
                    resolve: () => undefined,
                    reject: () => undefined,
                })
            );
        }
    }
}

const createAbortError = (): Error => {
    const error = new Error(
        'Local Ollama generation was cancelled while queued.'
    );
    error.name = 'AbortError';
    return error;
};

/**
 * Wraps one runtime without changing non-Ollama or remote-provider behavior.
 * Queue admission happens before the adapter call, so queued work does not
 * start its provider call timeout until it has a local generation slot.
 */
export const createBoundedOllamaGenerationRuntime = ({
    runtime,
    enabled,
    maxConcurrentGenerations,
    maxQueuedGenerations,
    logger,
}: BoundedOllamaRuntimeOptions): GenerationRuntime => {
    const gate = new OllamaGenerationGate(
        Math.max(1, Math.floor(maxConcurrentGenerations)),
        Math.max(0, Math.floor(maxQueuedGenerations)),
        logger
    );

    return {
        kind: runtime.kind,
        ...(runtime.resolveCapabilityFacts !== undefined && {
            resolveCapabilityFacts:
                runtime.resolveCapabilityFacts.bind(runtime),
        }),
        async generate(request: GenerationRequest): Promise<GenerationResult> {
            if (!enabled || request.provider !== 'ollama') {
                return runtime.generate(request);
            }

            let lease: OllamaGenerationLease;
            try {
                lease = await gate.acquire({
                    model: request.model,
                    signal: request.signal,
                });
            } catch (error) {
                if (
                    error instanceof OllamaGenerationQueueFullError ||
                    (error instanceof Error && error.name === 'AbortError')
                ) {
                    logSafely(
                        logger,
                        'warn',
                        'ollama generation admission failed',
                        {
                            event: 'ollama.generation.admission_failed',
                            model: request.model,
                            reason:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                            queueBounded: true,
                        }
                    );
                    throw error;
                }

                // Admission telemetry must not become a new hard dependency for
                // generation. If the gate itself fails unexpectedly, continue
                // without it and leave the adapter as the authority for output.
                logSafely(
                    logger,
                    'warn',
                    'ollama generation admission failed open',
                    {
                        event: 'ollama.generation.admission_failed_open',
                        model: request.model,
                        reason:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }
                );
                return runtime.generate(request);
            }

            const executionStartedAtMs = Date.now();
            try {
                return await runtime.generate(request);
            } finally {
                logSafely(logger, 'debug', 'ollama generation completed', {
                    event: 'ollama.generation.completed',
                    model: request.model,
                    enqueuedAtMs: lease.enqueuedAtMs,
                    admittedAtMs: lease.admittedAtMs,
                    waitMs: lease.waitedMs,
                    executionDurationMs: Math.max(
                        0,
                        Date.now() - executionStartedAtMs
                    ),
                });
                lease.release();
            }
        },
    };
};
