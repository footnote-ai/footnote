/**
 * @description: Captures prepared landing scenarios from the local backend and writes the checked-in JSON fixtures.
 * @footnote-scope: utility
 * @footnote-module: LandingScenarioGenerator
 * @footnote-risk: medium - Regenerated fixtures can drift if capture or sanitization logic diverges from the backend contract.
 * @footnote-ethics: high - Prepared examples shape how the public landing flow explains provenance and review.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WorkflowModeId } from '@footnote/contracts/policy';
import { PostChatResponseSchema } from '@footnote/contracts/web/schemas';
import {
    LANDING_SCENARIO_PROMPTS,
    buildChatRequest,
    buildLandingScenarioFixture,
    formatJson,
    type LandingScenarioFixture,
} from './lib/landing-scenario-generation.js';

type CaptureResult = {
    fixture: LandingScenarioFixture;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const scenarioDir = path.join(
    rootDir,
    'packages/web/src/data/landingScenarios'
);
const fixturesJsonPath = path.join(
    rootDir,
    'packages/web/src/data/landingScenarioFixtures.json'
);

const getEnv = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : undefined;
};

const WORKFLOW_MODE_IDS = new Set<WorkflowModeId>([
    'express',
    'balanced',
    'grounded',
]);

const resolveWorkflowModeId = (value: string | undefined): WorkflowModeId => {
    const candidate = value ?? 'balanced';
    if (!WORKFLOW_MODE_IDS.has(candidate as WorkflowModeId)) {
        throw new Error(
            `Invalid FOOTNOTE_LANDING_MODE_ID value: ${candidate}. Expected express, balanced, or grounded.`
        );
    }

    return candidate as WorkflowModeId;
};

const readRequiredEnv = (name: string): string => {
    const value = getEnv(name);
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

const captureScenario = async (
    backendBaseUrl: string,
    traceApiToken: string,
    modeId: WorkflowModeId,
    prompt: (typeof LANDING_SCENARIO_PROMPTS)[number]
): Promise<CaptureResult> => {
    const request = buildChatRequest(prompt, {
        backendBaseUrl,
        modeId,
    });

    const response = await fetch(new URL('/api/chat', backendBaseUrl), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-trace-token': traceApiToken,
        },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Landing scenario capture failed for ${prompt.id}: ${response.status} ${response.statusText}${errorText.trim().length > 0 ? ` - ${errorText.trim()}` : ''}`
        );
    }

    const payload: unknown = await response.json();
    const parsed = PostChatResponseSchema.safeParse(payload);
    if (!parsed.success) {
        throw new Error(
            `Landing scenario capture failed schema validation for ${prompt.id}: ${parsed.error.message}`
        );
    }

    if (parsed.data.action !== 'message') {
        throw new Error(
            `Landing scenario capture returned unsupported action for ${prompt.id}: ${parsed.data.action}`
        );
    }

    if (parsed.data.modality !== 'text') {
        throw new Error(
            `Landing scenario capture returned unsupported modality for ${prompt.id}: ${parsed.data.modality}`
        );
    }

    const capturedAt = new Date().toISOString();
    const capturedResponseId = parsed.data.metadata.responseId;
    const capturedChainHash = parsed.data.metadata.chainHash;

    const fixture = buildLandingScenarioFixture({
        scenario: prompt,
        response: parsed.data,
        capturedResponseId,
        capturedChainHash,
        capturedAt,
        backendBaseUrl,
        workflowModeId: modeId,
    });

    return {
        fixture,
    };
};

const cleanJsonFiles = async (directory: string): Promise<void> => {
    await fs.mkdir(directory, { recursive: true });
    const entries = await fs.readdir(directory, { withFileTypes: true });

    await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => fs.unlink(path.join(directory, entry.name)))
    );
};

const writeJsonFiles = async (
    directory: string,
    files: ReadonlyArray<{ fileName: string; payload: unknown }>
): Promise<void> => {
    await fs.mkdir(directory, { recursive: true });

    await Promise.all(
        files.map((file) =>
            fs.writeFile(
                path.join(directory, file.fileName),
                formatJson(file.payload),
                'utf8'
            )
        )
    );
};

const main = async (): Promise<void> => {
    const backendBaseUrl =
        getEnv('BACKEND_BASE_URL') ?? 'http://localhost:3000';
    const traceApiToken = readRequiredEnv('TRACE_API_TOKEN');
    const modeId = resolveWorkflowModeId(getEnv('FOOTNOTE_LANDING_MODE_ID'));

    const captures: CaptureResult[] = [];

    for (const prompt of LANDING_SCENARIO_PROMPTS) {
        captures.push(
            await captureScenario(backendBaseUrl, traceApiToken, modeId, prompt)
        );
    }

    await cleanJsonFiles(scenarioDir);

    await writeJsonFiles(
        scenarioDir,
        captures.map((capture) => ({
            fileName: `${capture.fixture.id}.json`,
            payload: capture.fixture,
        }))
    );
    await fs.writeFile(
        fixturesJsonPath,
        formatJson(captures.map((capture) => capture.fixture)),
        'utf8'
    );

    console.log(
        `Generated ${captures.length} landing scenarios into ${path.relative(rootDir, scenarioDir)} and ${path.relative(rootDir, fixturesJsonPath)}.`
    );
};

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
