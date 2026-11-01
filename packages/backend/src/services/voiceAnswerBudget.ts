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

/**
 * Estimates tokens without an English word-split assumption. This is deliberately
 * upper-biased for multilingual text, not an exact provider tokenizer count.
 */
export const estimateVoiceAnswerTokens = (text: string): number => {
    let asciiLettersAndSpaces = 0;
    let otherTokens = 0;
    for (const character of text) {
        if (character.codePointAt(0)! > 0x7f) otherTokens += 2;
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
): boolean =>
    estimateVoiceAnswerTokens(text) <=
        resolveVoiceAnswerTokenLimit(mode, configuredLimit) &&
    (mode !== 'standard' ||
        Array.from(text).length <= STANDARD_TTS_LIMIT_CHARACTERS);

