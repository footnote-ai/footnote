/**
 * @description: Validates prepared landing fixtures, their merged JSON files, and the runtime projections used by the web UI.
 * @footnote-scope: test
 * @footnote-module: LandingScenariosTests
 * @footnote-risk: medium - Missing coverage can allow public examples to drift from backend output shape.
 * @footnote-ethics: high - Valid fixtures keep provenance and review examples honest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostChatResponseSchema } from '@footnote/contracts/web/schemas';
import landingScenarioFixturesJson from './landingScenarioFixtures.json';
import { landingScenarios } from './landingScenarios.js';
import type { LandingScenarioFixture } from './landingScenarios.js';

const REQUIRED_METADATA_FIELDS = [
    'responseId',
    'provenance',
    'safetyTier',
    'tradeoffCount',
    'chainHash',
    'licenseContext',
    'modelVersion',
    'staleAfter',
    'citations',
    'trace_target',
    'trace_final',
    'reviewRuntime',
    'evaluator',
    'totalDurationMs',
] as const;

const ALLOWED_METADATA_FIELDS = new Set<string>([
    ...REQUIRED_METADATA_FIELDS,
    'trace_final_reason_code',
]);

const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPTURED_BACKEND_RESPONSE_ID_PATTERN = /^[A-Za-z0-9_-]{8}$/;

const canonicalLandingHash = (question: string, message: string): string =>
    crypto
        .createHash('sha256')
        .update(`landing-prepared-v1\nquestion:${question}\nmessage:${message}`)
        .digest('hex')
        .slice(0, 16);

const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);

const readJsonFile = <T>(filePath: string): T =>
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const readJsonEntries = (
    directory: string
): Array<{ fileName: string; filePath: string; value: unknown }> => {
    if (!fs.existsSync(directory)) {
        return [];
    }

    return fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => ({
            fileName: entry.name,
            filePath: path.join(directory, entry.name),
            value: readJsonFile<unknown>(path.join(directory, entry.name)),
        }))
        .sort((left, right) => left.fileName.localeCompare(right.fileName));
};

const collectSourceFiles = (directory: string): string[] => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectSourceFiles(absolutePath));
            continue;
        }

        if (/\.(ts|tsx)$/.test(entry.name)) {
            files.push(absolutePath);
        }
    }

    return files;
};

const dataDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(dataDirectory, '..');
const runtimeScenarioDir = path.join(dataDirectory, 'landingScenarios');
const landingScenarioFixturesJsonPath = path.join(
    dataDirectory,
    'landingScenarioFixtures.json'
);
const landingScenarioFixturesTsPath = path.join(
    dataDirectory,
    'landingScenarioFixtures.ts'
);
const oldNoteDir = path.join(dataDirectory, 'landingScenarioGenerationNotes');
const oldPromptFile = path.join(dataDirectory, 'examplePrompts.json');
const askMeAnythingPath = path.join(
    sourceRoot,
    'components',
    'AskMeAnything.tsx'
);

const landingScenarioFixtures =
    landingScenarioFixturesJson as readonly LandingScenarioFixture[];

const runtimeUiSourceFiles = collectSourceFiles(sourceRoot).filter(
    (filePath) =>
        !filePath.includes(`${path.sep}data${path.sep}`) &&
        !filePath.endsWith('.test.ts') &&
        !filePath.endsWith('.test.tsx')
);

test('landing scenarios contain the selected four prompts in order', () => {
    assert.equal(landingScenarios.length, 4);
    assert.deepEqual(
        landingScenarios.map((scenario) => scenario.question),
        [
            'What is Footnote?',
            'What does Footnote do differently from other AI tools?',
            'Why does showing the work matter if the answer can still be wrong?',
            'What should people be able to know about an AI answer?',
        ]
    );
});

test('landing scenario ids are unique stable kebab-case values', () => {
    const scenarioIds = landingScenarios.map((scenario) => scenario.id);
    assert.equal(new Set(scenarioIds).size, scenarioIds.length);

    for (const scenarioId of scenarioIds) {
        assert.match(scenarioId, SCENARIO_ID_PATTERN);
    }
});

test('landing scenario JSON files match the merged fixture loader', () => {
    assert.equal(fs.existsSync(landingScenarioFixturesJsonPath), true);
    assert.equal(fs.existsSync(landingScenarioFixturesTsPath), false);

    const expectedFileNames = landingScenarioFixtures.map(
        (fixture) => `${fixture.id}.json`
    );
    const jsonEntries = readJsonEntries(runtimeScenarioDir);

    assert.deepEqual(
        jsonEntries.map((entry) => entry.fileName),
        [...expectedFileNames].sort((left, right) => left.localeCompare(right))
    );

    for (const fixture of landingScenarioFixtures) {
        const filePath = path.join(runtimeScenarioDir, `${fixture.id}.json`);
        const filePayload = readJsonFile<typeof fixture>(filePath);

        assert.deepEqual(filePayload, fixture);
        assert.deepEqual(Object.keys(filePayload).sort(), [
            'capture',
            'id',
            'question',
            'response',
        ]);
        assert.equal(hasOwn(filePayload, 'traceLinkEligible'), false);
        assert.equal(hasOwn(filePayload, 'scenario'), false);
        assert.equal(hasOwn(filePayload, 'note'), false);
        assert.deepEqual(Object.keys(filePayload.response).sort(), [
            'action',
            'message',
            'metadata',
            'modality',
        ]);
        assert.equal(hasOwn(filePayload.response, 'capture'), false);
        assert.deepEqual(Object.keys(filePayload.capture).sort(), [
            'backendBaseUrl',
            'capturedChainHash',
            'capturedResponseId',
            'generatedAt',
            'workflowModeId',
        ]);
        assert.equal(hasOwn(filePayload.capture, 'commit'), false);
        assert.equal(hasOwn(filePayload.capture, 'providerModels'), false);
        assert.equal(hasOwn(filePayload.capture, 'defaultProfileId'), false);
        assert.equal(hasOwn(filePayload.capture, 'plannerProfileId'), false);

        for (const key of Object.keys(filePayload.response.metadata)) {
            assert.equal(
                ALLOWED_METADATA_FIELDS.has(key),
                true,
                `Unexpected runtime metadata field ${key} in ${fixture.id}.`
            );
        }
    }
});

test('landing scenario fixture json is the only non-test source reference', () => {
    const landingScenariosSourcePath = path.join(
        dataDirectory,
        'landingScenarios.ts'
    );
    const sourceFilesReferencingFixtureJson = collectSourceFiles(
        sourceRoot
    ).filter((filePath) => {
        if (filePath === fileURLToPath(import.meta.url)) {
            return false;
        }

        return fs
            .readFileSync(filePath, 'utf8')
            .includes('landingScenarioFixtures.json');
    });

    const sourceFilesImportingOldFixtureModule = collectSourceFiles(
        sourceRoot
    ).filter((filePath) => {
        if (filePath === fileURLToPath(import.meta.url)) {
            return false;
        }

        return fs
            .readFileSync(filePath, 'utf8')
            .includes("from './landingScenarioFixtures.js'");
    });

    assert.deepEqual(sourceFilesReferencingFixtureJson, [
        landingScenariosSourcePath,
    ]);
    assert.deepEqual(sourceFilesImportingOldFixtureModule, []);
});

test('landing scenario runtime loader strips capture data', () => {
    const expectedScenarios = landingScenarioFixtures.map(
        ({ capture: _capture, ...scenario }) => scenario
    );

    assert.deepEqual(landingScenarios, expectedScenarios);

    for (const scenario of landingScenarios) {
        assert.equal(hasOwn(scenario, 'capture'), false);
        assert.equal(scenario.response.action, 'message');
        assert.equal(scenario.response.modality, 'text');

        const parsed = PostChatResponseSchema.safeParse(scenario.response);
        assert.equal(
            parsed.success,
            true,
            parsed.success ? undefined : parsed.error.message
        );
    }
});

test('landing scenario metadata carries required prepared fields', () => {
    for (const scenario of landingScenarios) {
        const metadata = scenario.response.metadata;
        for (const field of REQUIRED_METADATA_FIELDS) {
            assert.equal(
                hasOwn(metadata, field),
                true,
                `Expected ${scenario.id} metadata to include ${field}.`
            );
        }

        assert.equal(metadata.responseId, `prepared-landing-${scenario.id}`);
        assert.equal(
            CAPTURED_BACKEND_RESPONSE_ID_PATTERN.test(metadata.responseId),
            false
        );
        assert.equal(
            metadata.chainHash,
            canonicalLandingHash(scenario.question, scenario.response.message)
        );
    }
});

test('landing scenario capture blocks are compact and aligned', () => {
    const captureIds = landingScenarioFixtures.map(
        (fixture) => fixture.capture.capturedResponseId
    );
    assert.equal(new Set(captureIds).size, captureIds.length);

    for (const fixture of landingScenarioFixtures) {
        assert.equal(fixture.capture.generatedAt.trim().length > 0, true);
        assert.equal(fixture.capture.backendBaseUrl.trim().length > 0, true);
        assert.equal(fixture.capture.workflowModeId.trim().length > 0, true);
        assert.equal(
            fixture.capture.capturedResponseId.trim().length > 0,
            true
        );
        assert.equal(fixture.capture.capturedChainHash.trim().length > 0, true);
    }
});

test('old note files are gone and no source imports the old note module', () => {
    assert.deepEqual(readJsonEntries(oldNoteDir), []);

    const importingFiles = collectSourceFiles(sourceRoot).filter((filePath) => {
        if (filePath === fileURLToPath(import.meta.url)) {
            return false;
        }
        const source = fs.readFileSync(filePath, 'utf8');
        return source.includes('landingScenarioGenerationNotes');
    });

    assert.deepEqual(importingFiles, []);
});

test('runtime ui source stays on prepared landing scenarios only', () => {
    assert.equal(fs.existsSync(oldPromptFile), false);

    const askMeAnythingSource = fs.readFileSync(askMeAnythingPath, 'utf8');
    assert.equal(askMeAnythingSource.includes('landingScenarios'), true);
    assert.equal(askMeAnythingSource.includes('examplePrompts'), false);
    assert.equal(
        askMeAnythingSource.includes('landingScenarioFixtures'),
        false
    );

    const uiFilesUsingOldPromptSource = runtimeUiSourceFiles.filter(
        (filePath) =>
            fs.readFileSync(filePath, 'utf8').includes('examplePrompts')
    );
    assert.deepEqual(uiFilesUsingOldPromptSource, []);

    const uiFilesUsingFixtureInternals = runtimeUiSourceFiles.filter(
        (filePath) =>
            fs
                .readFileSync(filePath, 'utf8')
                .includes('landingScenarioFixtures')
    );
    assert.deepEqual(uiFilesUsingFixtureInternals, []);
});
