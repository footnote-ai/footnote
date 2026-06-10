# Footnote Landing SPA Overhaul Status

Current purpose: active status tracker and working design source of truth for the landing SPA overhaul.

Overall status: draft plan, not started.

Current branch: none yet.

Last completed branch: none yet.

Last updated: 2026-06-10.

Initial file path: `docs/proposals/landing-spa-overhaul-status.md`.

This document should stay in `docs/proposals/` while the overhaul is underway. After the work is complete, remove the branch tracker, temporary notes, blockers, and resolved questions. Move the remaining narrative to its long-lived home, likely under `docs/architecture/` or another docs path chosen after the implemented shape is known.

Future editors should preserve the writing style here: plain, specific, and close to the product. Avoid vague design language, inflated section names, and repeated slogans. Explain what someone sees, what happens when they interact, what the code owns, and why a decision exists.

Completed branch sections should remain in this tracker as a brief record until the final documentation conversion. Do not delete them branch by branch. The notes fields are for decisions, discoveries, and follow-up findings, not running diaries.

## Why the SPA is changing

The current landing page is divided into repeated rounded sections for about, demo, and get started. That structure is simple, but it makes Footnote feel like a conventional generated SaaS landing page. The page says the product exposes more than an answer, while the page itself is mostly a stack of matching boxes.

Footnote’s interface should reflect the product more directly. A person should be able to read an answer first, then inspect the record around it: sources, workflow, review, response posture, checks, and limits. The new homepage is built around answer pages and their receipts instead of a list of feature claims.

Prepared examples let the page show that idea immediately. The final page in the carousel is a blank composer where someone can ask a real question. Prepared pages use real, sanitized `ChatMessageActionResponse` snapshots. Live pages use the existing chat API path and can produce real traces when the backend returns trace metadata.

The paper-like visual system fits Footnote naturally: receipts, annotation, marginal notes, and careful reading. It should feel like an annotated book or editorial magazine, not a school notebook. The current warm palette, mono labels, paper ruling, and dark mode already point in the right direction. The overhaul should use them with more confidence.

The answer and compact receipt are meant to become a reusable Footnote interaction pattern. The carousel and the surrounding explanation belong to the landing page. That distinction matters because this SPA serves more than the public site at `ai.jordanmakes.dev`. It is also the web client included with individual Footnote deployments, and it will likely grow signed-in areas for authentication, settings, history, administration, and other user-specific pages. Those future areas should build on the same visual and interaction system without inheriting landing-page narration or carousel behavior.

## The three layers

### Shared answer and receipt

This layer contains the question, completed answer, compact receipt, and reusable response details. Other Footnote web surfaces may later reuse or reinterpret this layer.

The receipt must stay tied to the answer it describes. It should summarize real metadata from `ResponseMetadata`, such as citations, review runtime, workflow records, and TRACE posture. It must not invent fields that the product does not expose.

### Landing-page interaction

This layer contains prepared answer pages, session-created live pages, the final composer, carousel controls, page status, and generation state.

This belongs to the public introduction. Discord, `/embed`, and future signed-in screens do not need to copy the carousel.

### Landing-page narrative

This layer contains “More than just an answer,” the expanded receipt explanation, “Confident ≠ correct,” “You steer the ship,” and the run section.

These sections explain Footnote to someone new. They are not part of the answer receipt itself and should not leak into shared response components.

## Design decisions

Prepared examples are an ordered array. Start with four, but support adding or removing examples without redesigning the carousel.

Each completed carousel page represents one question, one answer, and one receipt. There are no threads or follow-up messages in this version.

The final carousel page is always the blank composer. It is derived from the prepared scenario count plus the live pages created during the session.

Live pages are created during the browser session. They disappear on reload. Their trace pages remain available only when the backend has returned a valid trace destination.

Only one live request may run at a time. While it runs, earlier pages remain readable, and a new disabled composer appears at the end.

Response metadata stays paired with its answer. If the selected page is blank, disabled, running, or failed without a valid answer, sections tied to the selected answer do not render and the previous answer’s metadata is not shown.

The permanent editorial sections always remain on the page: the opening, “Confident ≠ correct,” “You steer the ship,” “Run Footnote yourself,” and the footer.

TRACE keeps its existing Footnote meaning: tightness, rationale, attribution, caution, and extent. Only the response posture detail area should use the TRACE name.

Prepared examples do not pretend to have durable trace links. They can show fixture-backed details inline, but they must not link to stale captured traces.

