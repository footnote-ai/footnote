/**
 * @description: Minimal direct HTTP client for TypeSafe System One / Jev evidence runs.
 * @footnote-scope: utility
 * @footnote-module: DirectJevAdapter
 * @footnote-risk: medium - Provider transport and response validation affect benchmark evidence.
 * @footnote-ethics: high - This adapter is observe-only and never grants action authority.
 */

export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
export const TYPESAFE_SYSTEM_ONE_PATH = '/v1/systemone';
export const TYPESAFE_MODELS_PATH = '/v1/models';
export const JEV_LATEST_ALIAS = 'jev-latest';

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export type NoulQuestion = {
    type: 'noul';
    instructions?: JsonValue;
    criteria?: { true?: JsonValue; false?: JsonValue } | null;
};

export type SystemOneRequest = {
    state: JsonValue;
    model?: string;
    questions: Record<string, NoulQuestion>;
};

export type NoulAnswer = { type: 'noul'; noul: number };
export type SystemOneResponse = {
    model: string;
    answers: Record<string, NoulAnswer>;
    usage: { input_tokens: number; output_tokens: number };
};

export type JevErrorKind =
    | 'missing_api_key'
    | 'aborted'
    | 'timeout'
    | 'network'
    | 'http'
    | 'invalid_json'
    | 'invalid_response';

export class JevRequestError extends Error {
    readonly kind: JevErrorKind;
    readonly status: number | undefined;

    constructor(kind: JevErrorKind, message: string, status?: number) {
        super(message);
        this.name = 'JevRequestError';
        this.kind = kind;
        this.status = status;
    }
}

type FetchLike = (
    input: string,
    init?: RequestInit
) => Promise<Response>;

type RequestOptions = {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetch?: FetchLike;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isNoulAnswer = (value: unknown): value is NoulAnswer =>
    isRecord(value) &&
    value.type === 'noul' &&
    typeof value.noul === 'number' &&
    Number.isFinite(value.noul) &&
    value.noul >= 0 &&
    value.noul <= 1;

const parseResponse = (value: unknown): SystemOneResponse => {
    if (!isRecord(value) || typeof value.model !== 'string') {
        throw new JevRequestError(
            'invalid_response',
            'TypeSafe response is missing its model.'
        );
    }
    const answers = value.answers;
    if (!isRecord(answers)) {
        throw new JevRequestError(
            'invalid_response',
            'TypeSafe response is missing answers.'
        );
    }
    const parsedAnswers: Record<string, NoulAnswer> = {};
    for (const [name, answer] of Object.entries(answers)) {
        if (!isNoulAnswer(answer)) {
            throw new JevRequestError(
                'invalid_response',
                `TypeSafe answer ${name} is not a valid noul answer.`
            );
        }
        parsedAnswers[name] = answer;
    }
    const usage = value.usage;
    if (
        !isRecord(usage) ||
        typeof usage.input_tokens !== 'number' ||
        !Number.isInteger(usage.input_tokens) ||
        typeof usage.output_tokens !== 'number' ||
        !Number.isInteger(usage.output_tokens)
    ) {
        throw new JevRequestError(
            'invalid_response',
            'TypeSafe response is missing token usage.'
        );
    }
    return {
        model: value.model,
        answers: parsedAnswers,
        usage: {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
        },
    };
};

const request = async <T>(
    path: string,
    options: RequestOptions,
    body?: unknown
): Promise<T> => {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
        throw new JevRequestError(
            'missing_api_key',
            'TYPESAFE_API_KEY is required for hosted Jev.'
        );
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') {
        throw new JevRequestError('network', 'No fetch implementation is available.');
    }
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = (): void => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    try {
        const response = await fetcher(
            `${(options.baseUrl ?? TYPESAFE_BASE_URL).replace(/\/$/, '')}${path}`,
            {
                method: path === TYPESAFE_MODELS_PATH ? 'GET' : 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'application/json',
                    ...(body === undefined
                        ? {}
                        : { 'Content-Type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: controller.signal,
            }
        );
        if (!response.ok) {
            throw new JevRequestError(
                'http',
                `TypeSafe returned HTTP ${response.status}.`,
                response.status
            );
        }
        let parsed: unknown;
        try {
            parsed = await response.json();
        } catch {
            throw new JevRequestError(
                'invalid_json',
                'TypeSafe returned invalid JSON.'
            );
        }
        return parsed as T;
    } catch (error) {
        if (error instanceof JevRequestError) {
            throw error;
        }
        if (options.signal?.aborted) {
            throw new JevRequestError('aborted', 'The Jev request was cancelled.');
        }
        if (controller.signal.aborted) {
            throw new JevRequestError('timeout', `Jev timed out after ${timeoutMs} ms.`);
        }
        throw new JevRequestError('network', 'The Jev request could not connect.');
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
};

export const systemOne = async (
    input: SystemOneRequest,
    options: RequestOptions = {}
): Promise<SystemOneResponse> =>
    parseResponse(
        await request<SystemOneResponse>(
            TYPESAFE_SYSTEM_ONE_PATH,
            options,
            { ...input, model: input.model ?? options.model ?? JEV_LATEST_ALIAS }
        )
    );

export type ModelMetadata = {
    name: string;
    description: string;
    release_date: string;
};

export const listModels = async (
    options: RequestOptions = {}
): Promise<ModelMetadata[]> => {
    const value = await request<unknown>(TYPESAFE_MODELS_PATH, options);
    if (!isRecord(value) || !Array.isArray(value.models)) {
        throw new JevRequestError('invalid_response', 'TypeSafe models response is invalid.');
    }
    return value.models.filter(
        (model): model is ModelMetadata =>
            isRecord(model) &&
            typeof model.name === 'string' &&
            typeof model.description === 'string' &&
            typeof model.release_date === 'string'
    );
};

export const createReplayFetch = (response: SystemOneResponse): FetchLike =>
    async (_input, init) => {
        if (init?.signal?.aborted) {
            throw new DOMException('The request was cancelled.', 'AbortError');
        }
        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };