/**
 * @description: Renders agent response markdown for the web demo without allowing raw HTML.
 * @footnote-scope: web
 * @footnote-module: MarkdownResponse
 * @footnote-risk: low - Formatting changes are scoped to response display.
 * @footnote-ethics: medium - Response rendering affects how transparently users can inspect model output.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownResponseProps = {
    markdown: string;
    linksOpenInNewTab?: boolean;
};

const MarkdownResponse = ({
    markdown,
    linksOpenInNewTab = false,
}: MarkdownResponseProps): JSX.Element => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={
            linksOpenInNewTab
                ? {
                      a: (props) => (
                          <a {...props} target="_blank" rel="noreferrer" />
                      ),
                  }
                : undefined
        }
    >
        {markdown}
    </ReactMarkdown>
);

export default MarkdownResponse;
