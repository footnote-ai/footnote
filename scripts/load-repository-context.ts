/**
 * @description: Loads the reviewed repository context selection into a TrustGraph workspace.
 * It prints an itemized reconciliation result without exposing source contents or credentials.
 * @footnote-scope: utility
 * @footnote-module: LoadRepositoryContext
 * @footnote-risk: medium - Incorrect operator inputs can target the wrong external workspace or collection.
 * @footnote-ethics: high - External context loading changes the evidence later available to reviewers.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../packages/discord-bot/src/utils/logger';
import {
    DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID,
    DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS,
    loadRepositoryContext,
} from './lib/repository-context-loader.js';

type CommandOptions = {
    trustGraphBaseUrl: string;
    apiToken?: string;
    workspace: string;
    flowId: string;
    collection: string;
    repositoryId: string;
    requestTimeoutMs: number;
};

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
);

const getEnvironmentValue = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
};

const HELP_TEXT = `Load the reviewed repository context into TrustGraph.

Usage:
  pnpm context:repo:load -- --url <url> --flow <flow-id> [options]

Options:
  --url <url>                  TrustGraph base URL (or TRUSTGRAPH_URL)
  --workspace <workspace>      TrustGraph workspace (default: TRUSTGRAPH_WORKSPACE or default)
  --flow <flow-id>             TrustGraph processing flow (or TRUSTGRAPH_FLOW_ID)
  --collection <collection>    Target collection (default: TRUSTGRAPH_COLLECTION or footnote-repository-context)
  --repository-id <id>         Stable repository identity
  --timeout-ms <milliseconds>  Per-request timeout (default: 30000)
  --help                       Show this help

Authentication:
  Set TRUSTGRAPH_TOKEN when the Librarian endpoint requires a bearer token.
  Tokens are accepted only through the environment and are never printed.`;

const readOptionValue = (args: string[], index: number): string => {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${args[index]}.`);
    }
    return value;
};

const parsePositiveInteger = (value: string, name: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return parsed;
};

const parseCommandOptions = (args: string[]): CommandOptions | undefined => {
    if (args.includes('--help')) {
        console.log(HELP_TEXT);
        return undefined;
    }

    let trustGraphBaseUrl = getEnvironmentValue('TRUSTGRAPH_URL');
    let workspace = getEnvironmentValue('TRUSTGRAPH_WORKSPACE') ?? 'default';
    let flowId = getEnvironmentValue('TRUSTGRAPH_FLOW_ID');
    let collection =
        getEnvironmentValue('TRUSTGRAPH_COLLECTION') ??
        'footnote-repository-context';
    let repositoryId =
        getEnvironmentValue('FOOTNOTE_REPOSITORY_ID') ??
        DEFAULT_REPOSITORY_CONTEXT_REPOSITORY_ID;
    let requestTimeoutMs = DEFAULT_TRUSTGRAPH_REQUEST_TIMEOUT_MS;

    for (let index = 0; index < args.length; index += 1) {
        const option = args[index];
        if (option === '--help') {
            continue;
        }
        const value = readOptionValue(args, index);
        index += 1;
        switch (option) {
            case '--url':
                trustGraphBaseUrl = value;
                break;
            case '--workspace':
                workspace = value;
                break;
            case '--flow':
                flowId = value;
                break;
            case '--collection':
                collection = value;
                break;
            case '--repository-id':
                repositoryId = value;
                break;
            case '--timeout-ms':
                requestTimeoutMs = parsePositiveInteger(value, '--timeout-ms');
                break;
            default:
                throw new Error(`Unknown option: ${option}.`);
        }
    }

    if (trustGraphBaseUrl === undefined) {
        throw new Error(
            'TrustGraph base URL is required. Use --url or TRUSTGRAPH_URL.'
        );
    }
    if (flowId === undefined) {
        throw new Error(
            'TrustGraph flow id is required. Use --flow or TRUSTGRAPH_FLOW_ID.'
        );
    }

    return {
        trustGraphBaseUrl,
        apiToken: getEnvironmentValue('TRUSTGRAPH_TOKEN'),
        workspace,
        flowId,
        collection,
        repositoryId,
        requestTimeoutMs,
    };
};

const main = async (): Promise<void> => {
    const options = parseCommandOptions(process.argv.slice(2));
    if (options === undefined) {
        return;
    }

    logger.info('Starting repository context load.', {
        workspace: options.workspace,
        flowId: options.flowId,
        collection: options.collection,
        repositoryId: options.repositoryId,
    });
    const result = await loadRepositoryContext({
        repositoryRoot,
        ...options,
    });

    console.log('\nRepository context load\n');
    for (const item of result.items) {
        const reason = item.reason === undefined ? '' : ` — ${item.reason}`;
        console.log(`${item.status.padEnd(9)} ${item.path}${reason}`);
    }
    console.log(
        `\nAdded ${result.counts.added}; changed ${result.counts.changed}; unchanged ${result.counts.unchanged}; skipped ${result.counts.skipped}; failed ${result.counts.failed}.`
    );
    console.log(
        `${result.selectedFileCount} selected files; ${result.selectedBytes} readable bytes.`
    );

    logger.info('Completed repository context load.', {
        workspace: result.workspace,
        flowId: result.flowId,
        collection: result.collection,
        selectedFileCount: result.selectedFileCount,
        selectedBytes: result.selectedBytes,
        counts: result.counts,
    });
    if (result.counts.failed > 0) {
        process.exitCode = 1;
    }
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Repository context load failed.', { message });
    process.exitCode = 1;
});
