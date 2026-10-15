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
import PublicHeader from '@components/PublicHeader';
import { landingScenarios } from '../data/landingScenarios';
import {
    createEmbedHeightMessenger,
    EMBED_LAYOUT_CHANGE_EVENT,
} from '../utils/embedHeight';

const EmbedPage = (): JSX.Element => {
    const containerRef = useRef<HTMLElement | null>(null);
    const example = landingScenarios[0];

    if (!example) {
        throw new Error(
            'The public embed requires a prepared landing example.'
        );
    }

    // A parent that applies these measurements keeps the iframe content-sized without a nested scroller.
    useEffect(() => {
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
            <PublicHeader />
            <main
                ref={containerRef}
                id="main-content"
                className="public-home__main public-home__main--embed"
            >
                <section
                    className="public-home__intro public-embed__intro"
                    aria-labelledby="embed-title"
                >
                    <h1 id="embed-title">
                        <span className="public-home__hero-title-line">
                            AI that
                        </span>{' '}
                        <span className="public-home__hero-title-line">
                            <em>shows its work.</em>
                        </span>
                    </h1>
                    <p>
                        See how an answer was made, set your own rules, and run
                        Footnote your way.
                    </p>
                </section>

                <section
                    className="public-embed__example"
                    aria-labelledby="embed-example-title"
                >
                    <h2 id="embed-example-title">{example.question}</h2>
                    <article className="public-message public-message--assistant">
                        <MarkdownResponse
                            markdown={example.response.message}
                            linksOpenInNewTab
                        />
                    </article>
                    <CanonicalResponseFootnote
                        metadata={example.response.metadata}
                        artifacts={{
                            trace: 'unavailable',
                            report: 'unavailable',
                        }}
                    />
                </section>

                <section className="public-embed__live" aria-label="Live chat">
                    <div className="public-home__chat-shell">
                        <Chat placeholder="Ask a question…" />
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
