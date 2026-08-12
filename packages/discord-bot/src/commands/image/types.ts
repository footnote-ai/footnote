/**
 * @description: Defines the shared model and metadata types used by the Discord image command.
 * @footnote-scope: interface
 * @footnote-module: ImageTypes
 * @footnote-risk: low - Type drift here can make the Discord image UI disagree with backend validation.
 * @footnote-ethics: low - These types document shape and ownership but do not change behavior by themselves.
 */
import {
    internalImageRenderModels,
    supportedImageOutputFormats,
    type InternalImageRenderModelId,
    type InternalImageTextModelId,
    type SupportedImageOutputFormat,
} from '@footnote/contracts/providers';
import type {
    ImageGenerationQuality,
    ImageGenerationSize,
} from '../../utils/pricing.js';

export type ImageTextModel = InternalImageTextModelId;
export type ImageRenderModel = InternalImageRenderModelId;
export type ImageQualityType = ImageGenerationQuality;
export type ImageSizeType = ImageGenerationSize;
export type ImageBackgroundType = 'auto' | 'transparent' | 'opaque';
export type ImageOutputFormat = SupportedImageOutputFormat;
export type ImageOutputCompression = number;

/**
 * Intentionally small, deterministic image-prompt choices shown in Discord.
 * Backend validation remains broader through internalImageTextModels.
 */
export const imageTextModels = [
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol',
    'gpt-5.4-nano',
] as const satisfies readonly ImageTextModel[];

/**
 * Presentation metadata for the request-local image prompt selector.
 * Provider ids remain in value and are never decorated for display.
 */
export const imageTextModelChoices = [
    {
        name: 'gpt-5.6-luna (recommended/default)',
        value: 'gpt-5.6-luna',
    },
    { name: 'gpt-5.6-terra (higher quality)', value: 'gpt-5.6-terra' },
    { name: 'gpt-5.6-sol (highest quality)', value: 'gpt-5.6-sol' },
    { name: 'gpt-5.4-nano (lowest cost)', value: 'gpt-5.4-nano' },
] as const satisfies ReadonlyArray<{ name: string; value: ImageTextModel }>;

/**
 * Image render models exposed by the Discord image command.
 */
export const imageRenderModels =
    internalImageRenderModels satisfies readonly ImageRenderModel[];

/**
 * Output formats accepted by the Discord image command.
 */
export const imageOutputFormats =
    supportedImageOutputFormats satisfies readonly ImageOutputFormat[];

export const imageQualities = [
    'low',
    'medium',
    'high',
    'auto',
] as const satisfies readonly ImageQualityType[];

export type ImageStylePreset =
    | 'natural'
    | 'vivid'
    | 'photorealistic'
    | 'cinematic'
    | 'oil_painting'
    | 'watercolor'
    | 'digital_painting'
    | 'line_art'
    | 'sketch'
    | 'cartoon'
    | 'anime'
    | 'comic'
    | 'pixel_art'
    | 'cyberpunk'
    | 'fantasy_art'
    | 'surrealist'
    | 'minimalist'
    | 'vintage'
    | 'noir'
    | '3d_render'
    | 'steampunk'
    | 'abstract'
    | 'pop_art'
    | 'dreamcore'
    | 'isometric'
    | 'unspecified';

/**
 * Provider-neutral shape for image-generation call records that may include
 * prompt/style enrichment metadata.
 */
export interface ImageGenerationCallWithPrompt {
    type: 'image_generation_call';
    finalImageBase64: string;
    responseId: string | null;
    annotations: AnnotationFields;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        imageCount: number;
    };
    costs: {
        text: number;
        image: number;
        total: number;
        perImage: number;
    };
    textModel: ImageTextModel;
    imageModel: ImageRenderModel;
    outputFormat: ImageOutputFormat;
    outputCompression: ImageOutputCompression;
    generationTimeMs?: number;
    revisedPrompt?: string | null;
    finalStyle?: ImageStylePreset | null;
    revised_prompt?: string | null;
    style_preset?: ImageStylePreset | null;
    metadata?: Record<string, unknown>;
}

/**
 * Small annotation bundle attached to completed image results.
 */
export interface AnnotationFields {
    title: string | null;
    description: string | null;
    note: string | null;
    adjustedPrompt?: string | null;
}

/**
 * One streamed preview image emitted before the final artifact is ready.
 */
export interface PartialImagePayload {
    index: number;
    base64: string;
}

/**
 * Usage data preserved on uploaded image metadata.
 */
export interface CloudinaryUsageMetadata {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    imageCount: number;
    combinedInputTokens: number;
    combinedOutputTokens: number;
    combinedTotalTokens: number;
}

/**
 * Cost data preserved on uploaded image metadata.
 */
export interface CloudinaryCostMetadata {
    text: number;
    image: number;
    total: number;
    perImage: number;
}

/**
 * Metadata persisted alongside one uploaded image result so retries,
 * variations, and trace surfaces can reconstruct what happened.
 */
export interface UploadMetadata {
    originalPrompt: string;
    revisedPrompt?: string | null;
    title?: string | null;
    description?: string | null;
    noteMessage?: string | null;
    textModel: ImageTextModel;
    imageModel: ImageRenderModel;
    outputFormat: ImageOutputFormat;
    outputCompression?: ImageOutputCompression;
    quality: ImageQualityType;
    size: ImageSizeType;
    background: ImageBackgroundType;
    style: ImageStylePreset;
    startTime: number;
    usage: CloudinaryUsageMetadata;
    cost: CloudinaryCostMetadata;
}
