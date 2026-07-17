/**
 * @description: Renders the public homepage footer with project and community destinations.
 * @footnote-scope: web
 * @footnote-module: PublicFooter
 * @footnote-risk: low - Footer failures affect discoverability but not application behavior.
 * @footnote-ethics: low - Public project links support access to governance and discussion resources.
 */

const PublicFooter = (): JSX.Element => (
    <footer className="public-footer">
        <a
            href="https://github.com/footnote-ai/footnote"
            target="_blank"
            rel="noreferrer"
        >
            Get in touch
        </a>
        <a
            href="https://github.com/footnote-ai/footnote/discussions"
            target="_blank"
            rel="noreferrer"
        >
            Join the discussion
        </a>
        <a
            href="https://github.com/footnote-ai/footnote/blob/main/docs/Philosophy.md"
            target="_blank"
            rel="noreferrer"
        >
            Philosophy
        </a>
    </footer>
);

export default PublicFooter;