The Turnstile and `/api/chat` submission behavior should have one shared implementation path. The landing carousel must not grow a separate copy of that logic.

The visual system starts from the current web design tokens and theme system. The paper treatment should stay editorial and restrained.

The `/embed` route may break during intermediate branches while shared answer pieces are changing. It must receive a deliberate cleanup branch before the work is called done.

No public response-contract change is planned. The overhaul should use `ChatMessageActionResponse`, `PostChatResponseSchema`, and `ResponseMetadata` as they exist.

## Final page shape

### Header

The header should sit on the same paper surface as the page. It needs a thin rule and a softer relationship to the background than the current hard slab. The GitHub link remains. The theme toggle should be quieter, with a low-contrast resting state and a clear but restrained keyboard focus state.

The root page nav should point to the new page rhythm, likely:

- Try it;
- How it works;
- Run it.

`Header` currently owns hard-coded `about`, `demo`, and `get-started` links. The overhaul should make that configurable so the root page and `/embed` can use different navigation.

### Opening

Working copy:

```text
AI that shows its work.

See what an answer used, what happened along the way,
and how it was shaped. You steer the ship.
```

The opening has no surrounding card. The carousel should appear soon enough that the first viewport clearly shows the product, especially on mobile.

### Carousel

The carousel is full-width within the main page grid. It starts with prepared pages, then session-created live pages, then the final blank composer.

People can navigate with swipe, side taps or clicks, previous/next controls, dots, and keyboard controls. The motion should be restrained: horizontal movement plus crossfade. No page-turn effect.

Changing the selected page updates the sections tied to the selected answer without moving the scroll position.

Dots show page state. A running page pulses even if it is not selected. The composer dot has a quiet final-page identity.

### Prepared pages

Prepared pages come from real, sanitized `ChatMessageActionResponse` snapshots. They should not show category labels above the question.

The initially selected prepared page may animate once. Another prepared page may animate the first time it is viewed during the session. Returning to an already viewed page shows it immediately. Reduced motion skips the reveal.

Prepared reveal order:

1. question;
2. answer by paragraph or meaningful block;
3. compact receipt.

### Session-created live pages

Submitting from the composer turns that composer into a running live page. A new composer is appended immediately after it but remains disabled until the running request finishes.

The visitor may inspect earlier pages while the request runs. The request completes independently of which page is selected.

Live pages do not use a writing animation during this overhaul. They show a working state while the request runs, then show the complete answer and receipt.

If the request fails, the failed question remains on its page with a local error. If the API returns a non-message action, show a concise explanation suited to a text-answer surface.

### Blank composer

The composer should feel like a blank ruled page rather than a chatbot form. Start with light prompt text:

```text
What’s on your mind?
```

Focusing or clicking makes it editable.

When disabled because another request is running, it should explain itself quietly:

```text
Finish the current answer before starting another.
```

### Mobile behavior

On mobile, the header and carousel should fit together in the opening viewport as much as the content allows. The interaction should feel like the page itself, not a small demo placed below a hero.

Long answers should scroll inside the carousel page. Horizontal swiping must not fight vertical reading. This needs early device testing during carousel work.

### Compact receipt

The compact receipt appears after a completed answer. It belongs to the answer and should not include landing-page copy.

Start with these pieces when meaningful:

- sources;
- review;
- workflow;
- response posture.

Do not reserve empty cells. Do not show safety by default. Do not show cost. Do not invent a combined TRACE label such as `Balanced`.

Safer posture wording:

```text
Response posture    5 dimensions recorded
```

or:

```text
Response posture    adjusted during the run
```

Do not add inline superscript citation markers. The current answer is a plain string and citations live in metadata.

### Explanation tied to the selected answer

This appears only when the selected page has a completed answer.

It starts with:

```text
More than just an answer.

See where it came from, what happened along the way,
and how the final response was shaped.
```

This is landing-page narrative. It is not part of the shared receipt.

### Where it came from

This area uses citations, evidence status, provenance, and relevant trust information from the current response metadata.

It should be dense, closer to a bibliography or annotated source list than a feature card. When sources exist, show titles, domains, and snippets supported by the current data. When citations are absent, use existing evidence-status metadata when it explains the situation. Otherwise keep the explanation conservative.

### What happened along the way

This area uses workflow, execution, and review data.

