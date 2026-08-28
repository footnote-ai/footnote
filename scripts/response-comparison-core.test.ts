/**
 * @description: Protects the core response-comparison suite's semantic coverage without fixing its campaign size.
 * @footnote-scope: test
 * @footnote-module: ResponseComparisonCoreSuiteTests
 * @footnote-risk: medium - An incomplete suite can produce misleading comparison results.
 * @footnote-ethics: high - Core coverage protects truthful review of facts, uncertainty, sources, authority, and safety.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import {
    parseResponseComparisonCases,
    type ResponseComparisonCase,
} from './lib/response-comparison.js';

const fixturePath = path.join(
    process.cwd(),
    'packages/backend/test/fixtures/responseComparisonCore.yaml'
);

const loadCoreCases = (): ResponseComparisonCase[] => {
    const raw: unknown = yaml.load(fs.readFileSync(fixturePath, 'utf8'));
    if (
        typeof raw !== 'object' ||
        raw === null ||
        Array.isArray(raw) ||
        !('cases' in raw)
    )
        throw new Error('Core comparison fixture must contain a cases field.');
    return parseResponseComparisonCases(raw.cases);
};

test('core comparison suite is complete without fixing its size', () => {
    const cases = loadCoreCases();
    assert.ok(cases.length > 0);

    const caseIds = cases.map((item) => item.id);
    assert.equal(new Set(caseIds).size, caseIds.length);

    const coveredKinds = new Set<string>();
    for (const item of cases) {
        assert.ok(item.persona.trim().length > 0);
        assert.ok(
            ['subtle', 'balanced', 'strong'].includes(item.expressionStrength)
        );
        assert.ok(item.messages.length > 0);
        assert.ok(item.requirements.length > 0);

        const requirementIds = item.requirements.map((requirement) => {
            assert.ok(requirement.statement.trim().length > 0);
            coveredKinds.add(requirement.kind);
            return requirement.id;
        });
        assert.equal(
            new Set(requirementIds).size,
            requirementIds.length,
            `Requirement IDs must be unique for ${item.id}.`
        );
    }

    for (const kind of [
        'facts',
        'uncertainty',
        'sources',
        'authority',
        'safety',
    ])
        assert.equal(
            coveredKinds.has(kind),
            true,
            `Missing core concern: ${kind}`
        );
});
