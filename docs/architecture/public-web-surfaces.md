# Public Web Surfaces

This document describes the current route and ownership boundaries for
Footnote's public web client.

## Runtime boundary

`packages/backend` remains the public runtime boundary. The web package calls
backend APIs for live behavior and displays response metadata returned through
that boundary. It does not independently record LLM cost or create provenance.

## Route roles

| Route                     | Owner                                        | Purpose                                                                          |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `/`                       | `PublicHomePage`                             | Introduces Footnote with prepared answers and practical project links.           |
| `/chat`                   | `ChatPage` and `Chat`                        | Runs the first-party live question flow.                                         |
| `/embed`                  | `EmbedPage` and `Chat`                       | Provides the live flow inside an externally sized embed page.                    |
| `/setup`                  | `SetupPage`                                  | Hosts first-setup behavior.                                                      |
| `/account`                | `AccountPage`                                | Hosts public account sign-in and local session status.                           |
| `/admin`                  | `AdminPage`                                  | Hosts the admin settings interface; backend authorization remains authoritative. |
| `/wiki/`                  | Astro/Starlight and backend static transport | Publishes repository-owned documentation without moving SPA routes.              |
| `/traces/:responseId`     | `TracePage`                                  | Displays an available response trace.                                            |
| `/api/traces/:responseId` | `TracePage`                                  | Preserves the web trace-page route used under the API-shaped path.               |

`App.tsx` owns the React route map. React non-home routes use
`PublicPageLayout` for a consistent public header and footer. The `/wiki/`
route is owned by the static Astro/Starlight and backend transport surface.
The homepage composes the same public header and footer directly around its
own page layout.

## Prepared homepage answers

The homepage loads the ordered fixtures in
`packages/web/src/data/landingScenarioFixtures.json` through
`landingScenarios.ts`. The loader validates every response with
`PostChatResponseSchema` and exposes only the runtime scenario fields; capture
notes stay out of the rendered scenario.

A visitor can choose among prepared answers with the page's selector dots. The
homepage presents the question on the right and the prepared answer on the
left inside a chat-compatible shell, followed by the canonical response
footnote using the fixture's captured metadata. The fixture's Trace and Report
artifacts remain unavailable, so the rendered controls expose those states
honestly rather than implying a durable live trace. The page labels the
content as prepared and points to `/chat` for live use; the handoff is a link,
not a second homepage chat implementation.

The NYC September 11 announcement slot is present in the shell but remains
hidden until the normal `/api/chat` source is enabled. The homepage does not
claim archive retrieval or add a browser-selected target.

## Live chat

`Chat` owns the shared live interaction used by both `/chat` and `/embed`. It:

- loads prepared landing conversations through the backend API;
- manages runtime Turnstile configuration and token state;
- submits questions through `api.chatQuestion`;
- owns request, abort, timeout, and local error state;
- renders `ProvenanceFooter` only when an answer and response metadata are
  available.

Failure to load a prepared conversation does not block live chat. The component
clears the unavailable prepared state and leaves the primary interaction open.
This preserves Footnote's fail-open behavior.

`ChatPage` gives that interaction a dedicated first-party route. `EmbedPage`
reuses it instead of copying submission behavior.

## Embed behavior

`EmbedPage` adds explanatory and setup content around `Chat`. When it runs in an
iframe, `createEmbedHeightMessenger` reports layout changes to the host. The
embed observes content and viewport changes, posts settled heights, and removes
its listeners and observers during cleanup.

The embed can have route-specific copy and layout. It should not fork the chat
request path or become dependent on homepage-only prepared-answer behavior.

## Public presentation

The public homepage and standalone public pages share the semantic color,
typography, focus, and dark-mode treatment in the web style layers. The shared
shell keeps navigation recognizable without moving route behavior into layout
components.

Prepared and live content must remain visually and semantically distinct:

- prepared homepage content must not imply that a live run occurred;
- live response details must come from backend-returned metadata;
- trace navigation must only appear when the existing response-detail logic can
  build a valid destination.

## Source map

- `packages/web/src/App.tsx`
- `packages/web/src/pages/PublicHomePage.tsx`
- `packages/web/src/pages/ChatPage.tsx`
- `packages/web/src/pages/EmbedPage.tsx`
- `packages/web/src/components/Chat.tsx`
- `packages/web/src/components/PublicPageLayout.tsx`
- `packages/web/src/data/landingScenarios.ts`
- `packages/web/src/utils/embedHeight.ts`

## Web style layers

The shared web styles are composed from `packages/web/src/styles/index.css`.
Reusable design constants live in `design-constants.css`, light/dark semantic
mapping lives in `theme-map.css`, and component/page rules live in
`account.css`, `interaction.css`, `motion-accessibility.css`, `provenance.css`,
`public-home.css`, `reset-base.css`, `response-carousel.css`, `setup.css`,
`trace.css`, and `typography.css`.
