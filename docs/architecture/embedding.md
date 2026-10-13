# Embedding Footnote

/embed is a compact, portable Footnote section for external pages.

## What the embed contains

The route renders, in order:

- Footnote branding and the line “AI that shows its work.”
- One recorded question and response captured from the canonical chat endpoint, with the shared response-footnote component.
- A separate, interactive chat.
- Links to Footnote, its documentation, and GitHub.

The recorded response retains the metadata from its real run. Trace and report artifacts that are unavailable on this public surface remain unavailable; the embed does not simulate them. The route does not include the main site navigation, footer, installation pitch, or hash-linked sections.

## Host integration

Embed the deployed Footnote web origin. Let the iframe grow to the measured content height rather than setting a fixed height or a maximum height:

```html
<iframe
    id="footnote-embed"
    src="https://<your-footnote-web-origin>/embed"
    style="width: 100%; min-height: 42rem; border: 0;"
    allow="clipboard-read; clipboard-write"
    title="Footnote"
></iframe>
```

The min-height is only a pre-message fallback. The iframe reports its full content height as it loads and whenever the response, disclosure, viewport, or layout changes. Hosts should apply the reported height without adding an internal scroll area or a height cap; all response content and provenance disclosures should remain reachable.

The embed keeps normal document scrolling available when the host does not process resize messages or the child cannot determine a safe parent origin from its referrer. In that case, visitors can scroll inside the iframe to reach the complete answer, provenance, live chat, and links. Do not hide iframe document overflow.

For production, keep the iframe host origin allowlists aligned with backend CORS/CSP settings (ALLOWED_ORIGINS, FRAME_ANCESTORS).

## Height messaging contract

The embed sends parent-window postMessage updates with these types:

- footnote-embed-height (primary)
- arete-embed-height (legacy)

Payload shape:

```json
{ "type": "footnote-embed-height", "height": 1234 }
```

Updates are sent on initial load, browser resize, observed layout changes, and explicit layout-change events from interactive components. The embed sends only to the origin derived from document.referrer; an absent or opaque parent origin is not trusted.

The host must validate both the sender origin and the iframe window before applying a height. For example:

```js
const iframe = document.querySelector('#footnote-embed');
const embedOrigin = new URL(iframe.src).origin;

window.addEventListener('message', (event) => {
    if (
        event.origin !== embedOrigin ||
        event.source !== iframe.contentWindow ||
        !event.data ||
        typeof event.data !== 'object' ||
        event.data.type !== 'footnote-embed-height' ||
        !Number.isFinite(event.data.height) ||
        event.data.height <= 0
    ) {
        return;
    }

    iframe.style.height = Math.ceil(event.data.height) + 'px';
});
```

## Operational notes

- Shared layered web styles are imported from packages/web/src/styles/index.css.
- At narrow widths, the embed stacks vertically. When resize messages work, keep the iframe content-sized and avoid nested scrollbars. If the host cannot resize it, leave a usable fixed iframe height and allow the embedded document to scroll as a fallback.
- /api/chat rate limiting, Cloudflare Turnstile configuration, and keyboard focus behavior still apply to the live chat.
- packages/web/src/utils/embedHeight.ts owns the child-side measurement and message contract. Backend CORS and CSP behavior belongs in backend runtime configuration and server code.
