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
import { fileURLToPath } from 'node:url';
import { parseProjectContextManifest } from '../src/services/contextIntegrations/projectContext/documentSource.js';
import { createProjectContextRetriever } from '../src/services/contextIntegrations/projectContext/retriever.js';
import type { EmbeddingRuntimeResult } from '@footnote/agent-runtime';
import type { ProjectContextCategory } from '@footnote/contracts/policy';

type EvaluationCase = {
    question: string;
    expectedPaths: string[];
    expectedCategories: ProjectContextCategory[];
};

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
);
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

test('deterministic retrieval evaluation returns the expected source in top-K', async () => {
    const manifestByPath = new Map(
        manifest.map((entry) => [entry.path, entry])
    );
    const paths = manifest.map((entry) => entry.path);
    const vectorFor = (text: string): number[] => {
        const documentIndex = paths.indexOf(text.trim());
        const queryIndex = evaluationCases.findIndex(
            (evaluationCase) => evaluationCase.question === text
        );
        const selectedPath =
            documentIndex >= 0
                ? documentIndex
                : queryIndex >= 0
                  ? paths.indexOf(
                        evaluationCases[queryIndex]?.expectedPaths[0] ?? ''
                    )
                  : -1;
        return paths.map((_, index) => (index === selectedPath ? 1 : 0));
    };
    const embedTexts = async (
        texts: string[]
    ): Promise<EmbeddingRuntimeResult> => ({
        status: 'success',
        embeddings: texts.map(vectorFor),
        model: 'deterministic-eval',
        provider: 'test',
        texts,
        generationTimeMs: 0,
    });
    const retriever = createProjectContextRetriever({
        identity: {
            provider: 'test',
            model: 'deterministic-eval',
            chunkerVersion: 1,
            indexVersion: 1,
        },
        resolveDocuments: async () => ({
            revision: 'eval-sha',
            source: 'git' as const,
            documents: paths.map((filePath) => ({
                path: filePath,
                category: manifestByPath.get(filePath)?.category,
                priority: manifestByPath.get(filePath)?.priority,
                content: filePath,
            })),
        }),
        embedTexts,
        maxChunkBytes: 2000,
        maxChunks: 200,
        topKPerCategory: 2,
        maxMatches: 1,
        minScore: 0.99,
        embeddingTimeoutMs: 1000,
    });

    for (const evaluationCase of evaluationCases) {
        const outcome = await retriever.retrieve(
            evaluationCase.question,
            evaluationCase.expectedCategories
        );
        assert.equal(outcome.ok, true, evaluationCase.question);
        if (!outcome.ok) continue;
        assert.equal(
            outcome.matches[0]?.path,
            evaluationCase.expectedPaths[0],
            evaluationCase.question
        );
    }
});