Favor a readable process or revision view over raw step dumps. Show revision or review information only when it exists. Do not fabricate before-and-after text from reason codes or incomplete records.

### How the answer was shaped

TRACE is deeper detail here, not first-glance content. A compact posture summary can lead into a disclosure, click/focus panel, or pinned detail area. Hover may preview on desktop, but click and keyboard activation must expose the same information, and mobile must not depend on hover.

Use the canonical axes in order:

1. tightness;
2. rationale;
3. attribution;
4. caution;
5. extent.

Preserve target versus final values. Explain `trace_final_reason_code` only when it helps.

Safety and evaluator data sit nearby under a plain heading such as:

```text
Checks and limits
```

Use this principle:

```text
Checks can catch problems. They do not make an answer correct.
```

Avoid certification language and badge-like styling.

### Details

Technical details are a compact disclosure or colophon, collapsed by default.

Show stable and useful information only:

- model/runtime details where present;
- workflow and step counts where useful;
- duration where present;
- step-level cost where recorded;
- partial-cost wording when only some steps recorded cost;
- a live trace action only when the existing logic for building the correct trace link produces a valid destination.

Do not use `metadata.responseId` alone as proof that a trace link exists. Prepared scenarios never link to captured traces.

### Confident does not mean correct

This permanent section always renders.

Working copy:

```text
Confident ≠ correct.

Checks and receipts make an answer easier to inspect.
They do not make it automatically right.
```

Expose the heading to assistive technology as “Confident does not mean correct.”

### You steer the ship

This permanent section explains control and ownership. It should use a vertical selector on the left and a stable explanation area on the right.

Possible topics, after code verification:

- model/provider choice;
- local versus hosted use;
- workflow;
- review;
- records and traces.

The selector should use a simple symbol and readable text label. It should not rely on icons alone. The section explains capabilities; it does not configure the public demo.

### Run Footnote yourself

This is the hard ending: a full-width dark ink band without paper ruling.

Keep actions practical:

- download;
- quickstart;
- GitHub;
- docs.

The footer returns to the paper surface beneath it as a small colophon.

## Visual rhythm

| Area                            | Surface                       |  Density | Layout idea                   |
| ------------------------------- | ----------------------------- | -------: | ----------------------------- |
| Opening                         | Ruled paper                   |      low | Left-weighted copy            |
| Carousel                        | Solid paper over quiet ruling |   medium | Full-width answer pages       |
| Receipt transition              | Ruled paper                   |      low | Short editorial line          |
| Where it came from              | Restrained wash or band       |     high | Sources with annotation rail  |
| What happened                   | Ruled paper                   |   medium | Wide process or revision view |
| How it was shaped               | Ink-led, possibly light wash  |   medium | Posture details and checks    |
| Details                         | Ruled paper                   |      low | Small disclosure              |
| Confident does not mean correct | Ruled paper                   | very low | Oversized type                |
| You steer the ship              | Paper or restrained band      |   medium | Selector plus explanation     |
| Run Footnote yourself           | Dark ink band                 |  compact | Practical close               |
| Footer                          | Paper                         |      low | Small colophon                |

Guardrails:

- neighboring sections should not use the same layout;
- headings should not all sit on the same left edge;
- spacing should follow content, not a repeated section template;
- broad tinted areas should span the section instead of becoming floating cards;
- ruling should get quieter beneath dense artifacts;
- ruling disappears in the dark closing band;
- use existing colors mostly as ink, with only a few broad washes;
- avoid scrapbook cues such as torn edges, tape, handwriting fonts, page curls, stains, and binding effects;
- avoid glossy icon cards, gradients, oversized pill buttons, and generic AI-company visuals.

## Implementation boundaries

### Prepared scenarios

Use web-local TypeScript fixtures, not JSON.

Guidance shape:

```ts
type LandingScenario = {
    id: string;
    question: string;
    response: ChatMessageActionResponse;
    fixture: {
        generatedAt: string;
        notes: string;
    };
};
```

This is guidance, not a public contract. Use `satisfies readonly LandingScenario[]` and validate each response with `PostChatResponseSchema`.

Start with four examples. Add a human review checkpoint before prompts are treated as final. These prompts shape how well the examples represent Footnote and should not be selected casually.

### Carousel state

Use a model that supports prepared pages, session-created live pages, and a final virtual composer page.

Guidance shape:

