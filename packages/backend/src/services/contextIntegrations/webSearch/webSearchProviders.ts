/**
 * @description: Provider adapters and registry wiring for web-search context integration.
 * @footnote-scope: core
 * @footnote-module: WebSearchProviders
 * @footnote-risk: medium - Provider adapter regressions can break fallback behavior.
 * @footnote-ethics: medium - Provider output mapping affects user-visible grounding quality.
 */
import { buildSerpApiSearchUrl } from '../shared/serpApi.js';
import { normalizeUrl } from './webSearchNormalization.js';
import type {
    WebSearchProviderName,
    WebSearchProviderResult,
    WebSearchRecord,
} from './webSearchTypes.js';

const withTimeout = async <T>(
    url: string,
    init: Parameters<typeof fetch>[1],
    timeoutMs: number,
    signal: AbortSignal | undefined,
    parseResponse: (response: Response) => Promise<T>
): Promise<T> => {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutHandle = setTimeout(onAbort, timeoutMs);
    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
        });
        return await parseResponse(response);
    } finally {
        clearTimeout(timeoutHandle);
        signal?.removeEventListener('abort', onAbort);
    }
};

const runSearxng = async ({
    baseUrl: rawBaseUrl,
    query,
    timeoutMs,
    maxResults,
    signal,
}: {
    baseUrl: string;
    query: string;
    timeoutMs: number;
    maxResults: number;
    signal?: AbortSignal;
}): Promise<WebSearchProviderResult> => {
    const baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl : `${rawBaseUrl}/`;
    const endpoint = new URL('search', baseUrl);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    try {
        return await withTimeout(
            endpoint.toString(),
            { method: 'GET' },
            timeoutMs,
            signal,
            async (response): Promise<WebSearchProviderResult> => {
                if (!response.ok) {
                    return { ok: false, reasonCode: 'tool_http_error' };
                }
                const json = (await response.json()) as {
                    results?: unknown[];
                };
                const records: WebSearchRecord[] = [];
                for (const rawEntry of json.results ?? []) {
                    if (
                        typeof rawEntry !== 'object' ||
                        rawEntry === null ||
                        Array.isArray(rawEntry)
                    ) {
                        continue;
                    }
                    const entry = rawEntry as Record<string, unknown>;
                    const url = normalizeUrl(entry.url);
                    if (!url) {
                        continue;
                    }
                    records.push({
                        title:
                            typeof entry.title === 'string'
                                ? entry.title
                                : 'Source',
                        url,
                        snippet:
                            typeof entry.content === 'string'
                                ? entry.content
                                : undefined,
                        provider: 'searxng',
                        sourceDate:
                            typeof entry.publishedDate === 'string'
                                ? entry.publishedDate
                                : undefined,
                    });
                    if (records.length >= maxResults) {
                        break;
                    }
                }
                return { ok: true, records };
            }
        );
    } catch (error) {
        const reasonCode =
            error instanceof Error && error.name === 'AbortError'
                ? 'tool_timeout'
                : 'tool_network_error';
        return { ok: false, reasonCode };
    }
};

const runBrave = async ({
    apiKey,
    query,
    timeoutMs,
    maxResults,
    signal,
}: {
    apiKey: string;
    query: string;
    timeoutMs: number;
    maxResults: number;
    signal?: AbortSignal;
}): Promise<WebSearchProviderResult> => {
    const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
    endpoint.searchParams.set('q', query);
    try {
        return await withTimeout(
            endpoint.toString(),
            {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'X-Subscription-Token': apiKey,
                },
            },
            timeoutMs,
            signal,
            async (response): Promise<WebSearchProviderResult> => {
                if (!response.ok) {
                    return { ok: false, reasonCode: 'tool_http_error' };
                }
                const json = (await response.json()) as {
                    web?: { results?: Array<Record<string, unknown>> };
                };
                const records: WebSearchRecord[] = [];
                for (const entry of json.web?.results ?? []) {
                    const url = normalizeUrl(entry.url);
                    if (!url) {
                        continue;
                    }
                    records.push({
                        title:
                            typeof entry.title === 'string'
                                ? entry.title
                                : 'Source',
                        url,
                        snippet:
                            typeof entry.description === 'string'
                                ? entry.description
                                : undefined,
                        provider: 'brave',
                        sourceDate:
                            typeof entry.page_age === 'string' &&
                            entry.page_age.trim().length > 0
                                ? entry.page_age
                                : typeof entry.age === 'string'
                                  ? entry.age
                                  : undefined,
                    });
                    if (records.length >= maxResults) {
                        break;
                    }
                }
                return { ok: true, records };
            }
        );
    } catch (error) {
        const reasonCode =
            error instanceof Error && error.name === 'AbortError'
                ? 'tool_timeout'
                : 'tool_network_error';
        return { ok: false, reasonCode };
    }
};

