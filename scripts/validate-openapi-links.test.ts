/**
 * @description: Exercises OpenAPI traceability parsing at operation and component scopes.
 * @footnote-scope: test
 * @footnote-module: OpenApiLinksValidatorTests
 * @footnote-risk: low - These tests only exercise repository validation tooling.
 * @footnote-ethics: low - Fixtures contain synthetic contract metadata and no user data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    parseOpenApiDocument,
    parseOperationMap,
    validateOpenApiLinks,
    validateOperationMap,
} from './validate-openapi-links';

const completeOpenApi = `
openapi: 3.1.0
paths:
  /example:
    get:
      operationId: getExample
      x-codeRefs:
        - packages/example.ts#getExample
      responses:
        '200':
          description: ok
`;

const completeOperationMap = `
# Operation Map

| operationId | path | code refs |
| --- | --- | --- |
| \`getExample\` | \`GET /example\` | packages/example.ts#getExample |
`;

function withTempRepo<T>(
    files: Record<string, string>,
    callback: (repoRoot: string) => T
): T {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openapi-links-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(repoRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }
    try {
        return callback(repoRoot);
    } finally {
        fs.rmSync(repoRoot, { force: true, recursive: true });
    }
}

function completeFixtureFiles(): Record<string, string> {
    return {
        'docs/api/openapi.yaml': completeOpenApi,
        'docs/api/operation-map.md': completeOperationMap,
        'packages/example.ts': `/** @api.operationId: getExample @api.path: GET /example */
export function getExample(): string {
    return 'ok';
}
`,
    };
}

test('keeps component x-codeRefs out of the adjacent operation', () => {
    const parsed = parseOpenApiDocument(`
openapi: 3.0.0
paths:
  /example:
    get:
      operationId: getExample
      x-codeRefs:
        - packages/example.ts#getExample
      responses:
        '200':
          description: ok
components:
  responses:
    ExampleResponse:
      x-codeRefs:
        - packages/example.ts#ExampleResponse
      description: ok
  schemas:
    Example:
      x-codeRefs:
        - packages/example.ts#Example
      type: object
    NestedExample:
      oneOf:
        - type: object
          properties:
            settings:
              x-codeRefs:
                - packages/example.ts#NestedSettings
`);

    assert.deepEqual(parsed.operations.get('getExample')?.codeRefs, [
        'packages/example.ts#getExample',
    ]);
    assert.deepEqual(
        new Set(parsed.references.map((reference) => reference.scope)),
        new Set(['operation', 'component', 'schema'])
    );
    assert.ok(
        parsed.references.some(
            (reference) =>
                reference.scope === 'schema' &&
                reference.owner === 'components.schemas.Example'
        )
    );
    assert.ok(
        parsed.references.some(
            (reference) =>
                reference.ref === 'packages/example.ts#NestedSettings'
        )
    );
});

test('reports a missing operation-map entry', () => {
    const operations = parseOpenApiDocument(`
openapi: 3.0.0
paths:
  /example:
    get:
      operationId: getExample
      x-codeRefs:
        - packages/example.ts#getExample
      responses:
        '200':
          description: ok
`).operations;
    const map = parseOperationMap(
        '# Operation Map\n\n| operationId | path | code refs |\n| --- | --- | --- |\n'
    );
    const errors: string[] = [];

    validateOperationMap(operations, map, errors);

    assert.deepEqual(errors, [
        'operation-map.md is missing operationId "getExample" (GET /example)',
    ]);
});

test('rejects an operation-map row that points at the wrong path', () => {
    const operations = parseOpenApiDocument(`
openapi: 3.0.0
paths:
  /example:
    get:
      operationId: getExample
      x-codeRefs:
        - packages/example.ts#getExample
      responses:
        '200':
          description: ok
`).operations;
    const map = parseOperationMap(
        '# Operation Map\n\n| operationId | path | code refs |\n| --- | --- | --- |\n| `getExample` | `POST /wrong` | packages/example.ts#getExample |\n'
    );
    const errors: string[] = [];

    validateOperationMap(operations, map, errors);

    assert.deepEqual(errors, [
        'operation-map.md entry "getExample" points at POST /wrong; expected GET /example',
    ]);
});

test('rejects duplicate operation-map rows', () => {
    const operations = parseOpenApiDocument(`
