/**
 * @description: Validates bidirectional links between OpenAPI operations and code annotations to prevent spec/code drift.
 * @footnote-scope: utility
 * @footnote-module: OpenApiLinksValidator
 * @footnote-risk: medium - Broken link validation can allow stale API contracts to pass CI checks.
 * @footnote-ethics: medium - Accurate API traceability supports transparent and reliable system behavior.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

export type ReferenceScope = 'operation' | 'component' | 'schema';

export interface SpecOperation {
    method: string;
    path: string;
    line: number;
    codeRefs: string[];
}

export interface CodeReference {
    owner: string;
    ref: string;
    scope: ReferenceScope;
}

export interface AnnotationRef {
    file: string;
    line: number;
}

export interface OperationMapEntry {
    duplicateLines?: number[];
    method: string;
    path: string;
    codeRefs: string[];
    line: number;
}

export interface ParsedOpenApiDocument {
    operations: Map<string, SpecOperation>;
    references: CodeReference[];
    errors: string[];
}

export interface ValidationResult {
    annotations: Map<string, AnnotationRef[]>;
    errors: string[];
    map: Map<string, OperationMapEntry>;
    operations: Map<string, SpecOperation>;
    references: CodeReference[];
}

export interface ValidationOptions {
    openApiPath?: string;
    operationMapPath?: string;
    packagesDir?: string;
    repoRoot?: string;
}

type RecordValue = Record<string, unknown>;

const HTTP_METHODS = new Set([
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'options',
    'head',
    'trace',
]);
const API_OPERATION_TAG_PATTERN = /@api\.operationId:\s*([^\s*]+)/g;
const OPERATION_MAP_ROW_PATTERN =
    /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/u;
const IGNORED_DIRS = new Set([
    '.git',
    '.next',
    '.turbo',
    '.vercel',
    '.cache',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'tmp',
    'temp',
]);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '..');

const isRecord = (value: unknown): value is RecordValue =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const lineForOperation = (contents: string, operationId: string): number => {
    const lines = contents.split(/\r?\n/u);
    const operationPattern = new RegExp(
        `^\\s*operationId:\\s*${operationId}\\s*$`,
        'u'
    );
    const index = lines.findIndex((line) => operationPattern.test(line));
    return index >= 0 ? index + 1 : 1;
};

const readCodeRefs = (
    value: unknown,
    owner: string,
    errors: string[]
): string[] => {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        errors.push(`${owner} x-codeRefs must be a list of strings`);
        return [];
    }

    const refs: string[] = [];
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string' || item.trim().length === 0) {
            errors.push(
                `${owner} x-codeRefs[${index}] must be a non-empty string`
            );
            continue;
        }
        refs.push(item.trim());
    }
    return refs;
};

const walkCodeRefs = (
    value: unknown,
    keys: string[],
    references: CodeReference[],
    errors: string[],
    operationIds: Map<string, string>
): void => {
    if (Array.isArray(value)) {
        for (const [index, child] of value.entries()) {
            walkCodeRefs(
                child,
                [...keys, String(index)],
                references,
                errors,
                operationIds
            );
        }
        return;
    }
    if (!isRecord(value)) {
        return;
    }

    const codeRefsValue = value['x-codeRefs'];
    if (codeRefsValue !== undefined) {
        const isOperationRef =
            keys.length === 3 &&
            keys[0] === 'paths' &&
            HTTP_METHODS.has(keys[2] ?? '');
        const scope: ReferenceScope = isOperationRef
            ? 'operation'
            : keys[0] === 'components' && keys[1] === 'schemas'
              ? 'schema'
              : 'component';
        const operationId = isOperationRef
            ? operationIds.get(`${keys[1]}:${keys[2]}`)
            : undefined;
        const owner = operationId
            ? `operationId "${operationId}"`
            : keys.join('.');
        if (!isOperationRef) {
            const refs = readCodeRefs(codeRefsValue, owner, errors);
            for (const ref of refs) {
                references.push({ owner, ref, scope });
            }
        }
    }

    for (const [key, child] of Object.entries(value)) {
        if (key !== 'x-codeRefs') {
            walkCodeRefs(
                child,
                [...keys, key],
                references,
                errors,
                operationIds
            );
        }
    }
};

/** Parse OpenAPI paths and all scoped x-codeRefs from a YAML document. */
export const parseOpenApiDocument = (
    contents: string
): ParsedOpenApiDocument => {
    const operations = new Map<string, SpecOperation>();
    const references: CodeReference[] = [];
    const errors: string[] = [];
    let document: unknown;

    try {
        document = yaml.load(contents);
    } catch (error) {
        errors.push(`openapi.yaml is not valid YAML: ${String(error)}`);
        return { operations, references, errors };
    }

    if (!isRecord(document) || !isRecord(document.paths)) {
        errors.push('openapi.yaml must contain a paths object');
        return { operations, references, errors };
    }

    const operationKeys = new Map<string, string>();
    for (const [apiPath, pathItem] of Object.entries(document.paths)) {
        if (!isRecord(pathItem)) {
            errors.push(`path "${apiPath}" must be an object`);
            continue;
        }
        for (const [method, operationValue] of Object.entries(pathItem)) {
            if (!HTTP_METHODS.has(method.toLowerCase())) {
                continue;
            }
            if (!isRecord(operationValue)) {
                errors.push(
                    `${method.toUpperCase()} ${apiPath} must be an object`
                );
                continue;
            }
            const operationIdValue = operationValue.operationId;
            if (
                typeof operationIdValue !== 'string' ||
                operationIdValue.trim() === ''
            ) {
                errors.push(
                    `${method.toUpperCase()} ${apiPath} is missing operationId`
                );
                continue;
            }
            const operationId = operationIdValue.trim();
            if (operations.has(operationId)) {
                errors.push(`duplicate operationId "${operationId}"`);
                continue;
            }
            operationKeys.set(
                `${apiPath}:${method.toLowerCase()}`,
                operationId
            );
            const codeRefs = readCodeRefs(
                operationValue['x-codeRefs'],
                `operationId "${operationId}"`,
                errors
            );
            operations.set(operationId, {
                method: method.toUpperCase(),
                path: apiPath,
                line: lineForOperation(contents, operationId),
                codeRefs,
            });
        }
    }

    walkCodeRefs(document, [], references, errors, operationKeys);
    for (const [operationId, operation] of operations.entries()) {
        for (const ref of operation.codeRefs) {
            references.push({
                owner: `operationId "${operationId}"`,
                ref,
                scope: 'operation',
            });
        }
    }
    return { operations, references, errors };
};

