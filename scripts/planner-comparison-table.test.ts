/**
 * @description: Checks that the planner comparison writer and checked-in report keep matching Markdown table widths.
 * @footnote-scope: test
 * @footnote-module: PlannerComparisonTableTests
 * @footnote-risk: low - A width regression could make the evaluation report hard to read.
 * @footnote-ethics: low - This check preserves clarity of non-sensitive evaluation evidence.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const writer = readFileSync(
    new URL('./planner-comparison.mts', import.meta.url),
    'utf8'
);
const report = readFileSync(
    new URL(
        '../docs/status/planner-strict-provenance-comparison.md',
        import.meta.url
    ),
    'utf8'
);

const cellCount = (row: string): number => row.trim().split('|').length - 2;

const quotedWriterRow = (prefix: string, quote: "'" | '`'): string => {
    const line = writer
        .split(/\r?\n/)
        .find((candidate) => candidate.trim().startsWith(`${quote}${prefix}`));
    assert.ok(line, `Expected writer row starting with ${prefix}`);
    const content = line.trim().slice(1, quote === "'" ? -2 : -1);
    return content;
};

test('planner comparison writer and report keep all table rows at 13 columns', () => {
    const writerRows = [
        quotedWriterRow('| Mode |', "'"),
        quotedWriterRow('| --- |', "'"),
        quotedWriterRow('| ${metric.mode} |', '`'),
    ];
    for (const row of writerRows) {
        assert.equal(cellCount(row), 13);
    }

    const reportRows = report
        .split(/\r?\n/)
        .filter((line) => line.startsWith('|') && line.endsWith('|'));
    const dataRows = reportRows.slice(2);
    assert.equal(reportRows.length, 11);
    assert.equal(dataRows.length, 9);
    for (const row of reportRows) {
        assert.equal(cellCount(row), 13);
    }
});
