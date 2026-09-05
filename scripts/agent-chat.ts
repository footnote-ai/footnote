/**
 * @description: Sends a complete web- or Discord-shaped chat request through the shared backend endpoint for agent testing.
 * @footnote-scope: utility
 * @footnote-module: AgentChatClient
 * @footnote-risk: medium - A malformed testing client can produce misleading live-test results or hide endpoint failures.
 * @footnote-ethics: medium - Trusted agent access exposes generated responses and must remain an explicit, auditable caller path.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
    PostChatRequestSchema,
    PostChatResponseSchema,
    type ChatSurface,
    type ChatTriggerKind,
    type PostChatRequest,
} from '@footnote/contracts/web';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_MS = 180_000;
const CHAT_PATH = '/api/chat';
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
]);
const REPO_ENV_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '.env'
);
const CHAT_SURFACES: ReadonlySet<ChatSurface> = new Set(['web', 'discord']);
const CHAT_TRIGGER_KINDS: ReadonlySet<ChatTriggerKind> = new Set([
    'submit',
    'direct',
    'invoked',
    'alias_candidate',
    'catchup',
]);

export type AgentChatRequestOptions = {
    baseUrl: string;
    agentToken: string;
    request: PostChatRequest;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
};

export type AgentChatResult = {
    status: number;
    ok: boolean;
    durationMs: number;
    rawBody: string;
    body: unknown;
};

export const formatAgentChatStartMessage = (timeoutMs: number): string =>
    `[agent-chat] waiting for complete response; timeout=${timeoutMs}ms; retries=0`;

type AgentChatCliArguments = {
    baseUrl: string;
    requestFile?: string;
    prompt?: string;
    surface: ChatSurface;
    triggerKind: ChatTriggerKind;
    modeId?: PostChatRequest['modeId'];
    timeoutMs: number;
};

const parseJson = (rawBody: string): unknown => {
    if (rawBody.trim().length === 0) {
        return null;
    }

    try {
        return JSON.parse(rawBody) as unknown;
    } catch {
        return rawBody;
    }
};

const readRequiredEnvironment = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

const loadAgentChatEnvironment = (): void => {
    // Keep explicit process variables authoritative, while making the normal
    // `pnpm agent:chat` invocation self-contained for local and pre-production use.
    dotenv.config({ path: REPO_ENV_PATH, quiet: true });
};

export const resolveAgentChatUrl = (baseUrl: string): URL => {
    let parsedBaseUrl: URL;
    try {
        parsedBaseUrl = new URL(baseUrl);
    } catch {
        throw new Error('--base-url must be a valid URL.');
    }

    const isSecureUrl = parsedBaseUrl.protocol === 'https:';
    const isAllowedLocalUrl =
        parsedBaseUrl.protocol === 'http:' &&
        LOOPBACK_HOSTNAMES.has(parsedBaseUrl.hostname);
    if (!isSecureUrl && !isAllowedLocalUrl) {
        throw new Error(
            '--base-url must use HTTPS; HTTP is allowed only for localhost, 127.0.0.1, or ::1.'
        );
    }
    if (parsedBaseUrl.username || parsedBaseUrl.password) {
        throw new Error('--base-url must not contain URL credentials.');
    }

    return new URL(CHAT_PATH, parsedBaseUrl);
};

const readOptionValue = (
    args: ReadonlyArray<string>,
    index: number,
    option: string
): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${option}.`);
    }
    return value;
};

const parsePositiveInteger = (value: string, option: string): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${option} must be a positive safe integer.`);
    }
    return parsed;
};

const parseSurface = (value: string): ChatSurface => {
    if (!CHAT_SURFACES.has(value as ChatSurface)) {
        throw new Error(`--surface must be one of: web, discord.`);
    }
    return value as ChatSurface;
};

const parseTriggerKind = (value: string): ChatTriggerKind => {
    if (!CHAT_TRIGGER_KINDS.has(value as ChatTriggerKind)) {
        throw new Error(
            '--trigger-kind must be one of: submit, direct, invoked, alias_candidate, catchup.'
        );
    }
    return value as ChatTriggerKind;
};

const parseModeId = (value: string): NonNullable<PostChatRequest['modeId']> => {
    if (value !== 'express' && value !== 'balanced' && value !== 'grounded') {
        throw new Error(
            '--mode-id must be one of: express, balanced, grounded.'
        );
    }
    return value;
};

export const parseAgentChatArguments = (
    args: ReadonlyArray<string>
): AgentChatCliArguments => {
    let baseUrl = process.env.BACKEND_BASE_URL?.trim() || DEFAULT_BASE_URL;
    let requestFile: string | undefined;
    let prompt: string | undefined;
    let surface: ChatSurface = 'web';
    let triggerKind: ChatTriggerKind = 'submit';
    let modeId: PostChatRequest['modeId'];
    let timeoutMs = DEFAULT_TIMEOUT_MS;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        switch (argument) {
            case '--request-file':
                requestFile = readOptionValue(args, index, argument);
                index += 1;
                break;
            case '--prompt':
                prompt = readOptionValue(args, index, argument);
                index += 1;
                break;
            case '--base-url':
                baseUrl = readOptionValue(args, index, argument);
                index += 1;
                break;
            case '--surface':
                surface = parseSurface(readOptionValue(args, index, argument));
                index += 1;
                break;
            case '--trigger-kind':
                triggerKind = parseTriggerKind(
                    readOptionValue(args, index, argument)
                );
                index += 1;
                break;
            case '--mode-id':
                modeId = parseModeId(readOptionValue(args, index, argument));
                index += 1;
                break;
            case '--timeout-ms':
                timeoutMs = parsePositiveInteger(
                    readOptionValue(args, index, argument),
                    argument
                );
                index += 1;
                break;
            case '--help':
            case '-h':
                throw new Error('HELP_REQUESTED');
            default:
                throw new Error(`Unknown argument: ${argument}`);
        }
    }

    if ((requestFile && prompt) || (!requestFile && !prompt)) {
        throw new Error(
            'Provide exactly one of --request-file <path> or --prompt <text>.'
        );
    }

    return {
        baseUrl,
        requestFile,
        prompt,
        surface,
        triggerKind,
        modeId,
        timeoutMs,
    };
};

export const buildPromptRequest = ({
    prompt,
    surface,
    triggerKind,
    modeId,
}: {
    prompt: string;
    surface: ChatSurface;
    triggerKind: ChatTriggerKind;
    modeId?: PostChatRequest['modeId'];
}): PostChatRequest => ({
    surface,
    ...(modeId ? { modeId } : {}),
    trigger: { kind: triggerKind },
    latestUserInput: prompt,
    conversation: [{ role: 'user', content: prompt }],
    capabilities: {
        canReact: surface === 'discord',
        canGenerateImages: surface === 'discord',
        canUseTts: surface === 'discord',
    },
});

export const readAgentChatRequest = async (
    argumentsValue: AgentChatCliArguments
): Promise<PostChatRequest> => {
    if (argumentsValue.requestFile) {
        const requestPath = path.resolve(argumentsValue.requestFile);
        const rawRequest = JSON.parse(
            await fs.readFile(requestPath, 'utf8')
        ) as unknown;
        const parsedRequest = PostChatRequestSchema.safeParse(rawRequest);
        if (!parsedRequest.success) {
            throw new Error(
                `Request file failed PostChatRequest validation: ${parsedRequest.error.message}`
            );
        }
        return parsedRequest.data;
    }

    if (!argumentsValue.prompt) {
        throw new Error('A prompt is required when --request-file is absent.');
    }

    return buildPromptRequest({
        prompt: argumentsValue.prompt,
        surface: argumentsValue.surface,
        triggerKind: argumentsValue.triggerKind,
        modeId: argumentsValue.modeId,
    });
};

/**
 * Sends one exact PostChatRequest through the canonical /api/chat boundary and
 * waits for the complete response body. There are no implicit retries because
 * a retry could change provider availability state or produce a second charge.
 */
