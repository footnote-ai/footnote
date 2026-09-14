/**
 * @description: Provides the live chat experience for public and embedded Footnote surfaces.
 * @footnote-scope: web
 * @footnote-module: Chat
 * @footnote-risk: medium - Input, Turnstile, or response rendering failures can break the primary interactive web flow.
 * @footnote-ethics: high - This component brokers live user prompts and transparency metadata in a public-facing context.
 */

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import MarkdownResponse from './MarkdownResponse';
import ProvenanceFooter from './ProvenanceFooter';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import { loadRuntimeConfig } from '../config';
import { api, isApiClientError } from '../utils/api';
import { notifyEmbedLayoutChanged } from '../utils/embedHeight';
import { useTheme } from '../theme';
import { useChatCaptcha } from '../hooks/useChatCaptcha';

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
const EMPTY_RESPONSE_MESSAGE = 'No answer was returned. Please try again.';
const INVALID_RESPONSE_MESSAGE =
    'The server returned a response I could not display. Please try again.';
type ChatStatusKind = 'error' | 'info';
type ChatStatus = { kind: ChatStatusKind; message: string };

const Chat = (): JSX.Element => {
    const { theme } = useTheme();
    const [question, setQuestion] = useState('');
    const [status, setStatus] = useState<ChatStatus | null>(null);
    const [answer, setAnswer] = useState('');
    const [metadata, setMetadata] = useState<ResponseMetadata | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const formRef = useRef<HTMLFormElement | null>(null);
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

    const showStatus = (
        message: string,
        kind: ChatStatusKind = 'error'
    ): void => {
        setStatus({ kind, message });
    };

    const clearInformationalStatus = useCallback((): void => {
        setStatus((previous) => (previous?.kind === 'error' ? previous : null));
    }, []);
    const captcha = useChatCaptcha({
        siteKey: turnstileSiteKey,
        onVerified: clearInformationalStatus,
    });

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
        metadata,
        status,
        captcha.error,
        captcha.isManagedChallengeVisible,
    ]);

    const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        // Mark that user has interacted
        hasInteractedRef.current = true;
        abortRef.current?.abort();

        const trimmedQuestion = question.trim();

        if (!trimmedQuestion) {
            showStatus('Please share a question, even a small one.', 'info');
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

        const resolvedToken = captcha.token;
        if (!captchaDisabledForRequest && !resolvedToken) {
            if (!captcha.isManagedChallengeVisible) {
                captcha.showManagedChallenge();
            }
            showStatus(
                'Please complete the visible CAPTCHA verification.',
                'info'
            );
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
        setStatus(null);
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
                    onRequestStarted:
                        !captchaDisabledForRequest && resolvedToken
                            ? captcha.consumeTokenAfterSubmission
                            : undefined,
                }
            );

            if (payload.action !== 'message') {
                throw new Error(
                    `Chat API returned unsupported action for web surface: ${payload.action}`
                );
            }

            // Ignore a response that finished after a newer submission replaced it.
            if (abortRef.current !== controller) {
                return;
            }

            // Clear timeout once we have a response
            clearTimeout(timeoutId);

            const chat = payload.message.trim();
            // Trust the API contract: metadata is already normalized by the backend.
            const backendMetadata = payload.metadata as
                ResponseMetadata | null | undefined;

            if (chat.length === 0) {
                showStatus(EMPTY_RESPONSE_MESSAGE);
                setAnswer('');
                setMetadata(null);
                return;
            }

            setStatus(null);
            setAnswer(chat);

            // Normalize backend metadata to ResponseMetadata format
            setMetadata(backendMetadata ?? null);
        } catch (error) {
            // A superseded request must not overwrite the newer request's status or answer.
            if (abortRef.current !== controller) {
                return;
            }

            const isWrappedRequestAbort =
                isApiClientError(error) &&
                (error.code === 'aborted_error' ||
                    error.code === 'timeout_error');
            if (
                (error as Error).name === 'AbortError' ||
                isWrappedRequestAbort
            ) {
                if (
                    (didRequestTimeout ||
                        (isApiClientError(error) &&
                            error.code === 'timeout_error')) &&
                    abortRef.current === controller
                ) {
                    showStatus('The request timed out. Please try again.');
                }
                return;
            }

            if (isApiClientError(error)) {
                if (error.code === 'invalid_payload') {
                    showStatus(INVALID_RESPONSE_MESSAGE);
                    setAnswer('');
                    setMetadata(null);
                    return;
                }

                // Handle CAPTCHA-specific errors
                if (error.status === 403) {
                    const errorMessage = error.details
                        ? `CAPTCHA verification failed: ${error.details}. Please refresh and try again.`
                        : 'CAPTCHA verification failed. Please refresh and try again.';

                    setIsLoading(false);
                    showStatus(errorMessage);
                    captcha.showManagedChallenge(
                        'Please complete the visible CAPTCHA and try again.'
                    );
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
                    showStatus(
                        'CAPTCHA service is unavailable. Please try again shortly.'
                    );
                    captcha.showManagedChallenge(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    return;
                }

                // Check for network errors
                if (error.code === 'network_error') {
                    showStatus(
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
                    showStatus(
                        'CAPTCHA verification failed. Please refresh and try again.'
                    );
                    captcha.showManagedChallenge(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    setIsLoading(false);
                    return;
                }
            }

            setStatus(null);
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
                            (captcha.isManagedChallengeVisible &&
                                !captcha.token)
                        }
                        aria-label={
                            isLoading
                                ? 'Submitting question'
                                : captcha.isManagedChallengeVisible &&
                                    !captcha.token
                                  ? 'Complete CAPTCHA to submit'
                                  : 'Submit question'
                        }
                    >
                        {isLoading ? (
                            <>
                                <span className="spinner" aria-hidden="true" />
                            </>
                        ) : captcha.isManagedChallengeVisible &&
                          !captcha.token ? (
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

            {hasInteractedRef.current && status && (
                <div
                    className="interaction-status interaction-status-visible"
                    role="status"
                >
                    <span>{status.message}</span>
                </div>
            )}
            {answer && (
                <div className="interaction-output" aria-live="polite">
                    <MarkdownResponse markdown={answer} />
                </div>
            )}
            {/* The background widget is absolutely positioned so it never reserves layout space. */}
            {!captcha.isCaptchaDisabled &&
                !captcha.isManagedChallengeVisible && (
                    <div
                        className="interaction-captcha interaction-captcha--invisible"
                        aria-hidden="true"
                    >
                        <Turnstile
                            ref={captcha.invisibleRef}
                            key={captcha.invisibleKey}
                            siteKey={turnstileSiteKey}
                            onSuccess={captcha.onVerify}
                            onError={captcha.onInvisibleError}
                            onExpire={captcha.onExpire}
                            onWidgetLoad={captcha.onInvisibleLoad}
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
            {!captcha.isCaptchaDisabled &&
                captcha.isManagedChallengeVisible && (
                    <div
                        className="interaction-captcha interaction-captcha--managed"
                        aria-label="Complete CAPTCHA verification to submit your question"
                    >
                        <Turnstile
                            key={captcha.invisibleKey}
                            siteKey={turnstileSiteKey}
                            onSuccess={captcha.onVerify}
                            onError={captcha.onManagedError}
                            onExpire={captcha.onExpire}
                            options={{
                                theme,
                                size: 'normal',
                                language: 'en',
                                refreshExpired: 'auto',
                            }}
                        />
                        {captcha.error && (
                            <p className="interaction-error" role="alert">
                                {captcha.error}
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
