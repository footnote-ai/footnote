/**
 * @description: Owns the invisible and managed Turnstile lifecycle used by chat.
 * @footnote-scope: web
 * @footnote-module: UseChatCaptcha
 * @footnote-risk: medium - CAPTCHA lifecycle mistakes can block or weaken chat submissions.
 * @footnote-ethics: medium - This hook preserves the user's security challenge and fail-open behavior.
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';

const INVISIBLE_CHALLENGE_TIMEOUT_MS = 8000;
const DEFAULT_MANAGED_CHALLENGE_ERROR =
    'The background check could not finish. Please complete the visible CAPTCHA.';

type ChatCaptchaOptions = {
    siteKey: string;
    onVerified: () => void;
};

type ChatCaptcha = {
    error: string | null;
    invisibleKey: number;
    invisibleRef: RefObject<TurnstileInstance | null>;
    isCaptchaDisabled: boolean;
    isManagedChallengeVisible: boolean;
    onExpire: () => void;
    onInvisibleError: () => void;
    onInvisibleLoad: () => void;
    onManagedError: () => void;
    onVerify: (token: string) => void;
    consumeTokenAfterSubmission: () => void;
    showManagedChallenge: (message?: string) => void;
    token: string | null;
};

/** Owns chat CAPTCHA state, fallback, verification, and reset transitions. */
const useChatCaptcha = ({
    siteKey,
    onVerified,
}: ChatCaptchaOptions): ChatCaptcha => {
    const [token, setToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [invisibleKey, setInvisibleKey] = useState(0);
    const [isInvisibleMounted, setIsInvisibleMounted] = useState(false);
    const [isManagedChallengeVisible, setIsManagedChallengeVisible] =
        useState(false);
    const invisibleRef = useRef<TurnstileInstance | null>(null);
    const isExecutingRef = useRef(false);
    const challengeGenerationRef = useRef(0);
    const isCaptchaDisabled = siteKey.trim().length === 0;

    const showManagedChallenge = useCallback(
        (message: string = DEFAULT_MANAGED_CHALLENGE_ERROR): void => {
            isExecutingRef.current = false;
            challengeGenerationRef.current += 1;
            setIsInvisibleMounted(false);
            setToken(null);
            setIsManagedChallengeVisible(true);
            setInvisibleKey((previous) => previous + 1);
            setError(message);
        },
        []
    );

    const callbackGeneration = challengeGenerationRef.current;

    const onVerify = useCallback(
        (candidate: string): void => {
            if (challengeGenerationRef.current !== callbackGeneration) {
                return;
            }
            isExecutingRef.current = false;
            challengeGenerationRef.current += 1;
            const isTestKey =
                siteKey.startsWith('1x00000000000000000000') ||
                siteKey.startsWith('2x00000000000000000000') ||
                siteKey.startsWith('3x00000000000000000000');

            if (!candidate || (!isTestKey && candidate.length < 50)) {
                setError('CAPTCHA token is invalid. Please try again.');
                setToken(null);
                return;
            }

            setToken(candidate);
            setError(null);
            onVerified();
        },
        [callbackGeneration, onVerified, siteKey]
    );

    const onManagedError = useCallback((): void => {
        if (challengeGenerationRef.current !== callbackGeneration) {
            return;
        }
        isExecutingRef.current = false;
        challengeGenerationRef.current += 1;
        setError(
            'CAPTCHA verification failed. Check Brave Shields for this site, then try again.'
        );
        setToken(null);
    }, [callbackGeneration]);

    const onInvisibleError = useCallback((): void => {
        showManagedChallenge();
    }, [showManagedChallenge]);

    const onExpire = useCallback((): void => {
        if (challengeGenerationRef.current !== callbackGeneration) {
            return;
        }
        isExecutingRef.current = false;
        challengeGenerationRef.current += 1;
        setToken(null);
        setError('CAPTCHA expired. Please complete it again.');
    }, [callbackGeneration]);

    const onInvisibleLoad = useCallback((): void => {
        setIsInvisibleMounted(true);
    }, []);

    useEffect(() => {
        if (
            isCaptchaDisabled ||
            isManagedChallengeVisible ||
            !isInvisibleMounted ||
            !invisibleRef.current ||
            token ||
            isExecutingRef.current
        ) {
            return undefined;
        }

        const challengeTimer = window.setTimeout(() => {
            if (!invisibleRef.current) {
                return;
            }

            isExecutingRef.current = true;
            const challengeGeneration = challengeGenerationRef.current;
            try {
                invisibleRef.current.execute();
                const responsePromise =
                    invisibleRef.current.getResponsePromise?.();
                if (responsePromise) {
                    void responsePromise
                        .catch(() => {
                            if (
                                challengeGenerationRef.current ===
                                challengeGeneration
                            ) {
                                showManagedChallenge();
                            }
                        })
                        .finally(() => {
                            if (
                                challengeGenerationRef.current ===
                                challengeGeneration
                            ) {
                                isExecutingRef.current = false;
                            }
                        });
                }
            } catch {
                showManagedChallenge();
            }
        }, 100);

        const fallbackTimer = window.setTimeout(
            showManagedChallenge,
            INVISIBLE_CHALLENGE_TIMEOUT_MS
        );

        return () => {
            window.clearTimeout(challengeTimer);
            window.clearTimeout(fallbackTimer);
        };
    }, [
        isCaptchaDisabled,
        isInvisibleMounted,
        isManagedChallengeVisible,
        showManagedChallenge,
        token,
    ]);

    const consumeTokenAfterSubmission = useCallback((): void => {
        isExecutingRef.current = false;
        challengeGenerationRef.current += 1;
        setToken(null);
        setError(null);
        setIsInvisibleMounted(false);
        setIsManagedChallengeVisible(false);
        setInvisibleKey((previous) => previous + 1);
    }, []);

    return {
        error,
        invisibleKey,
        invisibleRef,
        isCaptchaDisabled,
        isManagedChallengeVisible,
        onExpire,
        onInvisibleError,
        onInvisibleLoad,
        onManagedError,
        onVerify,
        consumeTokenAfterSubmission,
        showManagedChallenge,
        token,
    };
};

export { useChatCaptcha };
