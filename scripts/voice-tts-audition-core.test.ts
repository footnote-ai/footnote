/**
 * @description: Verifies the fixed synthetic audition plan and safe PCM conversion without provider calls.
 * @footnote-scope: test
 * @footnote-module: VoiceTtsAuditionCoreTests
 * @footnote-risk: medium - These checks protect the fixed request cap and PCM interpretation.
 * @footnote-ethics: high - Tests use fixture text only and never call a provider.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';
import {
    AUDITION_CANDIDATES,
    createAuditionMatrix,
    generationLookupTargets,
    generationMetadataFromResponse,
    isModelAvailabilityFailure,
    MAX_AUDITION_REQUESTS,
    parseAuditionArguments,
    pcm16MonoToWav,
    randomizedOrder,
    readBoundedJsonResponse,
    type AuditionCase,
} from './voice-tts-audition-core.js';

const fixture = JSON.parse(
    readFileSync(
        resolve(
            process.cwd(),
            'packages/backend/test/fixtures/voiceCondensationEvaluation.json'
        ),
        'utf8'
    )
) as { cases: AuditionCase[] };

test('audition matrix uses exact fixture text, temporary voices, supported instructions, and a fixed count', () => {
    const matrix = createAuditionMatrix(fixture.cases);

    assert.equal(matrix.length, MAX_AUDITION_REQUESTS);
    assert.equal(AUDITION_CANDIDATES.length, 4);
    for (const candidate of AUDITION_CANDIDATES) {
        const modelRequests = matrix.filter(
            (item) => item.model === candidate.model
        );
        assert.equal(modelRequests.length, 10);
        assert.equal(
            modelRequests.filter((item) => item.sampleKind === 'repeat').length,
            2
        );
        for (const request of modelRequests) {
            const source = fixture.cases.find(
                (item) => item.id === request.fixtureId
            );
            assert.ok(source);
            assert.equal(request.text, source.originalAnswer);
            assert.equal(request.voice, candidate.voices[request.persona]);
            assert.equal(
                Boolean(request.instructions),
                candidate.supportsInstructions
            );
        }
    }
});

test('PCM conversion writes a standard WAV header from the declared 24 kHz mono s16le contract', () => {
    const pcm = Buffer.from([1, 0, 2, 0]);
    const wav = pcm16MonoToWav(pcm, {
        sampleRateHz: 24_000,
        channels: 1,
        bitsPerSample: 16,
        encoding: 'signed-integer-little-endian',
    });

    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.toString('hex', 44), '01000200');
    assert.throws(
        () =>
            pcm16MonoToWav(pcm, {
                sampleRateHz: 24_000,
                channels: 2,
                bitsPerSample: 16,
                encoding: 'signed-integer-little-endian',
            }),
        /verified PCM contract/
    );
    assert.throws(
        () =>
            pcm16MonoToWav(Buffer.from([1]), {
                sampleRateHz: 24_000,
                channels: 1,
                bitsPerSample: 16,
                encoding: 'signed-integer-little-endian',
            }),
        /verified PCM contract/
    );
});

test('listening order is randomized without dropping or duplicating samples', () => {
    const samples = ['a', 'b', 'c', 'd'];
    const order = randomizedOrder(samples);

    assert.deepEqual([...order].sort(), samples);
    assert.deepEqual(samples, ['a', 'b', 'c', 'd']);
});

test('paid execution requires explicit authorization, a $1 key cap, and ZDR-only settings', () => {
    assert.deepEqual(parseAuditionArguments([]), {
        execute: false,
        confirmSpendLimit: false,
        confirmZdrOnly: false,
    });
    assert.throws(
        () => parseAuditionArguments(['--execute']),
        /Execution requires/
    );
    assert.throws(
        () => parseAuditionArguments(['--confirm-openrouter-key-limit-usd=1']),
        /only valid with --execute/
    );
    assert.throws(
        () =>
            parseAuditionArguments([
                '--execute',
                '--confirm-openrouter-key-limit-usd=1',
            ]),
        /confirm-openrouter-zdr-only/
    );
    assert.deepEqual(
        parseAuditionArguments([
            '--execute',
            '--confirm-openrouter-key-limit-usd=1',
            '--confirm-openrouter-zdr-only',
        ]),
        { execute: true, confirmSpendLimit: true, confirmZdrOnly: true }
    );
});

test('only confirmed model-specific 404 routing failures are skippable', () => {
    assert.equal(
        isModelAvailabilityFailure(404, 'No endpoints found for model'),
        true
    );
    assert.equal(isModelAvailabilityFailure(404, 'Not found'), false);
    assert.equal(
        isModelAvailabilityFailure(429, 'No endpoints found for model'),
        false
    );
    assert.equal(
        isModelAvailabilityFailure(401, 'No endpoints found for model'),
        false
    );
});

test('generation metadata targets are bounded and keep missing IDs unavailable', () => {
    assert.deepEqual(
        generationLookupTargets({
            samples: [
                { sampleId: 'sample0001', generationId: 'gen-abc-123' },
                { sampleId: 'sample0002' },
            ],
        }),
        [
            { sampleId: 'sample0001', generationId: 'gen-abc-123' },
            { sampleId: 'sample0002', generationId: null },
        ]
    );
    assert.throws(
        () =>
            generationLookupTargets({
                samples: [{ sampleId: 'bad', generationId: 'prompt text' }],
            }),
        /invalid generation ID/
    );
    assert.throws(
        () =>
            generationLookupTargets({
                samples: Array.from(
                    { length: MAX_AUDITION_REQUESTS + 1 },
                    (_, index) => ({
                        sampleId: `sample${index}`,
                    })
                ),
            }),
        /lookup limit/
    );
});

test('generation metadata retains only actual cost, provider, and timing fields', () => {
    assert.deepEqual(
        generationMetadataFromResponse(
            {
                data: {
                    id: 'gen-abc-123',
                    model: 'google/gemini-3.8-flash-lite-tts',
                    provider_name: 'Example Provider',
                    total_cost: 0.012,
                    upstream_inference_cost: 0.01,
                    generation_time: 900,
                    latency: 1100,
                    prompt: 'must not be persisted',
                    completion: 'must not be persisted',
                },
            },
            'gen-abc-123'
        ),
        {
            model: 'google/gemini-3.8-flash-lite-tts',
            providerName: 'Example Provider',
            totalCostUsd: 0.012,
            upstreamInferenceCostUsd: 0.01,
            generationTime: 900,
            latency: 1100,
        }
    );
    assert.deepEqual(
        generationMetadataFromResponse(
            { data: { id: 'gen-abc-123', total_cost: 'estimate' } },
            'gen-abc-123'
        ),
        {
            model: null,
            providerName: null,
            totalCostUsd: null,
            upstreamInferenceCostUsd: null,
            generationTime: null,
            latency: null,
        }
    );
    assert.throws(
        () =>
            generationMetadataFromResponse(
                { data: { id: 'gen-other' } },
                'gen-abc-123'
            ),
        /different generation/
    );
});

test('generation metadata response reader cancels a body once it exceeds its byte limit', async () => {
    let cancelled = false;
    const body = new globalThis.ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
            cancelled = true;
        },
    });

    await assert.rejects(
        readBoundedJsonResponse(
            new Response(body, {
                headers: { 'content-type': 'application/json' },
            }),
            2
        ),
        /exceeded the response limit/
    );
    assert.equal(cancelled, true);
});
