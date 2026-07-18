/**
 * @description: Hosts the embeddable Footnote page and coordinates iframe sizing behavior for external sites.
 * @footnote-scope: web
 * @footnote-module: EmbedPage
 * @footnote-risk: medium - Embed sizing or messaging bugs can break integrations and hide the interactive surface.
 * @footnote-ethics: high - The embed experience affects how external users encounter prompts, responses, and provenance cues.
 */

import { useEffect, useRef } from 'react';
import PublicPageLayout from '@components/PublicPageLayout';
import Chat from '@components/Chat';
import {
    createEmbedHeightMessenger,
    EMBED_LAYOUT_CHANGE_EVENT,
} from '../utils/embedHeight';

/**
 * EmbedPage component provides a compact embeddable Footnote experience that mirrors
 * the main sections used on the primary SPA route.
 */
const EmbedPage = (): JSX.Element => {
    const containerRef = useRef<HTMLElement | null>(null);

    // Disable scrolling on the embed page itself and keep the host iframe sized to the content.
    useEffect(() => {
        let injectedEmbedStyle = null;
        if (window.parent !== window) {
            injectedEmbedStyle = document.createElement('style');
            injectedEmbedStyle.textContent = `
        html, body {
          overflow: hidden !important;
          height: auto !important;
        }
      `;
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

    useEffect(() => {
        if (!containerRef.current || !window.location.hash) {
            return;
        }

        const rawTargetId = window.location.hash.slice(1).trim();
        if (rawTargetId.length === 0) {
            return;
        }

        let targetId: string;
        try {
            targetId = decodeURIComponent(rawTargetId).trim();
        } catch {
            return;
        }

        if (targetId.length === 0) {
            return;
        }

        const sectionElement = document.getElementById(targetId);
        if (!sectionElement) {
            return;
        }

        sectionElement.scrollIntoView({ block: 'start' });
    }, []);

    return (
        <PublicPageLayout>
            <main
                ref={containerRef}
                id="main-content"
                className="public-page__main public-page__main--embed"
            >
                <section
                    id="about"
                    className="public-page__intro"
                    aria-labelledby="embed-about-title"
                >
                    <h1 id="embed-about-title">
                        Footnote, anywhere you need it.
                    </h1>
                    <p className="public-page__lede">
                        Footnote is a transparency-first AI framework that helps
                        keep answers inspectable, understandable, and easier to
                        steer.
                    </p>
                    <p>
                        It can show useful context around responses, including
                        sources and trace links when available, while staying
                        practical to self-host.
                    </p>
                </section>

                <section
                    id="demo"
                    className="public-page__section"
                    aria-labelledby="embed-demo-title"
                >
                    <div>
                        <h2 id="embed-demo-title">Chat from your own page.</h2>
                        <p className="public-page__lede">
                            Run a live prompt and inspect the response details.
                        </p>
                        <Chat />
                    </div>
                </section>

                <section
                    id="get-started"
                    className="public-page__section"
                    aria-labelledby="embed-start-title"
                >
                    <h2 id="embed-start-title">
                        Go from embed to local runtime.
                    </h2>
                    <p className="public-page__lede">
                        Install the CLI launcher from GitHub Releases to run
                        Footnote with your own setup.
                    </p>
                    <div className="public-page__actions">
                        <a
                            className="public-page__action public-page__action--primary"
                            href="https://github.com/footnote-ai/footnote/releases"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Download Footnote
                        </a>
                        <a
                            className="public-page__action"
                            href="https://github.com/footnote-ai/footnote#quickstart"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Quickstart
                        </a>
                    </div>
                </section>
            </main>
        </PublicPageLayout>
    );
};

export default EmbedPage;
