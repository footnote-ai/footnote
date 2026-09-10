/**
 * @description: Exercises OpenAPI traceability parsing at operation and component scopes.
 * @footnote-scope: test
 * @footnote-module: OpenApiLinksValidatorTests
 * @footnote-risk: low - These tests only exercise repository validation tooling.
 * @footnote-ethics: low - Fixtures contain synthetic contract metadata and no user data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseOpenApiDocument,
    parseOperationMap,
    validateOperationMap,
} from './validate-openapi-links';

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