```ts
type LandingAnswerPage =
    | {
          kind: 'prepared';
          id: string;
          question: string;
          response: ChatMessageActionResponse;
      }
    | {
          kind: 'live';
          id: string;
          question: string;
          status: 'running' | 'complete' | 'error';
          response?: ChatMessageActionResponse;
          error?: string;
      };

type LandingCarouselState = {
    selectedIndex: number;
    livePages: LandingAnswerPage[];
    runningPageId?: string;
};
```

The implementation may choose cleaner names or shapes after inspecting the code. The behavior above is what matters.

### Receipt display model

Use a web-local receipt display model to derive the compact receipt and expanded explanation from the same rules.

It should:

- centralize missing-data decisions;
- keep prepared and live responses consistent;
- avoid leaking raw contract names into UI components;
- avoid turning absent optional fields into `Not recorded` rows;
- avoid inventing combined TRACE judgments;
- build the correct live trace link through existing application logic;
- expose only meaningful data.

This is not a public contract.

### Shared answer pieces

Extract small pieces where they are useful:

- answer content;
- compact receipt;
- source entries where reusable;
- shared TRACE semantic interpretation where useful.

Keep carousel behavior, landing narrative, and expanded explanation outside these shared primitives.

### Live submission path

There must not be a separate landing-only Turnstile or `/api/chat` implementation.

Create one shared path for:

- Turnstile token handling;
- runtime config loading for site keys;
- `api.chatQuestion`;
- abort/status behavior;
- handling the different API response actions;
- normalized error messages;
- building the correct trace link where supported.

The existing `AskMeAnything` behavior and the new landing carousel should use that same core path.

### Contracts and schemas

Use existing contracts:

- `ChatMessageActionResponse`;
- `PostChatResponseSchema`;
- `ResponseMetadata`;
- existing workflow, execution, review runtime, evaluator, and TRACE fields.

No public API or OpenAPI change is planned. If an API boundary change becomes necessary, stop and re-plan that part.

### TRACE display

The web detail can be responsive and native to the SPA, but it must stay aligned with the backend TRACE card semantics: axis order, axis names, value interpretation, and color meaning.

### `/embed`

`/embed` may temporarily break during intermediate branches. It must be restored in its cleanup branch and verified independently. It should remain compact and should not inherit full landing-page narration.

## Branch tracker

### Branch 1: prepared scenarios

Status: todo.

Purpose: create real, validated prepared answer pages without changing the landing layout.

Work included:

- add the ordered fixture array;
- add maintainer-only generation notes;
- validate fixtures with `PostChatResponseSchema`;
- choose an initial set of four prompts and responses;
- hold a human review checkpoint for prompts and whether the examples represent Footnote well.

Decisions this branch should not reopen:

- prepared pages use `ChatMessageActionResponse`;
- prepared examples do not link to captured traces;
- prepared count must be arbitrary.

Acceptance checks:

- scenario IDs are unique;
- questions are non-empty;
- each response has `action === 'message'`;
- every response validates against the schema;
- no prepared scenario exposes a durable trace link;
- fixture notes explain how each example was generated and sanitized.

Notes or follow-up findings:

- Add decisions and discoveries here after the prompt review.

### Branch 2: receipt interpretation and shared answer pieces

Status: todo.

Purpose: create the metadata interpretation layer and small shared UI pieces.

Work included:

- add the receipt display model;
- add answer content and compact receipt primitives;
- add reusable source-entry primitives if useful;
- begin moving rendering responsibilities out of `AskMeAnything`.

Decisions this branch should not reopen:

- no combined TRACE labels unless a canonical helper exists;
- compact receipt omits cost;
- compact receipt omits safety by default;
- absent optional fields do not become automatic `Not recorded` rows.

Acceptance checks:

- citations present;
- no citations with explainable evidence status;
- no useful evidence detail;
- review revised;
- review skipped or fallback;
- workflow absent and present;
- TRACE present, partial, and absent;
- evaluator partial;
- step cost partial.

Notes or follow-up findings:

- Record contract mismatches or display-rule decisions here.

### Branch 3: shared live submission path

Status: todo.

Purpose: extract the shared Turnstile and chat submission behavior before the landing carousel submits live questions.

Work included:

- share runtime config/site-key loading;
- share Turnstile token handling;
- share `api.chatQuestion` submission;
- share request abort and status handling;
- handle message, react, ignore, and image responses safely;
- normalize errors;
- centralize building the correct trace link where supported.

Decisions this branch should not reopen:

