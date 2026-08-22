/**
 * @description: Checks that the small project-context evaluation set remains covered by the curated manifest.
 * These are corpus-coverage gates; live answer quality still requires a provider-backed smoke run.
 * @footnote-scope: test
 * @footnote-module: ProjectContextEvaluationTests
 * @footnote-risk: medium - Losing a representative source can make project answers look healthy while missing key domains.
 * @footnote-ethics: high - Current-state questions must retain explicitly labeled current-state evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseProjectContextManifest } from '../src/services/contextIntegrations/projectContext/documentSource.js';
import type { ProjectContextCategory } from '@footnote/contracts/policy';

type EvaluationCase = {
    question: string;
    expectedPaths: string[];
    expectedCategories: ProjectContextCategory[];
};

const repoRoot = process.cwd();
const evaluationCases = JSON.parse(
    fs.readFileSync(
        path.join(
            repoRoot,
            'packages/backend/test/fixtures/projectContextEvaluation.json'
        ),
        'utf8'
    )
) as EvaluationCase[];
const manifest = parseProjectContextManifest(
    fs.readFileSync(
        path.join(repoRoot, '.footnote/context-manifest.json'),
        'utf8'
    )
);

test('representative project-context questions retain curated source coverage', () => {
    assert.equal(evaluationCases.length, 10);
    const manifestByPath = new Map(
        manifest.map((entry) => [entry.path, entry])
    );
    for (const evaluationCase of evaluationCases) {
        assert.ok(evaluationCase.question.length > 0);
        for (const expectedPath of evaluationCase.expectedPaths) {
            assert.ok(
                manifestByPath.has(expectedPath),
                `${evaluationCase.question} lost ${expectedPath}`
            );
        }
        const categories = new Set(
            evaluationCase.expectedPaths.flatMap((expectedPath) => {
                const entry = manifestByPath.get(expectedPath);
                return entry === undefined ? [] : [entry.category];
            })
        );
        for (const expectedCategory of evaluationCase.expectedCategories) {
            assert.ok(
                categories.has(expectedCategory),
                `${evaluationCase.question} lost category ${expectedCategory}`
            );
        }
    }
});
