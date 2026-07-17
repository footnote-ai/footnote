# Canonical Response Footnote

This gives Footnote one shared meaning for the information shown below a
completed response. Web can show more detail. Discord and other surfaces can
show less or use different interactions. All should use the same backend facts.

The shared TypeScript view is
[`ResponseFootnote`](../../packages/contracts/src/policy/responseFootnote.ts).
It selects fields from
[`ResponseMetadata`](../../packages/contracts/src/policy/types.ts). It is not
a new saved record or API response. The backend still owns and returns
`ResponseMetadata`.

## Current scope

The contract includes data Footnote already records:

- response ID, provenance, and sources
- safety tier and evaluator result
- workflow, review, and execution records
- TRACE target, final posture, evidence, and freshness
- controls that affected the response

## Disclosure topics

The footnote has four shared topics:

| Topic             | Uses existing response data                       |
| ----------------- | ------------------------------------------------- |
| **Sources**       | citations and provenance assessment               |
| **Workflow**      | workflow, review, and execution records           |
| **Controls**      | controls that affected the response               |
| **TRACE Details** | target and final posture, evidence, and freshness |

They are named in
[`ResponseFootnoteDisclosureSection`](../../packages/contracts/src/policy/responseFootnote.ts).
Web can render them as the four planned buttons. Other surfaces can use links,
menus, or a compact message instead.

When a topic has no recorded information, Web can keep its button visible but
disabled. A small info icon can explain why it is unavailable. This is a UI
rule for the later implementation, not a new response field.

## Not included yet

This is an inspection view, not the full response or full trace. We are
leaving these out for now:

- **Answer text, history, and attachments.** They belong to the chat response.
- **Controls a person can use.** `steerabilityControls` says what affected this
  response. It does not say what controls are available. That needs a clear
  backend contract first. Current surface capabilities are request-side
  [`ChatCapabilities`](../../packages/contracts/src/web/types.ts).
- **Claim-to-source links.** Footnote records sources for a response, but not
  which source supports each claim.
- **Raw prompts, model output, and large tool results.** The current workflow
  and execution records are the safe, bounded inspection data.
- **TrustGraph and image details.** These are useful trace details, but do not
  yet have a shared footnote meaning.
- **Older support fields.** `modelVersion`, `staleAfter`, `chainHash`,
  `licenseContext`, and `totalDurationMs` are not part of this shared footnote
  meaning yet.

TRACE remains answer-posture metadata. It is not a source or workflow
substitute.

## Related material

- [Answer Posture and Control Influence](./answer-posture-and-control-influence.md)
- [Workflow](./workflow.md)
- [Safety Evaluation](./safety-evaluation.md)
- [`ResponseMetadata` schema](../../packages/contracts/src/web/schemas.ts)
