/**
 * @description: Bounds Voice answers before provider handoff using a conservative token estimate.
 * @footnote-scope: utility
 * @footnote-module: VoiceAnswerBudget
 * @footnote-risk: medium - Provider tokenizers differ, so an estimate must retain headroom.
 * @footnote-ethics: medium - The delivery ceiling must not rewrite reviewed answer text.
 */
export type VoiceMode = 'standard' | 'live';
export type VoiceAnswerDeliveryPolicy = {
    mode: VoiceMode;
    maxAnswerTokens: number;
};

// OpenAI Live allows 500 commentary tokens; leave 20% for tokenizer variance.
const LIVE_COMMENTARY_LIMIT_TOKENS = 400;
// OpenAI TTS allows 2,000 tokens and 4,096 characters; keep margin on both.
const STANDARD_TTS_LIMIT_TOKENS = 1_600;
const STANDARD_TTS_LIMIT_CHARACTERS = 3_686;

export type VoiceAnswerMeasurement = {
    estimatedTokens: number;
    tokenLimit: number;
    tokenOverage: number;
    codePoints: number;
    characterLimit?: number;
    characterOverage: number;
    fits: boolean;
};

/**
 * Estimates tokens without an English word-split assumption. This is deliberately
 * upper-biased for multilingual text, not an exact provider tokenizer count.
 */
export const estimateVoiceAnswerTokens = (text: string): number => {
    let asciiLettersAndSpaces = 0;
    let otherTokens = 0;
    for (const character of text) {
        if (character.codePointAt(0)! > 0x7f)
            otherTokens += Math.max(2, Buffer.byteLength(character, 'utf8'));
        else if (/[a-z\s]/i.test(character)) asciiLettersAndSpaces += 1;
        else otherTokens += 1;
    }
    return Math.max(1, otherTokens + Math.ceil(asciiLettersAndSpaces / 3));
};

export const resolveVoiceAnswerTokenLimit = (
    mode: VoiceMode,
    configuredLimit: number
): number =>
    Math.min(
        configuredLimit,
        mode === 'live'
            ? LIVE_COMMENTARY_LIMIT_TOKENS
            : STANDARD_TTS_LIMIT_TOKENS
    );

export const fitsVoiceAnswerDelivery = (
    text: string,
    mode: VoiceMode,
    configuredLimit: number
): boolean => measureVoiceAnswerDelivery(text, mode, configuredLimit).fits;

/** Shares one measured result across admission, prompts, and content-free receipts. */
export const measureVoiceAnswerDelivery = (
    text: string,
    mode: VoiceMode,
    configuredLimit: number
): VoiceAnswerMeasurement => {
    const estimatedTokens = estimateVoiceAnswerTokens(text);
    const tokenLimit = resolveVoiceAnswerTokenLimit(mode, configuredLimit);
    const codePoints = Array.from(text).length;
    const characterLimit =
        mode === 'standard' ? STANDARD_TTS_LIMIT_CHARACTERS : undefined;
    const tokenOverage = Math.max(0, estimatedTokens - tokenLimit);
    const characterOverage = Math.max(
        0,
        codePoints - (characterLimit ?? Number.MAX_SAFE_INTEGER)
    );
    return {
        estimatedTokens,
        tokenLimit,
        tokenOverage,
        codePoints,
        ...(characterLimit === undefined ? {} : { characterLimit }),
        characterOverage,
        fits: tokenOverage === 0 && characterOverage === 0,
    };
};
