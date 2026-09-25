/**
 * @description: Inspects the pinned BAML request-only API without sending a model request.
 * @footnote-scope: test
 * @footnote-module: BamlAssessRequestProbe
 * @footnote-risk: medium - Provider-specific request details can be mistaken for a Footnote contract.
 * @footnote-ethics: low - The probe uses synthetic assess inputs only.
 */
import { writeFileSync } from 'node:fs';

import { setLogLevel } from '@boundaryml/baml';

import { b } from './baml_client/index.js';

setLogLevel('error');

const request = await b.request.Assess(
    'The draft is accurate.',
    'The draft is ready.',
    { client: 'LocalOllama' }
);

const artifact = {
    api: 'b.request.Assess',
    client: 'LocalOllama',
    ownKeys: Object.keys(request),
    prototypeKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(request)),
    serialized: JSON.stringify(request),
    requestString: request.toString(),
    request: {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        id: request.id,
        bodyPrototypeKeys: Object.getOwnPropertyNames(
            Object.getPrototypeOf(request.body)
        ),
        bodyOwnKeys: Object.getOwnPropertyNames(request.body),
        bodyString: String(request.body),
        bodyJson: request.body.json,
        bodyRaw: request.body.raw,
        bodyText: request.body.text,
        bodyDescriptors: Object.fromEntries(
            ['json', 'raw', 'text'].map((key) => [
                key,
                Object.getOwnPropertyDescriptor(
                    Object.getPrototypeOf(request.body),
                    key
                ),
            ])
        ),
    },
};

writeFileSync(
    'artifacts/baml-assess-725/request-probe.json',
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8'
);
