/**
 * @description: Minimal direct HTTP client for OpenRouter Decisions API Jev evidence runs.
 * @footnote-scope: utility
 * @footnote-module: DirectJevAdapter
 * @footnote-risk: medium - Provider transport and response validation affect benchmark evidence.
 * @footnote-ethics: high - This adapter is observe-only and never grants action authority.
 */

export const OPENROUTER_DECISIONS_URL =
    'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';

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

export type DecisionsRequest = {
    state: JsonValue;
    model?: string;
    questions: Record<string, NoulQuestion>;
};

export type NoulAnswer = { type: 'noul'; noul: number };
export type DecisionsResponse = {
    id?: string;
    model: string;
    provider?: string;
    answers: Record<string, NoulAnswer>;
    usage: { input_tokens: number; output_tokens: number; cost?: number };
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

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type RequestOptions = {
    apiKey?: string;
    endpoint?: string;
    model?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetch?: FetchLike;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const parseResponse = (value: unknown): DecisionsResponse => {
    if (!isRecord(value) || typeof value.model !== 'string') {
        throw new JevRequestError('invalid_response', 'OpenRouter response is missing its model.');
    }
    if (!isRecord(value.answers)) {
        throw new JevRequestError('invalid_response', 'OpenRouter response is missing answers.');
    }
    const answers: Record<string, NoulAnswer> = {};
    for (const [name, answer] of Object.entries(value.answers)) {
        if (
            !isRecord(answer) ||
            answer.type !== 'noul' ||
            typeof answer.noul !== 'number' ||
            !Number.isFinite(answer.noul) ||
            answer.noul < 0 ||
            answer.noul > 1
        ) {
            throw new JevRequestError(
                'invalid_response',
                `OpenRouter answer ${name} is not a valid noul answer.`
            );
        }
        answers[name] = { type: 'noul', noul: answer.noul };
    }
    const usage = value.usage;
    if (
        !isRecord(usage) ||
        !Number.isInteger(usage.input_tokens) ||
        !Number.isInteger(usage.output_tokens) ||
        (usage.cost !== undefined &&
            (typeof usage.cost !== 'number' || !Number.isFinite(usage.cost) || usage.cost < 0))
    ) {
        throw new JevRequestError('invalid_response', 'OpenRouter response is missing valid usage.');
    }
    return {
        ...(typeof value.id === 'string' ? { id: value.id } : {}),
        model: value.model,
        ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
        answers,
        usage: {
            input_tokens: usage.input_tokens as number,
            output_tokens: usage.output_tokens as number,
            ...(typeof usage.cost === 'number' ? { cost: usage.cost } : {}),
        },
    };
};

export const decisions = async (
    input: DecisionsRequest,
    options: RequestOptions = {}
): Promise<DecisionsResponse> => {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
        throw new JevRequestError('missing_api_key', 'OPENROUTER_API_KEY is required for hosted Jev.');
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
        const response = await fetcher(options.endpoint ?? OPENROUTER_DECISIONS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ...input, model: input.model ?? options.model ?? JEV_MODEL }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new JevRequestError('http', `OpenRouter returned HTTP ${response.status}.`, response.status);
        }
        let parsed: unknown;
        try {
            parsed = await response.json();
        } catch {
            throw new JevRequestError('invalid_json', 'OpenRouter returned invalid JSON.');
        }
        const result = parseResponse(parsed);
        for (const name of Object.keys(input.questions)) {
            if (!result.answers[name]) {
                throw new JevRequestError(
                    'invalid_response',
                    `OpenRouter response is missing answer ${name}.`
                );
            }
        }
        return result;
    } catch (error) {
        if (error instanceof JevRequestError) throw error;
        if (options.signal?.aborted) {
            throw new JevRequestError('aborted', 'The Jev request was cancelled by the caller.');
        }
        if (controller.signal.aborted) {
            throw new JevRequestError('timeout', `Jev timed out after ${timeoutMs} ms.`);
        }
        throw new JevRequestError('network', 'The OpenRouter request could not connect.');
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
};

export const createReplayFetch = (response: DecisionsResponse): FetchLike =>
    async (_input, init) => {
        if (init?.signal?.aborted) {
            throw new DOMException('The request was cancelled.', 'AbortError');
        }
        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
