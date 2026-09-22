/**
 * @description: Presents the gated NYC September 11 records announcement and chat guidance.
 * @footnote-scope: web
 * @footnote-module: PublicContextNotice
 * @footnote-risk: low - This copy is optional and does not control chat routing.
 * @footnote-ethics: medium - Public source claims must remain bounded by actual backend readiness.
 */

import { Link } from 'react-router-dom';

export type PublicContextNoticeVariant = 'announcement' | 'guidance';

const examples = [
    'What do the records say about air quality after September 11?',
    'Find records discussing cleanup work near Ground Zero.',
    'What concerns from residents appear in the records?',
    'What do the records say about inspections of nearby buildings?',
];

/** Renders a small public notice only when the backend readiness gate is on. */
const PublicContextNotice = ({
    variant,
}: {
    variant: PublicContextNoticeVariant;
}): JSX.Element => {
    if (variant === 'announcement') {
        return (
            <aside
                className="public-context-notice public-context-notice--announcement"
                aria-labelledby="public-context-announcement-title"
            >
                <div>
                    <strong id="public-context-announcement-title">
                        New: Ask Footnote about the NYC September 11 records
                    </strong>
                    <p>
                        Footnote can search the records and show retrieved
                        sources you can inspect.
                    </p>
                </div>
                <Link to="/chat">Try it in chat →</Link>
            </aside>
        );
    }

    return (
        <aside
            className="public-context-notice public-context-notice--guidance"
            aria-labelledby="public-context-guidance-title"
        >
            <strong id="public-context-guidance-title">
                Try the NYC September 11 records
            </strong>
            <p>
                Ask naturally. Footnote can search the records when relevant and
                show retrieved sources you can inspect.
            </p>
            <ul aria-label="Example questions about the records">
                {examples.map((example) => (
                    <li key={example}>{example}</li>
                ))}
            </ul>
            <p className="public-context-notice__limit">
                Answers are based on the records currently indexed by Footnote.
                If the indexed records do not establish something, that does not
                mean the full archive contains no relevant evidence.
            </p>
        </aside>
    );
};

export default PublicContextNotice;