/** Parse the clickable operation-map table without treating it as contract authority. */
export const parseOperationMap = (
    contents: string
): Map<string, OperationMapEntry> => {
    const entries = new Map<string, OperationMapEntry>();
    for (const [index, line] of contents.split(/\r?\n/u).entries()) {
        const match = line.match(OPERATION_MAP_ROW_PATTERN);
        if (!match) {
            continue;
        }
        const [, operationId, methodAndPath, codeRefs] = match;
        const splitPath = methodAndPath.trim().match(/^([A-Z]+)\s+(.+)$/u);
        if (!splitPath) {
            continue;
        }
        const entry: OperationMapEntry = {
            method: splitPath[1],
            path: splitPath[2],
            codeRefs: codeRefs
                .split(/,\s*/u)
                .map((ref) => ref.trim())
                .filter((ref) => ref.length > 0),
            line: index + 1,
        };
        const existing = entries.get(operationId);
        if (existing) {
            existing.duplicateLines = [
                ...(existing.duplicateLines ?? []),
                entry.line,
            ];
        } else {
            entries.set(operationId, entry);
        }
    }
    return entries;
};

/** Check that the derived operation map has one correctly located row per operation. */
export const validateOperationMap = (
    operations: Map<string, SpecOperation>,
    map: Map<string, OperationMapEntry>,
    errors: string[]
): void => {
    for (const [operationId, entry] of map.entries()) {
        if (entry.duplicateLines && entry.duplicateLines.length > 0) {
            errors.push(
                `operation-map.md contains duplicate operationId "${operationId}" at lines ${entry.line}, ${entry.duplicateLines.join(', ')}`
            );
        }
        const operation = operations.get(operationId);
        if (!operation) {
            errors.push(
                `operation-map.md references unknown operationId "${operationId}" at line ${entry.line}`
            );
            continue;
        }
        if (
            entry.method !== operation.method ||
            entry.path !== operation.path
        ) {
            errors.push(
                `operation-map.md entry "${operationId}" points at ${entry.method} ${entry.path}; expected ${operation.method} ${operation.path}`
            );
        }
        const expectedRefs = new Set(operation.codeRefs);
        const actualRefs = new Set(entry.codeRefs);
        const missingRefs = operation.codeRefs.filter(
            (ref) => !actualRefs.has(ref)
        );
        const extraRefs = entry.codeRefs.filter(
            (ref) => !expectedRefs.has(ref)
        );
        if (missingRefs.length > 0 || extraRefs.length > 0) {
            const details: string[] = [];
            if (missingRefs.length > 0) {
                details.push(`missing ${missingRefs.join(', ')}`);
            }
            if (extraRefs.length > 0) {
                details.push(`extra ${extraRefs.join(', ')}`);
            }
            errors.push(
                `operation-map.md entry "${operationId}" code refs differ from OpenAPI (${details.join('; ')})`
            );
        }
    }

    for (const [operationId, operation] of operations.entries()) {
        if (!map.has(operationId)) {
            errors.push(
                `operation-map.md is missing operationId "${operationId}" (${operation.method} ${operation.path})`
            );
        }
    }
};

