# Embedding Footnote

The `/embed` route gives other sites a compact, self-contained Footnote experience. It uses:

- The Footnote wordmark and “AI that shows its work.” branding.
- Header links to the full site, documentation, and GitHub, followed by the shared theme toggle.
- Every prepared landing response, selected with previous/next controls and a position counter.
- The same full `CanonicalResponseFootnote` used elsewhere, including its evidence, sensitivity, licensing, TRACE, and disclosure controls.
- The shared live chat directly below the examples.

The selected prepared response is separate from a visitor's conversation. Its response text and metadata are captured together by `pnpm generate-landing-scenarios -- --scenario-id inspect-an-answer`; that command refreshes this example while preserving the other prepared responses. For the introduction, the displayed question stays short while the capture metadata records the full submitted prompt. The prompt asks for three sentences under 80 words; the generator warns if an answer is longer and rejects only empty answers or those over 100 words. Editing a question or answer without a new capture would misrepresent the recorded provenance. Trace and Report actions remain unavailable for prepared responses, with their existing disabled controls.

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

The `min-height` is a starting size, not a limit. The embed sends its whole-document height, including the header, to the parent page on load and when the layout changes. A host that handles those messages can resize the iframe as the visitor changes examples, opens response details, or uses the chat.

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
- `packages/web/src/utils/embedHeight.ts` owns height measurement and messaging. The embed measures its outer page wrapper so the report includes the header as well as the main content. Framing and CORS rules remain backend configuration.