export const sendAgentChatRequest = async ({
    baseUrl,
    agentToken,
    request,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
}: AgentChatRequestOptions): Promise<AgentChatResult> => {
    const chatUrl = resolveAgentChatUrl(baseUrl);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    timeoutHandle.unref?.();
    const startedAt = Date.now();

    try {
        const response = await fetchImpl(chatUrl, {
            method: 'POST',
            redirect: 'error',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Agent-Token': agentToken,
                ...(request.sessionId
                    ? { 'X-Session-Id': request.sessionId }
                    : {}),
            },
            body: JSON.stringify(request),
            signal: controller.signal,
        });
        const rawBody = await response.text();
        const body = parseJson(rawBody);

        return {
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            rawBody,
            body,
        };
    } finally {
        clearTimeout(timeoutHandle);
    }
};

const printHelp = (): void => {
    console.log(`Usage:
  pnpm agent:chat -- --prompt "Hello"
  pnpm agent:chat -- --request-file request.json

The command loads AGENT_API_TOKEN and BACKEND_BASE_URL from .env.
Already-set process variables take precedence.

Options:
  --request-file <path>   Send an exact PostChatRequest JSON file.
  --prompt <text>         Build a minimal request around one prompt.
  --base-url <url>        Backend URL (defaults to BACKEND_BASE_URL or localhost).
  --surface <web|discord> Surface for prompt convenience mode.
  --trigger-kind <kind>   Trigger for prompt convenience mode.
  --mode-id <id>          Workflow mode for prompt convenience mode.
  --timeout-ms <number>   Abort timeout (default: ${DEFAULT_TIMEOUT_MS}).
`);
};

