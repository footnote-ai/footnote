/**
 * @description: Replays one frozen hybrid selector through the existing chat seam.
 * @footnote-scope: test
 * @footnote-module: ContextSelectionHybridReplay
 * @footnote-risk: medium - Live replay can spend provider budget and generation variance can blur selector comparisons.
 * @footnote-ethics: high - Only synthetic frozen selector outputs are sent to the configured backend.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import {
    buildBenchmarkCorpus,
    type SelectionResult,
} from './context-selection-benchmark.js';
import {
    replayContextSelection,
    serializeReplayRecords,
} from './context-selection-chat-replay.js';
import type { ContextReplayRecord } from './context-selection-chat-replay.js';

type FrozenHybridRecord = {
    caseId: string;
    method: string;
    selection: SelectionResult;
};

const readJsonLines = (filePath: string): FrozenHybridRecord[] =>
    fs
        .readFileSync(filePath, 'utf8')
        .split(/\r?\n/gu)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as FrozenHybridRecord);

const readArguments = (args: readonly string[]) => {
    const root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..'
    );
    const value = (name: string, fallback: string): string => {
        const index = args.indexOf(name);
        return index < 0 ? fallback : (args[index + 1] ?? fallback);
    };
    return {
        selectionFile: path.resolve(
            value(
                '--selection-file',
                path.join(
                    root,
                    '.footnote-dev/context-selection-717-replay/hybrid-ablation-20260924/case-results.jsonl'
                )
            )
        ),
        caseFile: path.resolve(
            value(
                '--case-file',
                path.join(
                    root,
                    '.footnote-dev/context-selection-717-replay/category-balanced-20260924/replay.jsonl'
                )
            )
        ),
        outputDirectory: path.resolve(
            value(
                '--output-dir',
                path.join(
                    root,
                    '.footnote-dev/context-selection-717-replay/hybrid-replay-20260924'
                )
            )
        ),
        baseUrl: process.env.BACKEND_BASE_URL ?? 'http://localhost:3000',
    };
};

const main = async (): Promise<void> => {
    dotenv.config();
    const args = readArguments(process.argv.slice(2));
    const agentToken = process.env.AGENT_API_TOKEN;
    if (agentToken === undefined || agentToken.length === 0) {
        throw new Error('AGENT_API_TOKEN is required for live replay.');
    }
    const corpus = new Map(
        buildBenchmarkCorpus().map((entry) => [entry.id, entry])
    );
    const caseIds = [
        ...new Set(
            fs
                .readFileSync(args.caseFile, 'utf8')
                .split(/\r?\n/gu)
                .filter((line) => line.trim().length > 0)
                .map((line) => (JSON.parse(line) as { caseId: string }).caseId)
        ),
    ];
    const frozen = new Map(
        readJsonLines(args.selectionFile)
            .filter((record) => record.method === 'semantic_plus_bm25_top3')
            .map((record) => [record.caseId, record])
    );
    const records: ContextReplayRecord[] = [];
    for (const caseId of caseIds) {
        const entry = corpus.get(caseId);
        const frozenRecord = frozen.get(caseId);
        if (entry === undefined || frozenRecord === undefined) continue;
        const record = await replayContextSelection({
            entry,
            selection: frozenRecord.selection,
            baseUrl: args.baseUrl,
            agentToken,
        });
        records.push(record);
        console.log(
            `${caseId} ${record.chat.status} ${record.chat.action ?? 'n/a'} ${record.chat.durationMs ?? 'n/a'}ms`
        );
    }
    fs.mkdirSync(args.outputDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(args.outputDirectory, 'replay.jsonl'),
        serializeReplayRecords(records),
        'utf8'
    );
    console.log(
        JSON.stringify(
            { outputDirectory: args.outputDirectory, records: records.length },
            null,
            2
        )
    );
};

if (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error: unknown) => {
        console.error(
            `[context-selection-hybrid-replay] ${error instanceof Error ? error.message : String(error)}`
        );
        process.exitCode = 1;
    });
}