const toRepoRelative = (repoRoot: string, absolutePath: string): string =>
    path.relative(repoRoot, absolutePath).split(path.sep).join('/');

const walk = (
    directoryPath: string,
    onFile: (filePath: string) => void
): void => {
    if (!fs.existsSync(directoryPath)) {
        return;
    }
    for (const entry of fs.readdirSync(directoryPath, {
        withFileTypes: true,
    })) {
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) {
                walk(path.join(directoryPath, entry.name), onFile);
            }
        } else if (entry.isFile()) {
            onFile(path.join(directoryPath, entry.name));
        }
    }
};

/** Collect public-boundary operation annotations from package TypeScript sources. */
export const findAnnotatedOperationIds = (
    repoRoot: string,
    packagesDir: string
): Map<string, AnnotationRef[]> => {
    const operationToRefs = new Map<string, AnnotationRef[]>();
    walk(packagesDir, (filePath) => {
        if (
            (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) ||
            filePath.endsWith('.d.ts')
        ) {
            return;
        }
        const contents = fs.readFileSync(filePath, 'utf8');
        let match = API_OPERATION_TAG_PATTERN.exec(contents);
        while (match) {
            const line = contents.slice(0, match.index).split(/\r?\n/u).length;
            const refs = operationToRefs.get(match[1]) ?? [];
            refs.push({ file: toRepoRelative(repoRoot, filePath), line });
            operationToRefs.set(match[1], refs);
            match = API_OPERATION_TAG_PATTERN.exec(contents);
        }
        API_OPERATION_TAG_PATTERN.lastIndex = 0;
    });
    return operationToRefs;
};

const validateCodeRefs = (
    references: CodeReference[],
    repoRoot: string,
    errors: string[]
): void => {
    const fileCache = new Map<string, string>();
    for (const reference of references) {
        const [refPath, symbol, ...extra] = reference.ref.split('#');
        if (!refPath || extra.length > 0) {
            errors.push(
                `${reference.owner} contains invalid x-codeRef "${reference.ref}"`
            );
            continue;
        }
        const absoluteRefPath = path.resolve(repoRoot, refPath);
        const relativeToRoot = path.relative(repoRoot, absoluteRefPath);
        if (
            relativeToRoot.startsWith('..') ||
            path.isAbsolute(relativeToRoot)
        ) {
            errors.push(
                `${reference.owner} contains out-of-repo x-codeRef "${reference.ref}"`
            );
            continue;
        }
        if (!fs.existsSync(absoluteRefPath)) {
            errors.push(
                `${reference.owner} references missing file "${refPath}"`
            );
            continue;
        }
        if (!symbol) {
            continue;
        }
        const fileContents =
            fileCache.get(absoluteRefPath) ??
            fs.readFileSync(absoluteRefPath, 'utf8');
        fileCache.set(absoluteRefPath, fileContents);
        if (!fileContents.includes(symbol)) {
            errors.push(
                `${reference.owner} references symbol "${symbol}" not found in "${refPath}"`
            );
        }
    }
};