const printResponseBody = (result: AgentChatResult): void => {
    if (typeof result.body === 'string') {
        console.log(result.body);
        return;
    }

    console.log(JSON.stringify(result.body, null, 2));
};

const getResponseId = (body: unknown): string | null => {
    if (!body || typeof body !== 'object') {
        return null;
    }
    const metadata = (body as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }
    const responseId = (metadata as { responseId?: unknown }).responseId;
    return typeof responseId === 'string' && responseId.length > 0
        ? responseId
        : null;
};

export const main = async (): Promise<void> => {
    loadAgentChatEnvironment();

    let argumentsValue: AgentChatCliArguments;
    try {
        argumentsValue = parseAgentChatArguments(process.argv.slice(2));
    } catch (error) {
        if (error instanceof Error && error.message === 'HELP_REQUESTED') {
            printHelp();
            return;
        }
        throw error;
    }

    const request = await readAgentChatRequest(argumentsValue);
    console.error(formatAgentChatStartMessage(argumentsValue.timeoutMs));
    const result = await sendAgentChatRequest({
        baseUrl: argumentsValue.baseUrl,
        agentToken: readRequiredEnvironment('AGENT_API_TOKEN'),
        request,
        timeoutMs: argumentsValue.timeoutMs,
    });

    printResponseBody(result);
    console.error(
        `[agent-chat] ${result.status} ${result.ok ? 'OK' : 'FAILED'} in ${result.durationMs}ms${
            getResponseId(result.body)
                ? ` responseId=${getResponseId(result.body)}`
                : ''
        }`
    );

    if (!result.ok) {
        throw new Error(`Chat endpoint returned HTTP ${result.status}.`);
    }

    const parsedResponse = PostChatResponseSchema.safeParse(result.body);
    if (!parsedResponse.success) {
        throw new Error(
            `Chat endpoint returned an invalid PostChatResponse: ${parsedResponse.error.message}`
        );
    }
};

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1]
    ? path.resolve(process.argv[1])
    : null;

if (invokedModulePath === currentModulePath) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[agent-chat] ${message}`);
        process.exitCode = 1;
    });
}