const runSerpApi = async ({
    apiKey,
    query,
    engine,
    gl,
    hl,
    timeoutMs,
    maxResults,
    signal,
}: {
    apiKey: string;
    query: string;
    engine: string | null;
    gl: string | null;
    hl: string | null;
    timeoutMs: number;
    maxResults: number;
    signal?: AbortSignal;
}): Promise<WebSearchProviderResult> => {
    const endpoint = buildSerpApiSearchUrl({
        q: query,
        api_key: apiKey,
        engine: engine ?? 'google',
        gl,
        hl,
    });
    try {
        return await withTimeout(
            endpoint,
            { method: 'GET' },
            timeoutMs,
            signal,
            async (response): Promise<WebSearchProviderResult> => {
                if (!response.ok) {
                    return { ok: false, reasonCode: 'tool_http_error' };
                }
                const json = (await response.json()) as {
                    organic_results?: Array<Record<string, unknown>>;
                };
                const records: WebSearchRecord[] = [];
                for (const entry of json.organic_results ?? []) {
                    const url = normalizeUrl(entry.link);
                    if (!url) {
                        continue;
                    }
                    records.push({
                        title:
                            typeof entry.title === 'string'
                                ? entry.title
                                : 'Source',
                        url,
                        snippet:
                            typeof entry.snippet === 'string'
                                ? entry.snippet
                                : undefined,
                        provider: 'serpapi',
                        sourceDate:
                            typeof entry.date === 'string'
                                ? entry.date
                                : undefined,
                    });
                    if (records.length >= maxResults) {
                        break;
                    }
                }
                return { ok: true, records };
            }
        );
    } catch (error) {
        const reasonCode =
            error instanceof Error && error.name === 'AbortError'
                ? 'tool_timeout'
                : 'tool_network_error';
        return { ok: false, reasonCode };
    }
};

export type WebSearchProviderRegistryEntry = {
    isConfigured: () => boolean;
    run: (input: {
        query: string;
        timeoutMs: number;
        maxResults: number;
        signal?: AbortSignal;
    }) => Promise<WebSearchProviderResult>;
};

export const buildWebSearchProviderRegistry = (input: {
    searxngBaseUrl: string | null;
    braveApiKey: string | null;
    serpApiKey: string | null;
    serpApiEngine: string | null;
    serpApiGl: string | null;
    serpApiHl: string | null;
}): Record<WebSearchProviderName, WebSearchProviderRegistryEntry> => ({
    searxng: {
        isConfigured: () => Boolean(input.searxngBaseUrl),
        run: async ({ query, timeoutMs, maxResults, signal }) =>
            runSearxng({
                baseUrl: input.searxngBaseUrl as string,
                query,
                timeoutMs,
                maxResults,
                signal,
            }),
    },
    brave: {
        isConfigured: () => Boolean(input.braveApiKey),
        run: async ({ query, timeoutMs, maxResults, signal }) =>
            runBrave({
                apiKey: input.braveApiKey as string,
                query,
                timeoutMs,
                maxResults,
                signal,
            }),
    },
    serpapi: {
        isConfigured: () => Boolean(input.serpApiKey),
        run: async ({ query, timeoutMs, maxResults, signal }) =>
            runSerpApi({
                apiKey: input.serpApiKey as string,
                query,
                engine: input.serpApiEngine,
                gl: input.serpApiGl,
                hl: input.serpApiHl,
                timeoutMs,
                maxResults,
                signal,
            }),
    },
});
