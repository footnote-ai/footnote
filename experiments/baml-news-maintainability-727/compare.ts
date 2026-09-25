/**
 * @description: Replays identical synthetic news outputs through Footnote and BAML parsing.
 * Provider calls are intentionally excluded so the experiment measures typed-function boundaries only.
 * @footnote-scope: test
 * @footnote-module: BamlNewsMaintainabilityComparison
 * @footnote-risk: medium - Parser differences can be mistaken for runtime parity.
 * @footnote-ethics: medium - Fixtures are synthetic and no provider or private content is contacted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { b } from './baml_client/index.js';
import type { ModelProfile } from '../../packages/contracts/src/model-profiles.js';
import { createInternalNewsTaskService } from '../../packages/backend/src/services/internalText.js';

type Fixture = {
    name: string;
    raw: string;
};

type ReplayResult = {
    name: string;
    footnote: 'success' | 'error';
    baml: 'success' | 'error';
    footnoteMessage: string | null;
    bamlMessage: string | null;
    footnoteValue: unknown;
    bamlValue: unknown;
};

const profile: ModelProfile = {
    id: 'experiment-news',
    description: 'Synthetic experiment profile.',
    provider: 'openai',
    providerModel: 'gpt-5-mini',
    enabled: true,
    tierBindings: ['text-medium'],
    capabilities: { canUseSearch: true },
};

const validNews = {
    news: [
        {
            title: 'Policy update',
            summary: 'A concise summary.',
            url: 'https://example.com/news-1',
            source: 'Example News',
            timestamp: '2026-03-18 23:48:53Z',
            thumbnail: null,
            image: null,
        },
    ],
    summary: 'One synthetic result.',
};

const fixtures: Fixture[] = [
    { name: 'valid', raw: JSON.stringify(validNews) },
    { name: 'malformed-json', raw: '{"news": [}' },
    {
        name: 'schema-invalid',
        raw: JSON.stringify({
            news: [
                {
                    title: '',
                    summary: 'Missing required title.',
                    url: 'not-a-url',
                    source: 'Example News',
                },
            ],
            summary: 'Invalid item.',
        }),
    },
    {
        name: 'optional-nulls',
        raw: JSON.stringify({
            news: [
                {
                    ...validNews.news[0],
                    timestamp: null,
                    thumbnail: null,
                    image: null,
                },
            ],
            summary: 'Optional values are null.',
        }),
    },
    {
        name: 'timestamp-normalization',
        raw: JSON.stringify({
            news: [
                {
                    ...validNews.news[0],
                    timestamp: '2026-03-18',
                },
            ],
            summary: 'Date-only timestamp.',
        }),
    },
    {
        name: 'fenced-json',
        raw: `\`\`\`json\n${JSON.stringify(validNews)}\n\`\`\``,
    },
];

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const runFootnote = async (raw: string): Promise<unknown> => {
    const service = createInternalNewsTaskService({
        generationRuntime: {
            kind: 'test-runtime',
            async generate() {
                return { text: raw, model: profile.providerModel };
            },
        },
        defaultProfile: profile,
        recordUsage: () => undefined,
    });
    return (await service.runNewsTask({ task: 'news' })).result;
};

const replay = async (fixture: Fixture): Promise<ReplayResult> => {
    let footnoteValue: unknown = null;
    let bamlValue: unknown = null;
    let footnoteMessage: string | null = null;
    let bamlMessage: string | null = null;
    let footnote: ReplayResult['footnote'] = 'success';
    let baml: ReplayResult['baml'] = 'success';

    try {
        footnoteValue = await runFootnote(fixture.raw);
    } catch (error) {
        footnote = 'error';
        footnoteMessage = errorMessage(error);
    }

    try {
        bamlValue = b.parse.GenerateNewsResponse(fixture.raw);
    } catch (error) {
        baml = 'error';
        bamlMessage = errorMessage(error);
    }

    return {
        name: fixture.name,
        footnote,
        baml,
        footnoteMessage,
        bamlMessage,
        footnoteValue,
        bamlValue,
    };
};

const main = async (): Promise<void> => {
    const results = await Promise.all(fixtures.map(replay));
    assert.deepEqual(
        results.map(({ name, footnote, baml }) => ({ name, footnote, baml })),
        [
            { name: 'valid', footnote: 'success', baml: 'success' },
            { name: 'malformed-json', footnote: 'error', baml: 'error' },
            { name: 'schema-invalid', footnote: 'error', baml: 'success' },
            { name: 'optional-nulls', footnote: 'success', baml: 'success' },
            {
                name: 'timestamp-normalization',
                footnote: 'success',
                baml: 'success',
            },
            { name: 'fenced-json', footnote: 'success', baml: 'success' },
        ]
    );

    const artifactDirectory = new URL(
        '../../artifacts/baml-news-maintainability-727/',
        import.meta.url
    );
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(
        new URL('results.json', artifactDirectory),
        `${JSON.stringify(
            {
                toolchain: { baml: '0.226.2', generatedClient: 'typescript' },
                fixtures: results,
            },
            null,
            2
        )}\n`,
        'utf8'
    );
};

await main();
