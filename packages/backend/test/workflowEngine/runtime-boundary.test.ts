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
import * as ts from 'typescript';

const importsModule = (source: string, moduleName: string): boolean => {
    const sourceFile = ts.createSourceFile(
        'workflow-core-boundary.ts',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const matchesSpecifier = (specifier: string): boolean =>
        specifier
            .split('/')
            .map((segment) => segment.replace(/\.(?:[cm]?[jt]sx?)$/, ''))
            .includes(moduleName);
    let found = false;
    const visit = (node: ts.Node): void => {
        if (found) return;
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            found = matchesSpecifier(node.moduleSpecifier.text);
            return;
        }
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            found = matchesSpecifier(node.arguments[0].text);
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
};

test('runtime-boundary matcher recognizes static and dynamic imports by module name', () => {
    const source = [
        "import { policy } from '../chatOrchestrator/index.js';",
        "await import('/runtime/chatPlanner.mts');",
    ].join('\n');

    assert.equal(importsModule(source, 'chatOrchestrator'), true);
    assert.equal(importsModule(source, 'chatPlanner'), true);
    assert.equal(
        importsModule("import './chatPlannerExtra.ts';", 'chatPlanner'),
        false
    );
});

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
    assert.equal(importsModule(workflowCoreSource, 'chatOrchestrator'), false);
    assert.equal(importsModule(workflowCoreSource, 'chatPlanner'), false);
});
