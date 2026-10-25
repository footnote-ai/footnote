/**
 * @description: Renders the compact public header and its project destinations.
 * @footnote-scope: web
 * @footnote-module: PublicHeader
 * @footnote-risk: low - Header failures affect navigation but not response or trace data.
 * @footnote-ethics: low - Clear public destinations reduce confusion about available account features.
 */

import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

type PublicHeaderProps = {
    variant?: 'default' | 'embed';
};

const ExternalLinkIcon = (): JSX.Element => (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
        <path d="M9 2h5v5M14 2 7 9" />
        <path d="M12 9v4H3V4h4" />
    </svg>
);

const PublicHeader = ({
    variant = 'default',
}: PublicHeaderProps): JSX.Element => (
    <header className="public-header">
        {variant === 'embed' ? (
            <a
                className="public-header__mark"
                href="/"
                target="_blank"
                rel="noreferrer"
            >
                Footnote<sup>[1]</sup>
            </a>
        ) : (
            <Link className="public-header__mark" to="/">
                Footnote<sup>[1]</sup>
            </Link>
        )}
        {variant === 'embed' ? (
            <nav
                aria-label="Footnote links"
                className="public-header__embed-nav"
            >
                {[
                    ['Full site', '/'],
                    ['Docs', '/wiki/'],
                    ['GitHub', 'https://github.com/footnote-ai/footnote'],
                ].map(([label, href]) => (
                    <a key={label} href={href} target="_blank" rel="noreferrer">
                        {label}
                        <ExternalLinkIcon />
                    </a>
                ))}
                <ThemeToggle />
            </nav>
        ) : (
            <nav aria-label="Primary">
                <Link to="/chat">Chat</Link>
                <a href="/wiki/">Docs</a>
                <a
                    href="https://github.com/footnote-ai/footnote"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
                <Link to="/account">Account</Link>
                <ThemeToggle />
            </nav>
        )}
    </header>
);

export default PublicHeader;