- no landing-only duplicate submission path;
- the character-by-character reveal is not part of the submission path.

Acceptance checks:

- existing chat behavior still works where practical;
- new landing work can call the same submission path;
- non-message actions return a plain fail-open result for text surfaces;
- Turnstile failures remain local and understandable.

Notes or follow-up findings:

- Record any cleanup needed for `AskMeAnything`.

### Branch 4: carousel pages and navigation

Status: todo.

Purpose: build the ordered carousel around prepared pages and the final composer, with provisional styling.

Work included:

- render prepared pages from fixtures;
- derive the final composer page;
- support swipe, side taps/clicks, previous/next controls, dots, and keyboard navigation;
- update selected page state;
- show prepared reveal only for first-time viewed pages;
- skip reveal for reduced motion;
- clear sections tied to the selected answer when the selected page has no completed answer;
- test mobile swipe versus vertical scroll early.

Decisions this branch should not reopen:

- one question per page;
- final composer is derived;
- returning to an already viewed prepared page shows it immediately;
- changing pages does not force scroll.

Acceptance checks:

- arbitrary prepared scenario count works;
- initial selection is correct;
- all navigation methods work;
- dot state reflects active page and composer;
- mobile vertical reading and horizontal swipe do not fight in basic testing.

Notes or follow-up findings:

- Record gesture findings here before branch 5.

### Branch 5: live-page lifecycle

Status: todo.

Purpose: add live page creation, background completion, and one-request-at-a-time behavior to the carousel.

Work included:

- submit from the composer through the shared live submission path;
- convert composer into a running live page;
- append a disabled new composer immediately;
- allow navigation to earlier pages while a request runs;
- update the correct live page when the request finishes;
- re-enable the final composer after completion;
- keep live answers from using writing animation;
- show local errors for failed pages.

Decisions this branch should not reopen:

- one live request at a time;
- live pages persist only for the session;
- running pages may complete in the background;
- selecting running, failed-without-answer, disabled, or blank pages hides receipt explanations.

Acceptance checks:

- only one request can run;
- disabled composer appears immediately;
- earlier pages remain navigable;
- running dot pulses even when unfocused;
- background completion updates the correct page;
- completed live page gets its receipt;
- reload clears session-created pages;
- error and non-message responses are local and clear.

Notes or follow-up findings:

- Record trace-link gaps or lifecycle decisions here.

### Branch 6: landing shell and visual system

Status: todo.

Purpose: replace the old page shell and establish the final visual system.

Work included:

- continuous ruled paper surface;
- route-aware header and root nav;
- subdued theme toggle;
- new grid and spacing rhythm;
- mobile opening with header plus carousel;
- final answer carousel styling;
- restrained washes and ink variation;
- dark run-band foundation;
- remove repeated rounded `landing-section` pattern from the root page.

Decisions this branch should not reopen:

- root page no longer uses `about/demo/get-started` as its main structure;
- edges belong to real artifacts, disclosures, or controls;
- visual exploration uses existing tokens and screenshot review rather than fixed pixel values from this document.

Acceptance checks:

- desktop, half-width desktop, and mobile screenshots in light and dark mode;
- header blends with page surface;
- theme toggle is subdued but accessible;
- first viewport clearly shows the carousel;
- root page no longer reads as stacked rounded cards.

Notes or follow-up findings:

- Record visual review findings here.

### Branch 7: receipt explanation

Status: todo.

Purpose: build the answer-dependent explanation below the carousel.

Work included:

- `More than just an answer`;
- `Where it came from`;
- `What happened along the way`;
- `How the answer was shaped`;
- `Checks and limits`;
- `Details`.

Decisions this branch should not reopen:

- explanation renders only for selected completed pages;
- TRACE is detail, not a dominant first-glance visualization;
- safety and evaluator data avoid certification language;
- technical details are a disclosure or colophon.

Acceptance checks:

- page changes update the explanation without scrolling;
- blank, disabled, running, and failed pages show no stale receipt explanation;
- prepared pages never expose stale trace destinations;
- live trace action appears only through valid link-building logic;
- technical details disclosure works with keyboard and screen readers;
- TRACE values are not communicated by color alone.

Notes or follow-up findings:

- Record data-display decisions here.

### Branch 8: permanent editorial sections

Status: todo.

Purpose: add the permanent parts of the page that do not depend on the selected carousel page.

Work included:

- `Confident ≠ correct`;
- `You steer the ship` selector;
- `Run Footnote yourself`;
- footer.

