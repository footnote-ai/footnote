/**
 * @description: Builds the public OpenAPI document from checked-in metadata and domain modules.
 * The generated bundle stays committed for existing consumers.
 * @footnote-scope: utility
 * @footnote-module: OpenApiBundle
 * @footnote-risk: medium - Incorrect merging could change the published API contract.
 * @footnote-ethics: low - This is a documentation build with no runtime authority.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';
import prettier from 'prettier';

type OpenApiObject = Record<string, unknown>;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(root, 'docs', 'api', 'openapi');
const outputPath = path.join(root, 'docs', 'api', 'openapi.yaml');
const modules = [
    'chat.yaml',
    'media.yaml',
    'tasks.yaml',
    'traces.yaml',
    'incidents.yaml',
    'accounts.yaml',
    'setup-admin.yaml',
    'shared.yaml',
];

const readObject = (filePath: string): OpenApiObject => {
    const value: unknown = yaml.load(fs.readFileSync(filePath, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(
            `${path.relative(root, filePath)} must contain a YAML mapping`
        );
    }
    return value as OpenApiObject;
};

const mergeSection = (
    target: OpenApiObject,
    source: OpenApiObject,
    section: 'paths' | 'components',
    filePath: string
): void => {
    const sourceSection = source[section];
    if (sourceSection === undefined) return;
    if (
        typeof sourceSection !== 'object' ||
        sourceSection === null ||
        Array.isArray(sourceSection)
    ) {
        throw new Error(
            `${path.relative(root, filePath)} ${section} must be a YAML mapping`
        );
    }

    const targetSection = (target[section] ??= {}) as OpenApiObject;
    for (const [key, value] of Object.entries(sourceSection)) {
        if (section === 'components') {
            if (
                typeof value !== 'object' ||
                value === null ||
                Array.isArray(value)
            ) {
                throw new Error(
                    `${path.relative(root, filePath)} components.${key} must be a YAML mapping`
                );
            }
            const componentTarget = (targetSection[key] ??=
                {}) as OpenApiObject;
            for (const [name, component] of Object.entries(value)) {
                if (Object.hasOwn(componentTarget, name)) {
                    throw new Error(
                        `Duplicate OpenAPI component ${key}.${name}`
                    );
                }
                componentTarget[name] = component;
            }
        } else {
            if (Object.hasOwn(targetSection, key)) {
                throw new Error(`Duplicate OpenAPI path ${key}`);
            }
            targetSection[key] = value;
        }
    }
};

const buildDocument = (): OpenApiObject => {
    const document = readObject(path.join(sourceDirectory, 'metadata.yaml'));
    for (const filename of modules) {
        const filePath = path.join(sourceDirectory, filename);
        const fragment = readObject(filePath);
        mergeSection(document, fragment, 'paths', filePath);
        mergeSection(document, fragment, 'components', filePath);
    }
    return document;
};

const main = async (): Promise<void> => {
    const prettierOptions = await prettier.resolveConfig(outputPath);
    const bundled = await prettier.format(
        yaml.dump(buildDocument(), {
            indent: 4,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false,
        }),
        { ...prettierOptions, filepath: outputPath }
    );

    if (process.argv.includes('--check')) {
        const current = fs.readFileSync(outputPath, 'utf8');
        if (current !== bundled) {
            console.error(
                'docs/api/openapi.yaml is stale; run pnpm openapi:bundle.'
            );
            process.exitCode = 1;
        } else {
            console.log('OpenAPI bundle is current.');
        }
    } else {
        fs.writeFileSync(outputPath, bundled);
        console.log('Updated docs/api/openapi.yaml.');
    }
};

void main();
