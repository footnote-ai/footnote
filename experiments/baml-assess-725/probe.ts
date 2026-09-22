/**
 * @description: Exercises generated BAML parsing and request rendering against
 * the current Footnote assess failure corpus without making a provider call.
 * @footnote-scope: test
 * @footnote-module: BamlAssessProbe
 * @footnote-risk: medium - Parser observations can be misread as production compatibility.
 * @footnote-ethics: high - The probe uses synthetic outputs and never sends user content.
 */
import { b } from './baml_client/index.js';

type ProbeCase = {
    name: string;
    output: string;
};

const validFinalize = JSON.stringify({
    reviewDecision: 'finalize',
    reviewReason: 'The draft is complete.',
});

const validRevise = JSON.stringify({
    reviewDecision: 'revise',
    reviewReason: 'The citation needs tightening.',
    revisionInstruction: 'Name the source before stating the conclusion.',
});

const cases: ProbeCase[] = [
    { name: 'valid_finalize', output: validFinalize },
    { name: 'valid_revise', output: validRevise },
    { name: 'malformed_json', output: '{"reviewDecision":"finalize"' },
    {
        name: 'markdown_fenced_json',
        output: `\`\`\`json\n${validFinalize}\n\`\`\``,
    },
    { name: 'non_object_json', output: '[]' },
    {
        name: 'schema_invalid_enum',
        output: JSON.stringify({
            reviewDecision: 'maybe',
            reviewReason: 'Unknown decision.',
        }),
    },
    {
        name: 'incomplete_revise',
        output: JSON.stringify({
            reviewDecision: 'revise',
            reviewReason: 'Needs more work.',
        }),
    },
    { name: 'refusal', output: 'I cannot review this draft.' },
    {
        name: 'unexpected_extra_field',
        output: JSON.stringify({
            reviewDecision: 'finalize',
            reviewReason: 'The draft is complete.',
            unexpected: true,
        }),
    },
];

const results = cases.map((probeCase) => {
    try {
        const parsed = b.parse.Assess(probeCase.output);
        return { name: probeCase.name, status: 'parsed', parsed };
    } catch (error) {
        return {
            name: probeCase.name,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
        };
    }
});

const request = await b.request.Assess(
    'The draft answer.',
    'Check factual grounding and concise style.'
);

let cancellation = 'not_exercised';
try {
    await b.Assess('The draft answer.', 'Check cancellation.', {
        signal: AbortSignal.abort('benchmark cancellation'),
    });
} catch (error) {
    cancellation = error instanceof Error ? error.name : String(error);
}

const validFinalizeResult = results.find(
    (result) => result.name === 'valid_finalize'
);
const incompleteReviseResult = results.find(
    (result) => result.name === 'incomplete_revise'
);
if (
    validFinalizeResult?.status !== 'parsed' ||
    incompleteReviseResult?.status !== 'parsed' ||
    cancellation !== 'BamlAbortError' ||
    request.url !== 'https://api.openai.com/v1/responses'
) {
    throw new Error('BAML assess prototype observations changed unexpectedly.');
}

console.log(
    JSON.stringify(
        {
            results,
            cancellation,
            request: {
                url: request.url,
                method: request.method,
                headerNames: Object.keys(request.headers),
                body: request.body.json(),
            },
        },
        null,
        2
    )
);
