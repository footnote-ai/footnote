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
import ResponseCarousel from '@components/ResponseCarousel';
import { landingScenarios } from '../data/landingScenarios';
import {
    createEmbedHeightMessenger,
    EMBED_LAYOUT_CHANGE_EVENT,
} from '../utils/embedHeight';

const EmbedPage = (): JSX.Element => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    if (landingScenarios.length === 0) {
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
        <div ref={containerRef} className="public-home public-home--embed">
            <PublicHeader variant="embed" />
            <main
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
                </section>

                <section
                    className="public-embed__example"
                    aria-label="Prepared responses"
                >
                    <ResponseCarousel
                        items={landingScenarios}
                        ariaLabel="Prepared responses"
                        getKey={(scenario) => scenario.id}
                        getDotLabel={(scenario, index) =>
                            `Show prepared response ${index + 1}: ${scenario.question}`
                        }
                        showPreviousNextControls
                        showPosition
                        previousLabel="Show previous example"
                        nextLabel="Show next example"
                        className="public-home__response"
                        dotsClassName="public-embed__scenario-dots"
                        dotClassName="public-embed__scenario-dot"
                        selectedDotClassName="public-embed__scenario-dot--selected"
                        renderItem={(scenario) => (
                            <h2 className="public-embed__question">
                                {scenario.question}
                            </h2>
                        )}
                        renderItemAfterNavigation={(scenario) => (
                            <>
                                <article className="public-message public-message--assistant">
                                    <MarkdownResponse
                                        markdown={scenario.response.message}
                                        linksOpenInNewTab
                                    />
                                </article>
                                <CanonicalResponseFootnote
                                    metadata={scenario.response.metadata}
                                    artifacts={{
                                        trace: 'unavailable',
                                        report: 'unavailable',
                                    }}
                                />
                            </>
                        )}
                    />
                </section>

                <section className="public-embed__live" aria-label="Live chat">
                    <div className="public-home__chat-shell">
                        <Chat placeholder="Ask a question…" />
                    </div>
                </section>
            </main>
        </div>
    );
};

export default EmbedPage;
