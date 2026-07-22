/**
 * @description: Provides the live chat experience for public and embedded Footnote surfaces.
 * @footnote-scope: web
 * @footnote-module: Chat
 * @footnote-risk: medium - Input, Turnstile, or response rendering failures can break the primary interactive web flow.
 * @footnote-ethics: high - This component brokers live user prompts and transparency metadata in a public-facing context.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import MarkdownResponse from './MarkdownResponse';
import ProvenanceFooter from './ProvenanceFooter';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { loadRuntimeConfig } from '../config';
import { api, isApiClientError } from '../utils/api';
import { notifyEmbedLayoutChanged } from '../utils/embedHeight';
import { useTheme } from '../theme';

// Module augmentation for Vite environment variables
declare global {
    interface ImportMetaEnv {
        readonly DEV: boolean;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
}

// Provide a stable fallback response in case the backend is unavailable so the space stays welcoming.
const FALLBACK_REFLECTION =
    'I was unable to generate a response - please try again later.';
const INVISIBLE_CHALLENGE_TIMEOUT_MS = 8000;

const Chat = (): JSX.Element => {
    const { theme } = useTheme();
    const [question, setQuestion] = useState('');
    const [status, setStatus] = useState('');
    const [answer, setAnswer] = useState('');
    const [metadata, setMetadata] = useState<ResponseMetadata | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileError, setTurnstileError] = useState<string | null>(null);
    const [turnstileKey, setTurnstileKey] = useState(0);
    const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
    const [isTurnstileMounted, setIsTurnstileMounted] = useState(false);
    const [isManagedChallengeVisible, setIsManagedChallengeVisible] =
        useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const formRef = useRef<HTMLFormElement | null>(null);
    const turnstileRef = useRef<TurnstileInstance | null>(null);
    const isTurnstileExecutingRef = useRef(false);
    const hasInteractedRef = useRef(false); // Track if user has interacted to prevent initial status flash

    const ensureRuntimeConfigLoaded = async (): Promise<string> => {
        if (
            import.meta.env.DEV &&
            (window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1')
        ) {
            setTurnstileSiteKey('');
            return '';
        }
        try {
            const config = await loadRuntimeConfig();
            const siteKey = config.turnstileSiteKey || '';
            setTurnstileSiteKey(siteKey);
            return siteKey;
        } catch {
            setTurnstileSiteKey('');
            return '';
        }
    };

    // Check if Turnstile site key is valid (not empty or missing)
    const hasValidSiteKey =
        turnstileSiteKey && turnstileSiteKey.trim().length > 0;

    // Skip CAPTCHA when the site key is missing or invalid.
    const isCaptchaDisabled = !hasValidSiteKey;

    // Turnstile tokens are short-lived and single-use. Do not log token values or previews.
    const onTurnstileVerify = (token: string) => {
        isTurnstileExecutingRef.current = false;
        // Check if using test keys (test keys generate shorter dummy tokens like "XXXX.DUMMY.TOKEN.XXXX")
        const isTestKey =
            turnstileSiteKey.startsWith('1x00000000000000000000') ||
            turnstileSiteKey.startsWith('2x00000000000000000000') ||
            turnstileSiteKey.startsWith('3x00000000000000000000');

        // Validate token - test keys generate shorter tokens, production tokens should be ~200+ chars
        if (!token) {
            setTurnstileError('CAPTCHA token is invalid. Please try again.');
            setTurnstileToken(null);
            return;
        }

        // Only validate length for production keys (test keys use dummy tokens)
        if (!isTestKey && token.length < 50) {
            setTurnstileError('CAPTCHA token is invalid. Please try again.');
            setTurnstileToken(null);
            return;
        }

        setTurnstileToken(token);
        setTurnstileError(null);
        // Only clear status if it's not an error message (errors should persist until next submission)
        // Check if current status is an error by looking for common error keywords
        setStatus((prev) => {
            if (
                prev &&
                (prev.includes('failed') ||
                    prev.includes('unavailable') ||
                    prev.includes('Unable to connect'))
            ) {
                // Keep error messages - don't clear them on CAPTCHA verify
                return prev;
            }
            // Clear non-error status messages
            return '';
        });
    };

    /** Falls back from the background check without blocking the chat form indefinitely. */
    const showManagedChallenge = useCallback((): void => {
        isTurnstileExecutingRef.current = false;
        setIsTurnstileMounted(false);
        setTurnstileToken(null);
        setIsManagedChallengeVisible(true);
        setTurnstileError(
            'The background check could not finish. Please complete the visible CAPTCHA.'
        );
    }, []);

    const onManagedTurnstileError = () => {
        isTurnstileExecutingRef.current = false;
        setTurnstileError(
            'CAPTCHA verification failed. Check Brave Shields for this site, then try again.'
        );
        setTurnstileToken(null);
    };

    const onTurnstileExpire = () => {
        isTurnstileExecutingRef.current = false;
        setTurnstileToken(null);
        setTurnstileError('CAPTCHA expired. Please complete it again.');
    };

    useEffect(() => {
        if (
            isCaptchaDisabled ||
            isManagedChallengeVisible ||
            !isTurnstileMounted ||
            !turnstileRef.current ||
            turnstileToken ||
            isTurnstileExecutingRef.current
        ) {
            return undefined;
        }

        const challengeTimer = window.setTimeout(() => {
            if (!turnstileRef.current) {
                return;
            }

            isTurnstileExecutingRef.current = true;
            try {
                turnstileRef.current.execute();
                const responsePromise =
                    turnstileRef.current.getResponsePromise?.();
                if (responsePromise) {
                    void responsePromise
                        .catch(showManagedChallenge)
                        .finally(() => {
                            isTurnstileExecutingRef.current = false;
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
        isManagedChallengeVisible,
        isTurnstileMounted,
        showManagedChallenge,
        turnstileKey,
        turnstileToken,
    ]);

    // Auto-resize textarea based on content
    useEffect(() => {
        const textarea = inputRef.current;
        if (textarea && textarea instanceof HTMLTextAreaElement) {
            // Reset height to get accurate scrollHeight
            textarea.style.height = '0px';
            textarea.style.overflowY = 'hidden';

            const maxHeight = 20 * 16; // 20rem in pixels (20 * 16px = 320px)
            const scrollHeight = textarea.scrollHeight;

            // Only show scrollbar when we've reached max-height
            if (scrollHeight > maxHeight) {
                textarea.style.height = `${maxHeight}px`;
                textarea.style.overflowY = 'auto';
            } else {
                // Use exact scrollHeight without buffer to prevent scrollbar
                textarea.style.height = `${scrollHeight}px`;
                textarea.style.overflowY = 'hidden';
            }
        }

        notifyEmbedLayoutChanged('question-input-resize');
    }, [question]);

    useEffect(() => {
        notifyEmbedLayoutChanged('interaction-state-change');
    }, [
        answer,
        isLoading,
        isManagedChallengeVisible,
        metadata,
        status,
        turnstileError,
    ]);

    const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        // Mark that user has interacted
        hasInteractedRef.current = true;
        abortRef.current?.abort();

        const trimmedQuestion = question.trim();

        if (!trimmedQuestion) {
            setStatus('Please share a question, even a small one.');
            return;
        }

        // Load runtime config lazily on interaction to avoid noisy startup 404s
        // when the backend is not present.
        let runtimeSiteKey = turnstileSiteKey;
        if (!runtimeSiteKey) {
            runtimeSiteKey = await ensureRuntimeConfigLoaded();
        }

        const captchaDisabledForRequest = !(
            runtimeSiteKey && runtimeSiteKey.trim().length > 0
        );

        const resolvedToken = turnstileToken;
        if (!captchaDisabledForRequest && !resolvedToken) {
            if (!isManagedChallengeVisible) {
                showManagedChallenge();
            }
            setStatus('Please complete the visible CAPTCHA verification.');
            return;
        }

        // Abort any in-flight request when a new one starts to avoid race conditions.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Set a timeout for the fetch request (60 seconds)
        let didRequestTimeout = false;
        const timeoutId = setTimeout(() => {
            didRequestTimeout = true;
            controller.abort();
        }, 60000);

        // Clear previous status and answer when starting a new submission
        setStatus('');
        setIsLoading(true);
        setAnswer('');
        setMetadata(null);

        try {
            const payload = await api.chatQuestion(
                {
                    surface: 'web',
                    trigger: { kind: 'submit' },
                    latestUserInput: trimmedQuestion,
                    conversation: [
                        {
                            role: 'user',
                            content: trimmedQuestion,
                        },
                    ],
                    capabilities: {
                        canReact: false,
                        canGenerateImages: false,
                        canUseTts: false,
                    },
                    surfaceContext: {
                        requestHost: window.location.host,
                    },
                },
                {
                    turnstileToken:
                        !captchaDisabledForRequest && resolvedToken
                            ? resolvedToken
                            : undefined,
                    signal: controller.signal,
                }
            );

            if (payload.action !== 'message') {
                throw new Error(
                    `Chat API returned unsupported action for web surface: ${payload.action}`
                );
            }

            // Clear timeout once we have a response
            clearTimeout(timeoutId);

            const chat = payload.message as string | undefined;
            // Trust the API contract: metadata is already normalized by the backend.
            const backendMetadata = payload.metadata as
                | ResponseMetadata
                | null
                | undefined;

            setStatus('');
            setAnswer(
                chat?.trim() ||
                    'I would begin by examining the ethical principles involved, then consider what transparency and care require.'
            );

            // Normalize backend metadata to ResponseMetadata format
            setMetadata(backendMetadata ?? null);

            // Turnstile tokens are single-use, so mount a fresh invisible challenge.
            isTurnstileExecutingRef.current = false;
            setTurnstileToken(null);
            setTurnstileError(null);
            setIsTurnstileMounted(false);
            setIsManagedChallengeVisible(false);
            setTurnstileKey((prev) => prev + 1);
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                if (didRequestTimeout && abortRef.current === controller) {
                    setStatus('The request timed out. Please try again.');
                }
                return;
            }

            if (isApiClientError(error)) {
                // Handle CAPTCHA-specific errors
                if (error.status === 403) {
                    const errorMessage = error.details
                        ? `CAPTCHA verification failed: ${error.details}. Please refresh and try again.`
                        : 'CAPTCHA verification failed. Please refresh and try again.';

                    setIsLoading(false);
                    setStatus(errorMessage);
                    isTurnstileExecutingRef.current = false;
                    setTurnstileToken(null);
                    setIsTurnstileMounted(false);
                    setIsManagedChallengeVisible(true);
                    setTurnstileError(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    setTurnstileKey((prev) => prev + 1);
                    return;
                }

                // Handle 502 Turnstile service errors
                if (
                    error.status === 502 &&
                    (error.message.includes(
                        'CAPTCHA verification service unavailable'
                    ) ||
                        error.details?.includes(
                            'CAPTCHA verification service unavailable'
                        ))
                ) {
                    setIsLoading(false);
                    setStatus(
                        'CAPTCHA service is unavailable. Please try again shortly.'
                    );
                    isTurnstileExecutingRef.current = false;
                    setTurnstileToken(null);
                    setIsTurnstileMounted(false);
                    setIsManagedChallengeVisible(true);
                    setTurnstileError(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    setTurnstileKey((prev) => prev + 1);
                    return;
                }

                // Check for network errors
                if (error.code === 'network_error') {
                    setStatus(
                        'Unable to connect to the server. Please check your connection and try again.'
                    );
                    setIsLoading(false);
                    return;
                }

                // Check for CAPTCHA-related errors
                if (
                    error.message.includes('CAPTCHA') ||
                    error.message.includes('403')
                ) {
                    setStatus(
                        'CAPTCHA verification failed. Please refresh and try again.'
                    );
                    isTurnstileExecutingRef.current = false;
                    setTurnstileToken(null);
                    setIsTurnstileMounted(false);
                    setIsManagedChallengeVisible(true);
                    setTurnstileError(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    setIsLoading(false);
                    return;
                }
            }

            setStatus('');
            setAnswer(FALLBACK_REFLECTION);
            setMetadata(null);
        } finally {
            clearTimeout(timeoutId); // Ensure timeout is cleared in all cases
            if (abortRef.current === controller) {
                abortRef.current = null;
                setIsLoading(false);
            }
        }
    };

    return (
        <div className="interaction">
            <form
                className="interaction-form"
                onSubmit={onSubmit}
                ref={formRef}
            >
                <div className="interaction-input-group">
                    <label htmlFor="question-input" className="sr-only">
                        Ask a question
                    </label>
                    <div className="interaction-input-wrapper">
                        <textarea
                            id="question-input"
                            className="interaction-input"
                            name="question"
                            value={question}
                            onChange={(event) =>
                                setQuestion(event.target.value)
                            }
                            onKeyDown={(event) => {
                                const nativeEvent = event.nativeEvent as {
                                    isComposing?: boolean;
                                };
                                if (
                                    nativeEvent.isComposing === true ||
                                    event.keyCode === 229
                                ) {
                                    return;
                                }

                                const isModifierPressed =
                                    event.ctrlKey || event.metaKey;
                                if (
                                    event.key === 'Enter' &&
                                    isModifierPressed
                                ) {
                                    event.preventDefault();
                                    formRef.current?.requestSubmit();
                                }
                            }}
                            placeholder="What's on your mind?"
                            autoComplete="off"
                            ref={inputRef}
                            rows={1}
                            onFocus={() => {
                                void ensureRuntimeConfigLoaded();
                            }}
                        />
                        {question && (
                            <button
                                type="button"
                                className="interaction-clear-button"
                                onClick={() => setQuestion('')}
                                aria-label="Clear text"
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                            </button>
                        )}
                    </div>
                    <button
                        type="submit"
                        className="interaction-submit"
                        disabled={
                            isLoading ||
                            (isManagedChallengeVisible && !turnstileToken)
                        }
                        aria-label={
                            isLoading
                                ? 'Submitting question'
                                : isManagedChallengeVisible && !turnstileToken
                                  ? 'Complete CAPTCHA to submit'
                                  : 'Submit question'
                        }
                    >
                        {isLoading ? (
                            <>
                                <span className="spinner" aria-hidden="true" />
                            </>
                        ) : isManagedChallengeVisible && !turnstileToken ? (
                            <span
                                className="hourglass"
                                aria-label="Complete CAPTCHA verification"
                            >
                                ⏳
                            </span>
                        ) : (
                            'Go'
                        )}
                    </button>
                </div>
            </form>

            {/* Only show status when there's actual content (error messages, etc.) - spinner is in button during loading */}
            {/* Conditionally render only when we have actual content to avoid empty div taking space */}
            {/* IMPORTANT: Do not render at all if there's no content to avoid layout spacing */}
            {/* Only render after user has interacted to prevent initial flash */}
            {hasInteractedRef.current && status && status.trim().length > 0 && (
                <div
                    className="interaction-status interaction-status-visible"
                    role="status"
                >
                    <span>{status}</span>
                </div>
            )}
            {/* Only show output when there's actual content, not just when loading */}
            {answer && (
                <div className="interaction-output" aria-live="polite">
                    <MarkdownResponse markdown={answer} />
                </div>
            )}
            {/* The background widget is absolutely positioned so it never reserves layout space. */}
            {hasValidSiteKey &&
                !isCaptchaDisabled &&
                !isManagedChallengeVisible && (
                    <div
                        className="interaction-captcha interaction-captcha--invisible"
                        aria-hidden="true"
                    >
                        <Turnstile
                            ref={turnstileRef}
                            key={turnstileKey}
                            siteKey={turnstileSiteKey}
                            onSuccess={onTurnstileVerify}
                            onError={showManagedChallenge}
                            onExpire={onTurnstileExpire}
                            onLoad={() => setIsTurnstileMounted(true)}
                            options={{
                                theme,
                                size: 'invisible',
                                execution: 'execute',
                                appearance: 'execute',
                                language: 'en',
                            }}
                        />
                    </div>
                )}
            {/* Do not mount the managed widget until the invisible challenge fails. */}
            {hasValidSiteKey &&
                !isCaptchaDisabled &&
                isManagedChallengeVisible && (
                    <div
                        className="interaction-captcha interaction-captcha--managed"
                        aria-label="Complete CAPTCHA verification to submit your question"
                    >
                        <Turnstile
                            key={turnstileKey}
                            siteKey={turnstileSiteKey}
                            onSuccess={onTurnstileVerify}
                            onError={onManagedTurnstileError}
                            onExpire={onTurnstileExpire}
                            options={{
                                theme,
                                size: 'normal',
                                language: 'en',
                                refreshExpired: 'auto',
                            }}
                        />
                        {turnstileError && (
                            <p className="interaction-error" role="alert">
                                {turnstileError}
                            </p>
                        )}
                    </div>
                )}
            {answer && metadata && <ProvenanceFooter metadata={metadata} />}
        </div>
    );
};

/**
 * Named export kept for callers that prefer explicit component imports.
 */
export { Chat };
/**
 * Default export for route and section imports.
 */
export default Chat;
