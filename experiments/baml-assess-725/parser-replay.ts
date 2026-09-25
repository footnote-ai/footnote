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
    comparison: string;
    current: { status: string; classification: string; decision?: unknown };
    baml: { status: string; classification: string; decision?: unknown };
};

const omitAbsentFields = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(omitAbsentFields);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([, field]) => field !== null && field !== undefined)
            .map(([key, field]) => [key, omitAbsentFields(field)])
    );
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
    const currentDecision = current.isOk() ? current.value : undefined;

    try {
        const bamlDecision = b.parse.Assess(row.current.rawText);
        const structurallyEquivalent =
            JSON.stringify(currentDecision) === JSON.stringify(bamlDecision);
        const semanticallyEquivalent =
            JSON.stringify(omitAbsentFields(currentDecision)) ===
            JSON.stringify(omitAbsentFields(bamlDecision));
        rows.push({
            fixture: row.fixture,
            comparison: structurallyEquivalent
                ? 'structurally_equivalent'
                : semanticallyEquivalent
                  ? 'semantically_equivalent_optional_representation'
                  : 'meaningfully_different',
            current: {
                status: 'success',
                classification: currentClassification,
                decision: currentDecision,
            },
            baml: {
                status: 'success',
                classification: 'success',
                decision: bamlDecision,
            },
        });
    } catch (error) {
        rows.push({
            fixture: row.fixture,
            comparison: 'one_path_failed',
            current: {
                status: 'success',
                classification: currentClassification,
                decision: currentDecision,
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
