/**
 * @description: Shared narrow markdown-link citation recovery for runtime
 * adapters that receive retrieved text without structured citation metadata.
 * @footnote-scope: utility
 * @footnote-module: RuntimeCitationRecovery
 * @footnote-risk: medium - Parser drift can drop source links or emit malformed citation URLs.
 * @footnote-ethics: high - Preserving visible retrieval sources supports provenance transparency.
 */

export type RuntimeCitation = {
    title: string;
    url: string;
    snippet?: string;
};

/**
 * Numeric markdown footnote markers are not useful user-facing titles.
 */
export const normalizeRecoveredCitationTitle = (label: string): string => {
    const normalizedLabel = label.trim();

    return /^\d+$/.test(normalizedLabel) ? 'Source' : normalizedLabel;
};

/**
 * Recovers visible markdown links when retrieved output lacks structured
 * citation annotations.
 *
 * This intentionally stays narrow: only markdown links are preserved here.
 * Bare URLs are out of scope because they are more likely to capture incidental
 * text.
 */
export const extractMarkdownLinkCitations = (
    text: string
): RuntimeCitation[] => {
    const citations: RuntimeCitation[] = [];
    const seenUrls = new Set<string>();
    let cursor = 0;

    while (cursor < text.length) {
        const labelStart = text.indexOf('[', cursor);
        if (labelStart === -1) {
            break;
        }
        const labelEnd = text.indexOf(']', labelStart + 1);
        if (labelEnd === -1) {
            break;
        }
        const urlStart = labelEnd + 1;
        if (text[urlStart] !== '(') {
            cursor = labelStart + 1;
            continue;
        }

        let parenthesisDepth = 0;
        let urlEnd = -1;
        for (let index = urlStart; index < text.length; index += 1) {
            const character = text[index];
            if (character === '(') {
                parenthesisDepth += 1;
                continue;
            }
            if (character === ')') {
                parenthesisDepth -= 1;
                if (parenthesisDepth === 0) {
                    urlEnd = index;
                    break;
                }
            }
        }
        if (urlEnd === -1) {
            cursor = labelStart + 1;
            continue;
        }

        const rawLabel = text.slice(labelStart + 1, labelEnd);
        const rawUrl = text.slice(urlStart + 1, urlEnd).trim();
        if (
            typeof rawLabel !== 'string' ||
            rawLabel.trim().length === 0 ||
            typeof rawUrl !== 'string'
        ) {
            cursor = urlEnd + 1;
            continue;
        }

        let normalizedUrl: string;
        try {
            const parsedUrl = new URL(rawUrl);
            if (
                parsedUrl.protocol !== 'http:' &&
                parsedUrl.protocol !== 'https:'
            ) {
                cursor = urlEnd + 1;
                continue;
            }
            normalizedUrl = parsedUrl.toString();
        } catch {
            cursor = urlEnd + 1;
            continue;
        }

        if (seenUrls.has(normalizedUrl)) {
            cursor = urlEnd + 1;
            continue;
        }

        seenUrls.add(normalizedUrl);
        citations.push({
            title: normalizeRecoveredCitationTitle(rawLabel),
            url: normalizedUrl,
        });
        cursor = urlEnd + 1;
    }

    return citations;
};
