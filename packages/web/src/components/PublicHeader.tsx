/**
 * @description: Renders the compact public homepage header and its project destinations.
 * @footnote-scope: web
 * @footnote-module: PublicHeader
 * @footnote-risk: low - Header failures affect navigation but not response or trace data.
 * @footnote-ethics: low - Clear public destinations reduce confusion about available account features.
 */

import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

const PublicHeader = (): JSX.Element => (
    <header className="public-header">
        <Link className="public-header__mark" to="/">
            FOOTNOTE
        </Link>
        <nav aria-label="Primary">
            <a
                href="https://github.com/footnote-ai/footnote"
                target="_blank"
                rel="noreferrer"
            >
                GitHub
            </a>
            <a
                href="https://deepwiki.com/footnote-ai/footnote"
                target="_blank"
                rel="noreferrer"
            >
                Wiki
            </a>
            <span
                className="public-header__unavailable"
                tabIndex={0}
                aria-disabled="true"
                aria-describedby="sign-in-unavailable-message"
            >
                Sign in
                <span
                    className="public-header__unavailable-icon"
                    aria-hidden="true"
                >
                    ⚠
                </span>
                <span
                    id="sign-in-unavailable-message"
                    className="public-header__unavailable-tooltip"
                    role="tooltip"
                >
                    Sign-in is not available yet.
                </span>
            </span>
            <ThemeToggle />
        </nav>
    </header>
);

export default PublicHeader;
