/**
 * @description: Renders the public homepage footer with project and community destinations.
 * @footnote-scope: web
 * @footnote-module: PublicFooter
 * @footnote-risk: low - Footer failures affect discoverability but not application behavior.
 * @footnote-ethics: low - Public project links support access to governance and discussion resources.
 */

type PublicFooterProps = {
    /** Homepage presentation uses concise reference labels without changing destinations. */
    homepage?: boolean;
};

const PublicFooter = ({ homepage = false }: PublicFooterProps): JSX.Element => (
    <footer className="public-footer">
        <div className="public-footer__inner">
            <span className="public-footer__mark">
                Footnote<sup>[1]</sup>
            </span>
            <nav className="public-footer__links" aria-label="Footer">
                <a href="/wiki/">Docs</a>
                <a
                    href="https://github.com/footnote-ai/footnote"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
                <a href="/wiki/philosophy/#licensing-and-its-tension">
                    {homepage ? 'Licensing' : 'Licenses'}
                </a>
                <a href="/wiki/security/">
                    {homepage ? 'Privacy' : 'Security & privacy'}
                </a>
            </nav>
        </div>
    </footer>
);

export default PublicFooter;