const validateBidirectionalLinks = (
    operations: Map<string, SpecOperation>,
    annotations: Map<string, AnnotationRef[]>,
    errors: string[]
): void => {
    for (const [operationId, refs] of annotations.entries()) {
        if (!operations.has(operationId)) {
            const locations = refs
                .map((ref) => `${ref.file}:${ref.line}`)
                .join(', ');
            errors.push(
                `Code annotations reference unknown operationId "${operationId}" at ${locations}`
            );
        }
    }
    for (const [operationId, operation] of operations.entries()) {
        if (!annotations.has(operationId)) {
            errors.push(
                `openapi.yaml:${operation.line} operationId "${operationId}" (${operation.method} ${operation.path}) has no @api.operationId code annotations`
            );
        }
    }
};

/** Run the repository OpenAPI, annotation, and derived-map checks. */
export const validateOpenApiLinks = (
    options: ValidationOptions = {}
): ValidationResult => {
    const repoRoot = options.repoRoot ?? defaultRepoRoot;
    const openApiPath =
        options.openApiPath ??
        path.join(repoRoot, 'docs', 'api', 'openapi.yaml');
    const operationMapPath =
        options.operationMapPath ??
        path.join(repoRoot, 'docs', 'api', 'operation-map.md');
    const packagesDir = options.packagesDir ?? path.join(repoRoot, 'packages');
    const errors: string[] = [];
    if (!fs.existsSync(openApiPath)) {
        errors.push(
            `OpenAPI spec not found at ${toRepoRelative(repoRoot, openApiPath)}`
        );
        return {
            annotations: new Map(),
            errors,
            map: new Map(),
            operations: new Map(),
            references: [],
        };
    }

    const parsed = parseOpenApiDocument(fs.readFileSync(openApiPath, 'utf8'));
    errors.push(...parsed.errors);
    const map = fs.existsSync(operationMapPath)
        ? parseOperationMap(fs.readFileSync(operationMapPath, 'utf8'))
        : new Map<string, OperationMapEntry>();
    const annotations = findAnnotatedOperationIds(repoRoot, packagesDir);
    if (parsed.operations.size === 0) {
        errors.push('No operationIds found in docs/api/openapi.yaml');
    }
    for (const [operationId, operation] of parsed.operations.entries()) {
        if (operation.codeRefs.length === 0) {
            errors.push(
                `openapi.yaml:${operation.line} operationId "${operationId}" (${operation.method} ${operation.path}) is missing x-codeRefs entries`
            );
        }
    }
    validateCodeRefs(parsed.references, repoRoot, errors);
    validateBidirectionalLinks(parsed.operations, annotations, errors);
    validateOperationMap(parsed.operations, map, errors);
    return {
        annotations,
        errors,
        map,
        operations: parsed.operations,
        references: parsed.references,
    };
};

const main = (): void => {
    const result = validateOpenApiLinks();
    if (result.errors.length > 0) {
        console.error('OpenAPI code-link validation failed:');
        for (const message of result.errors) {
            console.error(`- ${message}`);
        }
        process.exit(1);
    }
    const operationReferences = result.references.filter(
        (reference) => reference.scope === 'operation'
    ).length;
    const scopedReferences = result.references.length - operationReferences;
    const annotationCount = Array.from(result.annotations.values()).reduce(
        (sum, refs) => sum + refs.length,
        0
    );
    console.log(
        `Validated OpenAPI links: ${result.operations.size} operations, ${operationReferences} operation x-codeRefs, ${scopedReferences} component/schema x-codeRefs, ${annotationCount} @api.operationId annotations, ${result.map.size} operation-map entries.`
    );
};

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main();
}
