/**
 * @description: Redacts common credential forms and applies an explicit bound to opted-in model debug text.
 * @footnote-scope: utility
 * @footnote-module: ModelDebugCapture
 * @footnote-risk: high - A missed redaction or bound could persist secrets or unbounded model content.
 * @footnote-ethics: high - Debug bodies may contain private user context and must remain bounded and explicitly marked.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type {
    GenerationRequest,
    GenerationResult,
    GenerationRuntime,
} from '@footnote/agent-runtime';
import type { ModelDebugCaptureRecord } from '../storage/traces/sqliteTraceStore.js';
import type { ResponseCandidate } from '@footnote/contracts/web';

export const MODEL_DEBUG_BODY_MAX_CODE_UNITS = 16_384;
export const MODEL_DEBUG_MAX_INVOCATIONS_PER_RUN = 32;

export type { ModelDebugCaptureRecord };

export type BoundedDebugText = {
    text: string;
    truncated: boolean;
    redacted: boolean;
};

const SECRET_ASSIGNMENT =
    /(["']?(?:authorization|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|token|password|csrf(?:[-_]?token)?|private[-_]?key|secret)["']?\s*[:=]\s*)(["']?)(?:bearer\s+|basic\s+)?([^"'\s,}\]]+)(["']?)/giu;
const COOKIE_HEADER =
    /(["']?(?:cookie|set-cookie)["']?\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\r\n]*))/giu;
const ESCAPED_SECRET_ASSIGNMENT =
    /(\\*["'](?:authorization|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|token|password|cookie|set-cookie|csrf(?:[-_]?token)?|private[-_]?key|secret)\\*["']\s*[:=]\s*\\*["'])[\s\S]*/giu;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu;
const PRIVATE_KEY_BLOCK =
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;
const COMMON_TOKEN =
    /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;

type CaptureSession = {
    runId: string;
    records: ModelDebugCaptureRecord[];
    omittedInvocationCount: number;
    omittedIdentity?: Omit<AttemptIdentity, 'nextInvocation'> & {
        invocation: number;
    };
};

type AttemptIdentity = {
    stepId: string;
    attempt: number;
    nextInvocation: number;
};

const captureSession = new AsyncLocalStorage<CaptureSession>();
const attemptIdentity = new AsyncLocalStorage<AttemptIdentity>();

/** Opt-in is set by the backend operator, never by an API request. */
export const isModelDebugCaptureEnabled = (): boolean =>
    process.env.FOOTNOTE_DEBUG_CAPTURE_MODEL_IO === 'true';

export const withModelDebugCaptureSession = <T>(
    session: CaptureSession,
    operation: () => Promise<T>
): Promise<T> =>
    captureSession.run(session, async () => {
        try {
            return await operation();
        } finally {
            if (session.omittedInvocationCount > 0 && session.omittedIdentity) {
                session.records.push({
                    runId: session.runId,
                    ...session.omittedIdentity,
                    inputText: '',
                    inputTruncated: false,
                    inputRedacted: false,
                    captureLimitReached: true,
                    omittedInvocationCount: session.omittedInvocationCount,
                });
            }
        }
    });

export const withModelDebugAttempt = <T>(
    identity: Omit<AttemptIdentity, 'nextInvocation'>,
    operation: () => Promise<T>
): Promise<T> =>
    attemptIdentity.run({ ...identity, nextInvocation: 0 }, operation);

/** Reuses the existing response-candidate copy when it already owns an output body. */
export const reuseResponseCandidateOutputs = (
    captures: readonly ModelDebugCaptureRecord[],
    candidates: readonly ResponseCandidate[]
): ModelDebugCaptureRecord[] =>
    captures.map((capture) => {
        const candidate = candidates.find(
            (item) =>
                item.workflowStepId === capture.stepId &&
                item.text === capture.outputText?.trim()
        );
        if (candidate === undefined) {
            return { ...capture };
        }
        const withoutDuplicateOutput = { ...capture };
        delete withoutDuplicateOutput.outputText;
        return {
            ...withoutDuplicateOutput,
            outputCandidateId: candidate.id,
        };
    });

/** Captures exact runtime-boundary messages and normalized text output in memory only. */
export const createModelDebugCapturingRuntime = (
    runtime: GenerationRuntime
): GenerationRuntime => ({
    kind: runtime.kind,
    ...(runtime.resolveCapabilityFacts !== undefined && {
        resolveCapabilityFacts: runtime.resolveCapabilityFacts.bind(runtime),
    }),
    generate: async (request: GenerationRequest): Promise<GenerationResult> => {
        const session = captureSession.getStore();
        const attempt = attemptIdentity.getStore();
        if (session === undefined || attempt === undefined) {
            return runtime.generate(request);
        }

        const invocation = attempt.nextInvocation;
        attempt.nextInvocation += 1;
        if (session.records.length >= MODEL_DEBUG_MAX_INVOCATIONS_PER_RUN) {
            session.omittedInvocationCount += 1;
            session.omittedIdentity ??= {
                stepId: attempt.stepId,
                attempt: attempt.attempt,
                invocation,
            };
            return runtime.generate(request);
        }

        const input = boundAndRedactDebugText(JSON.stringify(request.messages));
        const record: ModelDebugCaptureRecord = {
            runId: session.runId,
            stepId: attempt.stepId,
            attempt: attempt.attempt,
            invocation,
            inputText: input.text,
            inputTruncated: input.truncated,
            inputRedacted: input.redacted,
        };
        session.records.push(record);

        try {
            const result = await runtime.generate(request);
            const output = boundAndRedactDebugText(result.text);
            record.outputText = output.text;
            record.outputTruncated = output.truncated;
            record.outputRedacted = output.redacted;
            return result;
        } catch (error) {
            record.outputUnavailable = true;
            throw error;
        }
    },
});

/** Redacts common named credentials and bounds text before persistence. */
export const boundAndRedactDebugText = (value: string): BoundedDebugText => {
    const redactedText = value
        .replace(PRIVATE_KEY_BLOCK, '[REDACTED_PRIVATE_KEY]')
        .replace(URL_CREDENTIALS, '$1[REDACTED]@')
        .replace(
            ESCAPED_SECRET_ASSIGNMENT,
            (_match, prefix: string) => `${prefix}[REDACTED]`
        )
        .replace(
            COOKIE_HEADER,
            (
                _match,
                prefix: string,
                doubleQuoted: string | undefined,
                singleQuoted: string | undefined
            ) =>
                `${prefix}${doubleQuoted !== undefined ? '"[REDACTED]"' : singleQuoted !== undefined ? "'[REDACTED]'" : '[REDACTED]'}`
        )
        .replace(
            SECRET_ASSIGNMENT,
            (_match, prefix: string, quote: string) =>
                `${prefix}${quote}[REDACTED]${quote}`
        )
        .replace(COMMON_TOKEN, '[REDACTED_TOKEN]')
        .replace(JWT, '[REDACTED_TOKEN]');
    const truncated = redactedText.length > MODEL_DEBUG_BODY_MAX_CODE_UNITS;

    return {
        text: truncated
            ? redactedText.slice(0, MODEL_DEBUG_BODY_MAX_CODE_UNITS)
            : redactedText,
        truncated,
        redacted: redactedText !== value,
    };
};
