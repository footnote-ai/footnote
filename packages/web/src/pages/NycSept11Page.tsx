/**
 * @description: Hosts the signed-in, bounded NYC September 11 archive preview.
 * @footnote-scope: web
 * @footnote-module: NycSept11Page
 * @footnote-risk: medium - Scope or sign-in copy errors can mislead users about archive coverage.
 * @footnote-ethics: high - Historical answers must remain visibly incomplete and source-bounded.
 */

import Chat from '@components/Chat';
import PublicPageLayout from '@components/PublicPageLayout';

const NycSept11Page = (): JSX.Element => (
    <PublicPageLayout>
        <main id="main-content" className="public-page__main">
            <section
                className="public-page__intro"
                aria-labelledby="nyc-sept11-title"
            >
                <h1 id="nyc-sept11-title">NYC September 11 archive preview</h1>
                <p className="public-page__lede">
                    Explore a bounded preview of 49 indexed documents. This is
                    not the complete archive; answers are limited to the
                    retrieved excerpts and include document and page citations.
                </p>
                <p>
                    <a href="/account">Sign in</a> is required because this
                    preview uses a metered model.
                </p>
                <div aria-label="Suggested archive questions">
                    <p>Try asking:</p>
                    <ul>
                        <li>
                            What does this collection say about the early
                            response?
                        </li>
                        <li>Which agencies appear in the retrieved records?</li>
                        <li>
                            What is not established by these indexed records?
                        </li>
                    </ul>
                </div>
                <Chat experienceId="nyc-sept11" />
            </section>
        </main>
    </PublicPageLayout>
);

export default NycSept11Page;
