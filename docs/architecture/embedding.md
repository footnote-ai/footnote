# Embedding Footnote

The `/embed` route lets other sites include a complete Footnote section without rebuilding the introduction or chat interface. It shows:

- Footnote's existing headline and supporting line.
- A recorded answer with its original response metadata and the usual provenance footer.
- A separate, working chat.
- Links to Footnote, its documentation, and GitHub.

The recorded answer is separate from a visitor's conversation. Its original response details remain available, including sources, workflow information, and TRACE values. The stored example cannot open its full Trace view or use the Report action.

## Add it to a site

Point an iframe at the Footnote web origin:

```html
<iframe
    id="footnote-embed"
    src="https://<your-footnote-web-origin>/embed"
    style="width: 100%; min-height: 42rem; border: 0;"
    allow="clipboard-read; clipboard-write"
    title="Footnote"
></iframe>
```

The `min-height` is a starting size, not a limit. The embed sends its content height to the parent page on load and when the layout changes. A host that handles those messages can resize the iframe as the visitor opens response details or uses the chat.

If the host doesn't handle resize messages, visitors can still scroll inside the iframe. Keep normal iframe scrolling available as a fallback rather than hiding overflow or clipping the footer.

In production, add each embedding site's exact origin to the backend `FRAME_ANCESTORS` CSP setting. The apex (`https://jordanmakes.dev`) and `www` (`https://www.jordanmakes.dev`) hostnames are different origins and must be listed separately. `ALLOWED_ORIGINS` is for cross-origin API requests; the iframe itself does not need a CORS exception.

## Resize messages

Footnote sends `footnote-embed-height` messages with this payload:

```json
{ "type": "footnote-embed-height", "height": 1234 }
```

Messages are sent on initial load, browser resize, observed layout changes, and explicit layout updates from interactive components. Footnote sends them only to the origin it can determine from `document.referrer`. If that origin is missing or opaque, it doesn't send a message.

Hosts must check both `event.origin` and `event.source` before using the reported height. For example:

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

## Notes

- The embed uses the shared web styles from `packages/web/src/styles/index.css`. It stacks vertically at narrow widths.
- When resize messages are working, let the iframe follow its content height without a maximum-height cap. Otherwise, keep a usable fixed height and allow scrolling.
- Live chat still uses the normal `/api/chat` rate limits, Cloudflare Turnstile checks, and keyboard behavior.
- `packages/web/src/utils/embedHeight.ts` owns height measurement and messaging. Framing and CORS rules remain backend configuration.