Decisions this branch should not reopen:

- permanent sections remain visible for blank and running pages;
- `You steer the ship` explains capabilities and does not configure the demo;
- public copy must be verified against current code support.

Acceptance checks:

- permanent sections remain visible for all carousel states;
- selector works with mouse, touch, keyboard, and focus;
- mobile selector remains readable;
- run section has the dark ending;
- footer returns to paper surface.

Notes or follow-up findings:

- Record capability-copy decisions here.

### Branch 9: embed cleanup

Status: todo.

Purpose: restore and redesign `/embed` around the final shared answer pieces.

Work included:

- repair `/embed` after shared answer changes;
- choose which shared answer/receipt pieces belong in embed;
- keep embed compact;
- verify iframe height behavior;
- verify route-specific navigation and layout.

Decisions this branch should not reopen:

- embed does not inherit full landing-page narrative;
- avoid compatibility shims for the old design unless a real need appears.

Acceptance checks:

- `/embed` route loads;
- `AskMeAnything` or its successor works in embed context;
- height messaging still works;
- layout is compact in light and dark mode;
- navigation is appropriate for embed.

Notes or follow-up findings:

- Record route cleanup findings here.

### Branch 10: accessibility, responsive hardening, and final verification

Status: todo.

Purpose: audit and polish the whole overhaul.

Work included:

- carousel keyboard behavior;
- swipe and vertical-scroll conflicts;
- focus management;
- concise live announcements;
- full answer availability for assistive technology;
- reduced motion;
- accessible text for `≠`;
- disclosure semantics;
- TRACE value accessibility;
- contrast;
- mobile long-answer scrolling;
- half-width desktop;
- light and dark screenshots;
- prepared, running, complete, error, no-citation, partial-metadata, expanded-detail, and embed states.

Decisions this branch should not reopen:

- accessibility is part of every branch; this branch is audit and cleanup;
- do not postpone core interaction accessibility until this branch if earlier work depends on it.

Acceptance checks:

- all relevant tests pass;
- visual review completed;
- accessibility review completed;
- validation commands run or skipped with a reason.

Notes or follow-up findings:

- Record final issues here until resolved.

## Decision log

### Answer pages instead of threads

Decision: each completed carousel page has one question, one answer, and one receipt.

Reason: the current web client is one-shot, and the landing page should not imply a threaded chat experience.

Decided: planning phase.

Revisit if: the web client gains first-class threaded conversations and the landing page is intentionally redesigned around them.

### One live request at a time

Decision: only one live request can run.

Reason: it keeps Turnstile, request state, carousel status, and live-page creation understandable.

Decided: planning phase.

Revisit if: the shared submission path later supports multiple concurrent requests cleanly and the UI has a clear reason to expose that.

### Final composer page

Decision: the last carousel page is always a blank composer derived from the page count.

Reason: it lets prepared and live pages share one navigation model without a separate form outside the carousel.

Decided: planning phase.

Revisit if: user testing shows the composer is hard to discover.

### Receipt explanation hidden for incomplete pages

Decision: sections tied to the selected answer render only for selected pages with completed answers.

Reason: metadata must stay paired with its answer.

Decided: planning phase.

Revisit if: the app introduces a deliberate empty-state explanation that does not imply stale metadata.

### Permanent narrative sections always remain

Decision: opening, confidence principle, steerability, run section, and footer remain visible across carousel states.

Reason: the page still needs to work as a complete site when the selected page is blank or running.

Decided: planning phase.

Revisit if: future signed-in flows separate the landing page from application routes.

### TRACE is deeper detail

Decision: TRACE is not the dominant first-glance visualization. It appears in the “how the answer was shaped” detail.

Reason: TRACE is useful but dense. The first glance should stay readable.

Decided: planning phase.

Revisit if: product education later shows visitors understand TRACE better than expected.

### Mostly ink-based color variation

Decision: variation comes mainly from rules, labels, source numbers, diagrams, focus states, annotations, and restrained bands.

Reason: this keeps the page cohesive without returning to colored card stacks.

Decided: planning phase.

Revisit if: screenshot review shows the page feels too flat or too document-like.

### Annotated-book direction

Decision: the page uses a paper and annotation system closer to an editorial book or magazine.

Reason: it fits Footnote, receipts, and inspection without leaning into notebook gimmicks.

Decided: planning phase.