openapi: 3.0.0
paths:
  /example:
    get:
      operationId: getExample
      x-codeRefs:
        - packages/example.ts#getExample
      responses:
        '200':
          description: ok
`).operations;
    const map = parseOperationMap(
        '# Operation Map\n\n| operationId | path | code refs |\n| --- | --- | --- |\n| `getExample` | `GET /example` | packages/example.ts#getExample |\n| `getExample` | `GET /example` | packages/example.ts#getExample |\n'
    );
    const errors: string[] = [];

    validateOperationMap(operations, map, errors);

    assert.deepEqual(errors, [
        'operation-map.md contains duplicate operationId "getExample" at lines 5, 6',
    ]);
});

test('rejects operation-map code-reference drift', () => {
    const operations = parseOpenApiDocument(`
openapi: 3.0.0
paths:
  /example:
    get:
      operationId: getExample
      x-codeRefs:
        - packages/example.ts#getExample
      responses:
        '200':
          description: ok
`).operations;
    const map = parseOperationMap(
        '# Operation Map\n\n| operationId | path | code refs |\n| --- | --- | --- |\n| `getExample` | `GET /example` | packages/example.ts#OldName |\n'
    );
    const errors: string[] = [];

    validateOperationMap(operations, map, errors);

    assert.deepEqual(errors, [
        'operation-map.md entry "getExample" code refs differ from OpenAPI (missing packages/example.ts#getExample; extra packages/example.ts#OldName)',
    ]);
});

test('passes a complete public validator fixture', () => {
    const errors = withTempRepo(
        completeFixtureFiles(),
        (repoRoot) => validateOpenApiLinks({ repoRoot }).errors
    );

    assert.deepEqual(errors, []);
});

test('rejects path traversal and missing-file x-codeRefs', () => {
    const files = completeFixtureFiles();
    files['docs/api/openapi.yaml'] = completeOpenApi.replace(
        '        - packages/example.ts#getExample',
        '        - ../outside.ts#outside\n        - packages/missing.ts#missing'
    );
    files['docs/api/operation-map.md'] = completeOperationMap.replace(
        'packages/example.ts#getExample',
        '../outside.ts#outside, packages/missing.ts#missing'
    );

    const errors = withTempRepo(
        files,
        (repoRoot) => validateOpenApiLinks({ repoRoot }).errors
    );

    assert.ok(errors.some((error) => error.includes('out-of-repo x-codeRef')));
    assert.ok(
        errors.some((error) => error.includes('references missing file'))
    );
});

test('rejects an annotated operation that is absent from OpenAPI', () => {
    const files = completeFixtureFiles();
    files['packages/example.ts'] = files['packages/example.ts'].replace(
        '@api.operationId: getExample',
        '@api.operationId: missingOperation'
    );

    const errors = withTempRepo(
        files,
        (repoRoot) => validateOpenApiLinks({ repoRoot }).errors
    );

    assert.ok(
        errors.some((error) =>
            error.includes(
                'Code annotations reference unknown operationId "missingOperation"'
            )
        )
    );
});

test('rejects an annotated operation with an unknown suffix', () => {
    const files = completeFixtureFiles();
    files['packages/example.ts'] = files['packages/example.ts'].replace(
        '@api.operationId: getExample',
        '@api.operationId: getExample-typo'
    );

    const errors = withTempRepo(
        files,
        (repoRoot) => validateOpenApiLinks({ repoRoot }).errors
    );

    assert.ok(
        errors.some((error) =>
            error.includes(
                'Code annotations reference unknown operationId "getExample-typo"'
            )
        )
    );
});

test('reports malformed YAML through the public validator entrypoint', () => {
    const files = completeFixtureFiles();
    files['docs/api/openapi.yaml'] = 'openapi: [\n';

    const errors = withTempRepo(
        files,
        (repoRoot) => validateOpenApiLinks({ repoRoot }).errors
    );

    assert.ok(errors.some((error) => error.includes('not valid YAML')));
});
