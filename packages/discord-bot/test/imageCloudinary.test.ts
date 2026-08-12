/**
 * @description: Verifies generated image buffers upload to Cloudinary without base64 re-encoding.
 * @footnote-scope: test
 * @footnote-module: ImageCloudinaryTests
 * @footnote-risk: medium - Upload regressions can restore a large duplicate image allocation.
 * @footnote-ethics: medium - Confirms generated image bytes leave the bot through the configured delivery provider only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import type { UploadMetadata } from '../src/commands/image/types.js';

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

const metadata: UploadMetadata = {
    originalPrompt: 'draw a reflective skyline',
    revisedPrompt: null,
    title: null,
    description: null,
    noteMessage: null,
    textModel: 'gpt-5-mini',
    imageModel: 'gpt-image-1-mini',
    outputFormat: 'png',
    outputCompression: 100,
    quality: 'medium',
    size: '1024x1024',
    background: 'auto',
    style: 'vivid',
    startTime: Date.now(),
    usage: {
        inputTokens: 42,
        outputTokens: 18,
        totalTokens: 60,
        imageCount: 1,
        combinedInputTokens: 42,
        combinedOutputTokens: 18,
        combinedTotalTokens: 60,
    },
    cost: {
        text: 0.000046,
        image: 0.011,
        total: 0.011046,
        perImage: 0.011,
    },
};

test('uploadToCloudinary writes the existing image buffer to upload_stream', async () => {
    const { v2: cloudinary } = await import('cloudinary');
    const { uploadToCloudinary } =
        await import('../src/commands/image/cloudinary.js');
    const originalUploadStream = cloudinary.uploader.upload_stream;
    const imageBuffer = Buffer.from('raw image bytes');
    let receivedBuffer: Buffer | null = null;
    let receivedOptions: unknown;

    cloudinary.uploader.upload_stream = ((options, callback) => {
        receivedOptions = options;
        return new Writable({
            write(chunk, _encoding, done) {
                receivedBuffer = Buffer.from(chunk);
                done();
            },
            final(done) {
                callback?.(undefined, {
                    secure_url: 'https://example.com/generated.png',
                } as never);
                done();
            },
        });
    }) as typeof cloudinary.uploader.upload_stream;

    try {
        const imageUrl = await uploadToCloudinary(imageBuffer, metadata);

        assert.equal(imageUrl, 'https://example.com/generated.png');
        assert.deepEqual(receivedBuffer, imageBuffer);
        assert.equal(
            (receivedOptions as { resource_type?: string }).resource_type,
            'image'
        );
    } finally {
        cloudinary.uploader.upload_stream = originalUploadStream;
    }
});

test('uploadToCloudinary preserves the image buffer for caller fallback when upload_stream fails', async () => {
    const { v2: cloudinary } = await import('cloudinary');
    const { uploadToCloudinary } =
        await import('../src/commands/image/cloudinary.js');
    const originalUploadStream = cloudinary.uploader.upload_stream;
    const imageBuffer = Buffer.from('fallback image bytes');
    let receivedBuffer: Buffer | null = null;

    cloudinary.uploader.upload_stream = ((_, callback) =>
        new Writable({
            write(chunk, _encoding, done) {
                receivedBuffer = Buffer.from(chunk);
                done();
            },
            final(done) {
                callback?.(new Error('Cloudinary unavailable') as never);
                done();
            },
        })) as typeof cloudinary.uploader.upload_stream;

    try {
        await assert.rejects(
            () => uploadToCloudinary(imageBuffer, metadata),
            /Cloudinary unavailable/
        );
        assert.deepEqual(receivedBuffer, imageBuffer);
        assert.equal(imageBuffer.toString(), 'fallback image bytes');
    } finally {
        cloudinary.uploader.upload_stream = originalUploadStream;
    }
});
