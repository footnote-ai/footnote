/**
 * @description: Verifies bounded local Ollama admission and fail-open provider isolation.
 * @footnote-scope: test
 * @footnote-module: BoundedOllamaRuntimeTests
 * @footnote-risk: low - Test-only coverage for local generation admission behavior.
 * @footnote-ethics: medium - Correct queue outcomes help operators distinguish overload from provider failure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { Logger } from 'winston';
import {
    createBoundedOllamaGenerationRuntime,
    OllamaGenerationQueueFullError,
} from '../src/services/boundedOllamaRuntime.js';

const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
} as unknown as Logger;

const createResult = (request: GenerationRequest): GenerationResult => ({
    text: 'OK',
    model: request.model ?? 'test-model',
    provenance: 'Inferred',
    citations: [],
});

test('local Ollama generations are admitted one at a time and queued FIFO', async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const calls: string[] = [];
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            calls.push(request.model ?? 'missing');
            if (request.model === 'first') {
                await firstStarted;
            }
            active -= 1;
            return createResult(request);
        },
    };
    const bounded = createBoundedOllamaGenerationRuntime({
        runtime,
        enabled: true,
        maxConcurrentGenerations: 1,
        maxQueuedGenerations: 2,
        logger,
    });

    const first = bounded.generate({
        provider: 'ollama',
        model: 'first',
        messages: [],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = bounded.generate({
        provider: 'ollama',
        model: 'second',
        messages: [],
    });
    const third = bounded.generate({
        provider: 'ollama',
        model: 'third',
        messages: [],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(calls, ['first']);
    assert.equal(maximumActive, 1);
    releaseFirst?.();
    await Promise.all([first, second, third]);
    assert.deepEqual(calls, ['first', 'second', 'third']);
    assert.equal(maximumActive, 1);
});

test('bounded local Ollama admission rejects work beyond the queue bound', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            if (request.model === 'first') {
                await firstStarted;
            }
            return createResult(request);
        },
    };
    const bounded = createBoundedOllamaGenerationRuntime({
        runtime,
        enabled: true,
        maxConcurrentGenerations: 1,
        maxQueuedGenerations: 1,
        logger,
    });

    const first = bounded.generate({
        provider: 'ollama',
        model: 'first',
        messages: [],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const queued = bounded.generate({
        provider: 'ollama',
        model: 'queued',
        messages: [],
    });

    await assert.rejects(
        bounded.generate({
            provider: 'ollama',
            model: 'overflow',
            messages: [],
        }),
        (error: unknown) => error instanceof OllamaGenerationQueueFullError
    );

    releaseFirst?.();
    await Promise.all([first, queued]);
});

test('queued local Ollama work can be cancelled without holding a slot', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const calls: string[] = [];
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            calls.push(request.model ?? 'missing');
            if (request.model === 'first') {
                await firstStarted;
            }
            return createResult(request);
        },
    };
    const bounded = createBoundedOllamaGenerationRuntime({
        runtime,
        enabled: true,
        maxConcurrentGenerations: 1,
        maxQueuedGenerations: 1,
        logger,
    });

    const first = bounded.generate({
        provider: 'ollama',
        model: 'first',
        messages: [],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const controller = new AbortController();
    const queued = bounded.generate({
        provider: 'ollama',
        model: 'queued',
        messages: [],
        signal: controller.signal,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    controller.abort();
    await assert.rejects(
        queued,
        (error: unknown) =>
            error instanceof Error && error.name === 'AbortError'
    );
    releaseFirst?.();
    await first;

    const subsequent = await bounded.generate({
        provider: 'ollama',
        model: 'subsequent',
        messages: [],
    });

    assert.equal(subsequent.text, 'OK');
    assert.deepEqual(calls, ['first', 'subsequent']);
});

test('admitted local Ollama work releases its slot when runtime generation rejects', async () => {
    let shouldReject = true;
    const calls: string[] = [];
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            calls.push(request.model ?? 'missing');
            if (shouldReject) {
                shouldReject = false;
                throw new Error('runtime failure');
            }
            return createResult(request);
        },
    };
    const bounded = createBoundedOllamaGenerationRuntime({
        runtime,
        enabled: true,
        maxConcurrentGenerations: 1,
        maxQueuedGenerations: 0,
        logger,
    });

    await assert.rejects(
        bounded.generate({
            provider: 'ollama',
            model: 'rejecting',
            messages: [],
        }),
        /runtime failure/
    );
    const subsequent = await bounded.generate({
        provider: 'ollama',
        model: 'subsequent',
        messages: [],
    });

    assert.equal(subsequent.text, 'OK');
    assert.deepEqual(calls, ['rejecting', 'subsequent']);
});

test('remote or non-Ollama generation bypasses the local admission queue', async () => {
    let calls = 0;
    const runtime: GenerationRuntime = {
        kind: 'test-runtime',
        async generate(request) {
            calls += 1;
            return createResult(request);
        },
    };
    const bounded = createBoundedOllamaGenerationRuntime({
        runtime,
        enabled: false,
        maxConcurrentGenerations: 1,
        maxQueuedGenerations: 0,
        logger,
    });

    await Promise.all([
        bounded.generate({ provider: 'ollama', model: 'remote', messages: [] }),
        bounded.generate({ provider: 'openai', model: 'cloud', messages: [] }),
    ]);
    assert.equal(calls, 2);
});
