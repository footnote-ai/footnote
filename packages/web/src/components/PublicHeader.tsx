/**
 * @description: Renders the compact public homepage header and its project destinations.
 * @footnote-scope: web
 * @footnote-module: PublicHeader
 * @footnote-risk: low - Header failures affect navigation but not response or trace data.
 * @footnote-ethics: low - Clear public destinations reduce confusion about available account features.
 */

import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

type PublicHeaderProps = {
    /** Homepage presentation omits the account link while retaining global controls. */
    homepage?: boolean;
};

const PublicHeader = ({ homepage = false }: PublicHeaderProps): JSX.Element => (
    <header className="public-header">
        <Link className="public-header__mark" to="/">
            Footnote<sup>[1]</sup>
        </Link>
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
            {!homepage && <Link to="/account">Sign in</Link>}
            <ThemeToggle />
        </nav>
    </header>
);

export default PublicHeader;
