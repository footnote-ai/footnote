# Embedding Footnote

This page documents the `/embed` route used by external iframe hosts.

## What the embed route is

`/embed` is a maintained product surface, not a temporary demo page.

It renders:

- shared site header
- embed-specific landing content sections (`about`, `demo`, `get-started`)
- interactive `AskMeAnything` form
- shared site footer

The `get-started` section links users to GitHub Releases and README quickstart.

## Route and navigation behavior

- Route: `/embed`
- Header section links use hash anchors (`#about`, `#demo`, `#get-started`).
- When the URL includes a hash, the route scrolls that section into view on load.
- The embed keeps the same public chat interaction behavior as the main web flow.

## Host integration contract

Use an iframe that points to your deployed Footnote web origin:

```html
<iframe
    id="footnote-embed"
    src="https://<your-footnote-web-origin>/embed"
    style="width: 100%; border: 0; min-height: 800px;"
    allow="clipboard-read; clipboard-write"
    title="Footnote embed"
></iframe>
```

For production, keep the iframe host origin allowlists aligned with backend CORS/CSP settings (`ALLOWED_ORIGINS`, `FRAME_ANCESTORS`).

## Height messaging contract

The embed posts parent-window `postMessage` height updates.

Message types:

- `footnote-embed-height` (primary)
- `arete-embed-height` (legacy compatibility)

Payload shape:

```json
{ "type": "footnote-embed-height", "height": 1234 }
```

When messages are emitted:

- initial load
- browser resize
- DOM/layout mutations
- explicit layout change events from interactive components

Parent pages should:

- listen for `message` events
- validate `event.origin`
- update iframe `style.height` when message type matches

## Product behavior vs implementation detail

Treat these as stable behavior contracts:

- `/embed` route exists and is iframe-safe
- height messages are emitted with the types above
- the route contains a working ask flow plus start links

Treat these as implementation details (do not depend on exact values):

- exact hero/CTA copy
- CSS class names and spacing
- internal observer/timer strategy used to detect layout changes

## Operational notes

- Shared layered web styles are imported from
  `packages/web/src/styles/index.css`.
- At narrow widths, embed content stacks vertically. Keep the iframe container at
  `width: 100%` and avoid CSS transforms that force zoom or horizontal scroll.
- Prefer dynamic height from embed messages. If a host uses a fixed fallback
  height, use at least `800px`.
- If height updates do not work, confirm the iframe id, message listener,
  `event.origin` validation, and iframe scrolling/overflow settings.
- `/api/chat` rate limiting, Cloudflare Turnstile configuration, and focus
  behavior still apply inside the embedded ask flow.
- Header and CTA links may navigate inside the iframe unless the host or route
  sets a parent/new-tab target.
- The root `server.js` file is only a startup shim. Backend CORS and CSP
  behavior belongs in backend runtime configuration and server code.

## Maintenance notes

When updating embed UI, keep this doc in sync with:

- `packages/web/src/pages/EmbedPage.tsx`
- `packages/web/src/utils/embedHeight.ts`
- shared nav/footer behavior in `packages/web/src/components`

If message types or payload shape change, update host integrations and this doc in the same branch.
