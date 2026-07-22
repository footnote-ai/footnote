# Landing SPA Overhaul

Status: closed. The original plan was superseded by the smaller public homepage
and public-surface cutovers shipped in July 2026.

Completed: 2026-07-18.

Delivered by:

- `1440e168` / pull request #438, `feat(web): ship public homepage cutover`;
- `65197031` / pull request #441, `feat(web): complete public surface cutover`.

The maintained implementation description now lives in
[`docs/architecture/public-web-surfaces.md`](../../architecture/public-web-surfaces.md).

## Original intent

The original tracker proposed a large landing-page redesign built around an
answer carousel, a composer, live session pages, compact receipts, expanded
provenance explanations, and several permanent editorial sections. It also
proposed ten implementation branches to deliver and harden those pieces.

That sequence was not followed. The public web work converged on a smaller
surface with clearer route ownership instead.

## Delivered shape

The shipped public surface:

- gives `/` a focused editorial homepage with selectable prepared answers;
- keeps prepared homepage answers visibly separate from live execution;
- sends live questions to the dedicated `/chat` route;
- uses the shared `Chat` component for `/chat` and `/embed`;
- keeps backend APIs authoritative for live responses and their metadata;
- validates checked-in JSON homepage fixtures with `PostChatResponseSchema`;
- uses a shared public header, footer, theme, and layout across public routes;
- preserves embed height messaging and route-specific presentation.

Prepared homepage answers render an empty trace-footer position rather than
claiming that a captured trace is still live. Live chat renders provenance only
from metadata returned through the backend-owned chat path.

## Superseded scope

The following ideas from the original tracker did not ship and are not active
requirements:

- a homepage composer and session-created live carousel pages;
- swipe, side-control, and keyboard carousel navigation;
- running, failed, and disabled composer pages in the homepage carousel;
- a new compact-receipt display model;
- expanded `Where it came from`, `What happened along the way`, and
  `How the answer was shaped` homepage sections;
- the proposed `Confident does not mean correct` and `You steer the ship`
  sections;
- TypeScript-owned prepared fixtures;
- the original ten-branch implementation sequence and acceptance checklist.

If product work revives one of these ideas, it should start as a new focused
proposal checked against the current public route structure. This completed
record should not be reopened as an implementation tracker.

## Lasting decisions

- The homepage introduces Footnote with prepared content. It does not own live
  chat submission.
- `/chat` owns the first-party live chat experience.
- `/embed` reuses the same live `Chat` behavior while retaining embed-specific
  sizing and surrounding copy.
- Prepared content must not imply live execution or a durable trace link.
- Public web surfaces continue to use `packages/backend` as their runtime
  boundary.
