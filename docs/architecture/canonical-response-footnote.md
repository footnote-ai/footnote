# Canonical Response Footnote

The canonical response footnote is the shared inspection record shown below a
completed response. Every Footnote surface uses the same backend facts.

The shared TypeScript view is
[`ResponseFootnote`](../../packages/contracts/src/policy/responseFootnote.ts).
It selects fields from
[`ResponseMetadata`](../../packages/contracts/src/policy/types.ts). It is not
a new saved record or API response. The backend still owns and returns
`ResponseMetadata`.

## Scope

The contract includes data Footnote already records:

- response ID, provenance, and sources
- safety tier and evaluator result
- workflow, review, and execution records
- TRACE target, final posture, evidence, and freshness
- controls that affected the response

## Canonical layout

- **Top row:** the TRACE wheel and short mouseover help for its axes.
- **Bottom row:** the four disclosure buttons: Sources, Workflow, Controls,
  and Details. Each button opens its own dropdown or panel.

Web implements this layout. Other surfaces keep the same four disclosures and
their meaning, using the interaction model they support. For example, Discord
can show a disclosure in an ephemeral message instead of a dropdown.

## Disclosure topics

The footnote has four shared topics:

| Topic        | Uses existing response data                                 |
| ------------ | ----------------------------------------------------------- |
| **Sources**  | citations and provenance assessment                         |
| **Workflow** | workflow, review, and execution records                     |
| **Controls** | controls that affected the response                         |
| **Details**  | the full recorded response detail, including its trace link |

The topics are named in
[`ResponseFootnoteDisclosureSection`](../../packages/contracts/src/policy/responseFootnote.ts).
Details opens the fuller response record, including its trace link.

When a topic has no recorded information, its control stays visible but
disabled. An info icon explains why it is unavailable.

## Excluded

The footnote is an inspection view, not the full response or full trace. It
does not include:

- **Answer text, history, and attachments.** They belong to the chat response.
- **Controls a person can use.** `steerabilityControls` says what affected this
  response. It does not say what controls are available. Current surface
  capabilities are request-side
  [`ChatCapabilities`](../../packages/contracts/src/web/types.ts).
- **Claim-to-source links.** Footnote records sources for a response, but not
  which source supports each claim.
- **Raw prompts, model output, and large tool results.** The current workflow
  and execution records are the safe, bounded inspection data.
- **TrustGraph and image details.** These are useful trace details, but do not
  have a shared footnote meaning.
- **Older support fields.** `modelVersion`, `staleAfter`, `chainHash`,
  `licenseContext`, and `totalDurationMs` are not part of the footnote.

## Related material

- [Answer Posture and Control Influence](./answer-posture-and-control-influence.md)
- [Workflow](./workflow.md)
- [Safety Evaluation](./safety-evaluation.md)
- [`ResponseMetadata` schema](../../packages/contracts/src/web/schemas.ts)
