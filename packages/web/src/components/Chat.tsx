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
import CanonicalResponseFootnote from './CanonicalResponseFootnote';
import type { ResponseMetadata } from '@footnote/contracts/policy';
import type { ChatConversationMessage } from '@footnote/contracts/web';
import { loadRuntimeConfig } from '../config';
import { api, isApiClientError } from '../utils/api';
import { buildChatConversation } from '../utils/chatConversation';
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

const EMPTY_RESPONSE_MESSAGE = 'No answer was returned. Please try again.';
const INVALID_RESPONSE_MESSAGE =
    'The server returned a response I could not display. Please try again.';
type ChatStatusKind = 'error' | 'info';
type ChatRequestState =
    | 'backend'
    | 'captcha'
    | 'invalid-response'
    | 'network'
    | 'superseded'
    | 'timeout'
    | 'unsupported';
type ChatStatus = {
    kind: ChatStatusKind;
    message: string;
    requestState?: ChatRequestState;
};
type CompletedChatTurn = {
    id: number;
    userMessage: string;
    assistantMessage: string;
    metadata: ResponseMetadata | null;
    answerProvenanceEligible: boolean | undefined;
};
type CurrentChatRequest = {
    userMessage: string;
    status: 'pending' | 'failed';
};

const Chat = (): JSX.Element => {
    const { theme } = useTheme();
    const [question, setQuestion] = useState('');
    const [status, setStatus] = useState<ChatStatus | null>(null);
    const [completedTurns, setCompletedTurns] = useState<CompletedChatTurn[]>(
        []
    );
    const nextCompletedTurnIdRef = useRef(0);
    const [currentRequest, setCurrentRequest] =
        useState<CurrentChatRequest | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
    const abortRef = useRef<AbortController | null>(null);
    const conversationRef = useRef<ChatConversationMessage[]>([]);
    const sessionIdRef = useRef<string | null>(null);
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
        kind: ChatStatusKind = 'error',
        requestState?: ChatRequestState
    ): void => {
        setStatus({ kind, message, requestState });
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
        completedTurns,
        currentRequest,
        isLoading,
        status,
        captcha.error,
        captcha.isManagedChallengeVisible,
    ]);

    const submitUserMessage = async (
        submittedMessage: string
    ): Promise<void> => {
        // Mark that user has interacted
        hasInteractedRef.current = true;
        const trimmedQuestion = submittedMessage.trim();

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
                'info',
                'captcha'
            );
            return;
        }

        // The retry reuses the failed turn; only an active request is superseded.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Set a timeout for the fetch request (60 seconds)
        let didRequestTimeout = false;
        const timeoutId = setTimeout(() => {
            didRequestTimeout = true;
            controller.abort();
        }, 60000);

        // Keep completed turns visible while the new request is pending.
        setStatus(null);
        setIsLoading(true);
        setCurrentRequest({
            userMessage: trimmedQuestion,
            status: 'pending',
        });
        setQuestion('');

        const sessionId = sessionIdRef.current ?? window.crypto.randomUUID();
        sessionIdRef.current = sessionId;

        try {
            const payload = await api.chatQuestion(
                {
                    surface: 'web',
                    trigger: { kind: 'submit' },
                    latestUserInput: trimmedQuestion,
                    conversation: buildChatConversation(
                        conversationRef.current,
                        trimmedQuestion
                    ),
                    sessionId,
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
                setCurrentRequest({
                    userMessage: trimmedQuestion,
                    status: 'failed',
                });
                showStatus(
                    'This chat response used an action that the web chat cannot display.',
                    'error',
                    'unsupported'
                );
                return;
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
                showStatus(EMPTY_RESPONSE_MESSAGE, 'error', 'invalid-response');
                setCurrentRequest({
                    userMessage: trimmedQuestion,
                    status: 'failed',
                });
                return;
            }

            setStatus(null);
            conversationRef.current = [
                ...buildChatConversation(
                    conversationRef.current,
                    trimmedQuestion
                ),
                { role: 'assistant', content: chat },
            ];
            const id = nextCompletedTurnIdRef.current++;
            setCompletedTurns((previous) => [
                ...previous,
                {
                    id,
                    userMessage: trimmedQuestion,
                    assistantMessage: chat,
                    metadata: backendMetadata ?? null,
                    answerProvenanceEligible:
                        payload.answerProvenanceEligible !== false,
                },
            ]);
            setCurrentRequest(null);
        } catch (error) {
            // A superseded request must not overwrite the newer request's status or answer.
            if (abortRef.current !== controller) {
                return;
            }
            setCurrentRequest({
                userMessage: trimmedQuestion,
                status: 'failed',
            });

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
                    showStatus(
                        'The request timed out. Please try again.',
                        'error',
                        'timeout'
                    );
                } else if (abortRef.current === controller) {
                    setCurrentRequest({
                        userMessage: trimmedQuestion,
                        status: 'failed',
                    });
                    showStatus(
                        'This request was superseded. No assistant response was added.',
                        'info',
                        'superseded'
                    );
                }
                return;
            }

            if (isApiClientError(error)) {
                if (error.code === 'invalid_payload') {
                    showStatus(
                        INVALID_RESPONSE_MESSAGE,
                        'error',
                        'invalid-response'
                    );
                    return;
                }

                // Handle CAPTCHA-specific errors
                if (error.status === 403) {
                    const errorMessage = error.details
                        ? `CAPTCHA verification failed: ${error.details}. Please refresh and try again.`
                        : 'CAPTCHA verification failed. Please refresh and try again.';

                    setIsLoading(false);
                    showStatus(errorMessage, 'error', 'captcha');
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
                        'CAPTCHA service is unavailable. Please try again shortly.',
                        'error',
                        'captcha'
                    );
                    captcha.showManagedChallenge(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    return;
                }

                // Check for network errors
                if (error.code === 'network_error') {
                    showStatus(
                        'Unable to connect to the server. Please check your connection and try again.',
                        'error',
                        'network'
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
                        'CAPTCHA verification failed. Please refresh and try again.',
                        'error',
                        'captcha'
                    );
                    captcha.showManagedChallenge(
                        'Please complete the visible CAPTCHA and try again.'
                    );
                    setIsLoading(false);
                    return;
                }
            }

            const message = isApiClientError(error)
                ? 'The server could not complete this request. Please try again.'
                : 'Unable to generate a response. Please try again later.';
            showStatus(
                message,
                'error',
                isApiClientError(error) ? 'backend' : undefined
            );
        } finally {
            clearTimeout(timeoutId); // Ensure timeout is cleared in all cases
            if (abortRef.current === controller) {
                abortRef.current = null;
                setIsLoading(false);
            }
        }
    };

    const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void submitUserMessage(question);
    };

    const startNewChat = (): void => {
        abortRef.current?.abort();
        abortRef.current = null;
        sessionIdRef.current = window.crypto.randomUUID();
        conversationRef.current = [];
        setCompletedTurns([]);
        setCurrentRequest(null);
        setQuestion('');
        setStatus(null);
        setIsLoading(false);
        captcha.consumeTokenAfterSubmission();
        inputRef.current?.focus();
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

            {(completedTurns.length > 0 || currentRequest) && (
                <button
                    type="button"
                    className="interaction-new-chat"
                    onClick={startNewChat}
                >
                    New chat
                </button>
            )}
            {hasInteractedRef.current && status && (
                <div
                    className="interaction-status interaction-status-visible"
                    role="status"
                    data-request-state={status.requestState}
                >
                    <span>{status.message}</span>
                </div>
            )}
            {(completedTurns.length > 0 || currentRequest) && (
                <div className="interaction-transcript">
                    {completedTurns.map((turn) => (
                        <div className="interaction-turn" key={turn.id}>
                            <p className="public-message public-message--person">
                                {turn.userMessage}
                            </p>
                            <article className="public-message public-message--assistant">
                                <MarkdownResponse
                                    markdown={turn.assistantMessage}
                                />
                            </article>
                            <CanonicalResponseFootnote
                                metadata={turn.metadata}
                                artifacts={{
                                    trace: 'unknown',
                                    report: 'unavailable',
                                }}
                                answerProvenanceEligible={
                                    turn.answerProvenanceEligible
                                }
                            />
                        </div>
                    ))}
                    {currentRequest && (
                        <div className="interaction-turn">
                            <p className="public-message public-message--person">
                                {currentRequest.userMessage}
                            </p>
                            <div
                                className="interaction-request-state"
                                role={
                                    currentRequest.status === 'pending'
                                        ? 'status'
                                        : undefined
                                }
                                data-request-state={currentRequest.status}
                            >
                                {currentRequest.status === 'pending'
                                    ? 'Preparing a response…'
                                    : 'No assistant response was added.'}
                            </div>
                            {currentRequest.status === 'failed' && (
                                <button
                                    type="button"
                                    className="interaction-retry"
                                    onClick={() =>
                                        void submitUserMessage(
                                            currentRequest.userMessage
                                        )
                                    }
                                    disabled={isLoading}
                                >
                                    Retry question
                                </button>
                            )}
                        </div>
                    )}
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
