/**
 * @description: Hosts Footnote's first-party public chat experience.
 * @footnote-scope: web
 * @footnote-module: ChatPage
 * @footnote-risk: medium - Chat-page failures can block public access to the backend chat flow.
 * @footnote-ethics: high - The page must preserve provenance cues for live public responses.
 */

import Chat from '@components/Chat';
import PublicPageLayout from '@components/PublicPageLayout';

/** Renders the live public chat route without changing backend chat authority. */
const ChatPage = (): JSX.Element => (
    <PublicPageLayout>
        <main id="main-content" className="public-page__main">
            <section
                className="public-page__intro"
                aria-labelledby="chat-title"
            >
                <h1 id="chat-title">Chat</h1>
                <p className="public-page__lede">
                    Ask anything, and see how Footnote responds!
                </p>
                <Chat />
            </section>
        </main>
    </PublicPageLayout>
);

export default ChatPage;