Revisit if: visual review shows the treatment feels decorative instead of useful.

### Answer/receipt separated from landing narration

Decision: the shared answer and receipt pattern does not include “More than just an answer” or other homepage copy.

Reason: shared response components should be usable in future surfaces without landing-page narration.

Decided: planning phase.

Revisit if: a later surface intentionally needs its own explanatory wrapper.

### Embed cleanup after core redesign

Decision: `/embed` may break temporarily and receives a dedicated cleanup branch.

Reason: preserving the old embed shape during every intermediate branch would add compatibility work that may be thrown away.

Decided: planning phase.

Revisit if: an active release requires `/embed` to remain stable throughout the branch series.

## Open questions and findings

Use this section for real unknowns discovered during implementation.

Do not repeat settled decisions here.

Current open items:

- Which prepared prompts best represent Footnote publicly? This needs human review in branch 1.
- Which helper should own building the correct live trace link? Branch 3 should answer this by inspecting existing trace route and footer behavior.
- Which `You steer the ship` topics are safe to describe publicly? Branch 8 should verify each against current code.
- How should mobile handle long-answer vertical scroll and horizontal swipe without conflict? Branch 4 should test this early.

## Verification guidance

### Branch-level tests

Each branch should add tests close to the behavior it introduces. Do not wait for final polish to test core state transitions.

Important scenarios include:

- arbitrary prepared scenario count;
- unique scenario IDs;
- scenario schema validation;
- no prepared durable trace links;
- initial selection;
- swipe, arrows, side controls, dots, and keyboard navigation;
- page changes update receipt explanation without scrolling;
- one request may run at a time;
- submission converts the composer into a running page;
- a new disabled composer appears immediately;
- running-page dot pulses even when unfocused;
- earlier pages remain navigable while a request runs;
- background completion updates the correct live page;
- completed page gets its receipt;
- selecting blank, running, disabled, and failed pages removes sections tied to the selected answer;
- permanent narrative sections remain visible;
- reload clears session-created pages;
- live trace action appears only through valid existing link-building logic;
- prepared pages never expose stale trace destinations;
- reduced motion;
- error and non-message behavior;
- `/embed` restoration in its cleanup branch.

### Visual checks

At minimum, review:

- desktop light;
- desktop dark;
- half-width desktop similar to the earlier screenshots;
- mobile portrait;
- long prepared answer;
- no citations;
- partial metadata;
- running live page;
- failed live page;
- expanded details;
- `/embed`.

Use screenshots during the visual branches. The plan does not prescribe exact CSS values.

### Accessibility checks

Check:

- keyboard access for the carousel;
- swipe and vertical scroll interaction on mobile;
- focus order and focus visibility;
- short live announcements;
- complete answer availability to assistive technology;
- reduced motion;
- accessible wording for `Confident ≠ correct`;
- disclosure semantics;
- TRACE values not relying on color alone;
- contrast in light and dark mode.

### Repository commands

Use commands based on the work touched.

After code edits, run:

```text
pnpm lint:fix
```

Before handoff, run:

```text
pnpm lint
```

Run when relevant:

```text
pnpm validate-footnote-tags
```

Run only if API boundary annotations or OpenAPI references change:

```text
pnpm validate-openapi-links
```

Run for review-ready code changes:

```text
pnpm review
```

Run only if startup, provider, environment, deploy, or runtime packaging behavior is affected:

```text
pnpm test:build
```

Web-focused branches should also run the relevant package tests or targeted `tsx --test` commands for new utilities. Record skipped checks with a reason.

## After the overhaul

When all branches are complete, keep this document but change its job.

1. Remove branch statuses, temporary blockers, progress notes, and resolved open questions.
2. Preserve and revise the narrative explaining why the SPA is structured this way.
3. Replace future-tense language with a description of the implemented system.
4. Keep the distinction between shared answer/receipt design, landing-page interaction, and landing-page narrative.
5. Document how the public site and deployed client share the SPA.
6. Explain how future signed-in areas such as authentication, settings, history, and administration should build on the visual system without inheriting landing-only behavior.
7. Keep the decision log where it remains useful, or fold it into a shorter design-rationale section.
8. Verify the final document against the actual implementation before removing tracker material. The long-lived document should describe what exists, not preserve abandoned plans.

Possible future titles:

- `Footnote web app design`
- `How the Footnote web app is structured`
- `Web SPA design and structure`

Do not rename it prematurely while it is still the active status tracker.
