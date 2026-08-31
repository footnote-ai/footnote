/**
 * @description: Ensures the shared workflow core remains runtime-policy neutral at its module boundary.
 * @footnote-scope: test
 * @footnote-module: WorkflowCoreBoundaryTests
 * @footnote-risk: medium - Boundary drift can couple engine to orchestration layers.
 * @footnote-ethics: high - Separation supports auditable control surfaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('workflow core remains policy/runtime neutral and avoids orchestrator policy imports', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const workflowCoreSource = readFileSync(
        join(
            testDir,
            '..',
            '..',
            'src',
            'services',
            'workflowCore',
            'engine.ts'
        ),
        'utf8'
    );
    assert.equal(
        workflowCoreSource.includes("from './chatOrchestrator/"),
        false
    );
    assert.equal(workflowCoreSource.includes("from './chatPlanner"), false);
});
