/**
 * @description: Hosts the portable Footnote section and coordinates iframe sizing behavior for external sites.
 * @footnote-scope: web
 * @footnote-module: EmbedPage
 * @footnote-risk: medium - Embed sizing or messaging bugs can break integrations and hide the interactive surface.
 * @footnote-ethics: high - The embed experience affects how external users encounter prompts, responses, and provenance cues.
 */

import { useEffect, useRef } from 'react';
import CanonicalResponseFootnote from '@components/CanonicalResponseFootnote';
import Chat from '@components/Chat';
import MarkdownResponse from '@components/MarkdownResponse';
import { embedScenario } from '../data/embedScenario';
import {
    createEmbedHeightMessenger,
    EMBED_LAYOUT_CHANGE_EVENT,
} from '../utils/embedHeight';

const EmbedPage = (): JSX.Element => {
    const containerRef = useRef<HTMLElement | null>(null);

    // The parent resizes the iframe to this page; keep its own document from becoming a nested scroller.
    useEffect(() => {
        let injectedEmbedStyle = null;
        if (window.parent !== window) {
            injectedEmbedStyle = document.createElement('style');
            injectedEmbedStyle.textContent =
                'html, body { overflow: hidden !important; height: auto !important; min-height: 0 !important; }';
            document.head.appendChild(injectedEmbedStyle);
        }

        const messenger = createEmbedHeightMessenger({
            root: containerRef.current,
        });
        const scheduleHeightPost = (): void => {
            messenger.schedulePostHeight();
        };

        messenger.postHeight();

        const resizeObserver = new ResizeObserver(() => {
            scheduleHeightPost();
        });
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }
        resizeObserver.observe(document.body);
        resizeObserver.observe(document.documentElement);

        window.addEventListener('resize', scheduleHeightPost);
        window.addEventListener('load', scheduleHeightPost);
        window.addEventListener(EMBED_LAYOUT_CHANGE_EVENT, scheduleHeightPost);

        const fontSet = document.fonts;
        const fontReadyPromise = fontSet?.ready;
        fontReadyPromise
            ?.then(() => {
                scheduleHeightPost();
            })
            .catch(() => {
                scheduleHeightPost();
            });

        const settleTimeouts = [
            window.setTimeout(() => {
                messenger.postHeight();
            }, 0),
            window.setTimeout(() => {
                scheduleHeightPost();
            }, 100),
            window.setTimeout(() => {
                scheduleHeightPost();
            }, 300),
        ];

        return () => {
            injectedEmbedStyle?.remove();
            resizeObserver.disconnect();
            window.removeEventListener('resize', scheduleHeightPost);
            window.removeEventListener('load', scheduleHeightPost);
            window.removeEventListener(
                EMBED_LAYOUT_CHANGE_EVENT,
                scheduleHeightPost
            );
            settleTimeouts.forEach((timeoutId) =>
                window.clearTimeout(timeoutId)
            );
            messenger.dispose();
        };
    }, []);

    return (
        <div className="public-home public-home--embed">
            <main
                ref={containerRef}
                id="main-content"
                className="public-home__main public-home__main--embed"
            >
                <section
                    className="public-embed__intro"
                    aria-labelledby="embed-title"
                >
                    <p className="public-embed__brand">Footnote</p>
                    <h1 id="embed-title">AI that shows its work.</h1>
                    <p>You shouldn&apos;t have to take its word for it.</p>
                </section>

                <section
                    className="public-embed__example"
                    aria-labelledby="embed-example-title"
                >
                    <p className="public-embed__eyebrow">Recorded example</p>
                    <h2 id="embed-example-title">{embedScenario.question}</h2>
                    <article className="public-message public-message--assistant">
                        <MarkdownResponse
                            markdown={embedScenario.response.message}
                        />
                    </article>
                    <CanonicalResponseFootnote
                        metadata={embedScenario.response.metadata}
                        artifacts={{
                            trace: 'unavailable',
                            report: 'unavailable',
                        }}
                        answerProvenanceEligible={
                            embedScenario.response.answerProvenanceEligible
                        }
                    />
                </section>

                <section
                    className="public-embed__live"
                    aria-labelledby="embed-live-title"
                >
                    <h2 id="embed-live-title" className="public-embed__eyebrow">
                        Ask Footnote
                    </h2>
                    <div className="public-home__chat-shell">
                        <Chat />
                    </div>
                </section>

                <nav
                    className="public-embed__links"
                    aria-label="Footnote links"
                >
                    <a href="/" target="_blank" rel="noreferrer">
                        Open Footnote
                    </a>
                    <a href="/wiki/" target="_blank" rel="noreferrer">
                        Docs
                    </a>
                    <a
                        href="https://github.com/footnote-ai/footnote"
                        target="_blank"
                        rel="noreferrer"
                    >
                        GitHub
                    </a>
                </nav>
            </main>
        </div>
    );
};

export default EmbedPage;
