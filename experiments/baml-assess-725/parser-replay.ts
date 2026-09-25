/**
 * @description: Replays captured synthetic model output through both assess parsers.
 * @footnote-scope: test
 * @footnote-module: BamlAssessParserReplay
 * @footnote-risk: medium - Parser differences can be mistaken for provider evidence.
 * @footnote-ethics: low - The artifact contains synthetic fixtures only.
 */
import { readFileSync } from 'node:fs';

import { setLogLevel } from '@boundaryml/baml';

import { b } from './baml_client/index.js';
import { parseReviewDecisionOutputResult } from '../../packages/backend/src/services/workflowEngine/reviewDecision.js';

type LivePath = {
    status: string;
    rawText?: string;
};

type LiveRow = {
    fixture: string;
    current: LivePath;
};

type LiveArtifact = {
    rows: LiveRow[];
};

type ReplayRow = {
    fixture: string;
    current: { status: string; classification: string };
    baml: { status: string; classification: string };
};

const artifact = JSON.parse(
    readFileSync('artifacts/baml-assess-725/live-ollama-compare.json', 'utf8')
) as LiveArtifact;

setLogLevel('error');

const rows: ReplayRow[] = [];
for (const row of artifact.rows) {
    if (row.current.rawText === undefined) {
        continue;
    }

    const current = parseReviewDecisionOutputResult(row.current.rawText);
    const currentClassification = current.isOk()
        ? 'success'
        : current.error.reason;

    try {
        b.parse.Assess(row.current.rawText);
        rows.push({
            fixture: row.fixture,
            current: {
                status: 'success',
                classification: currentClassification,
            },
            baml: { status: 'success', classification: 'success' },
        });
    } catch (error) {
        rows.push({
            fixture: row.fixture,
            current: {
                status: 'success',
                classification: currentClassification,
            },
            baml: {
                status: 'error',
                classification:
                    error instanceof Error ? error.name : 'UnknownError',
            },
        });
    }
}

console.log(
    JSON.stringify({ benchmark: 'baml_assess_parser_replay', rows }, null, 2)
);
