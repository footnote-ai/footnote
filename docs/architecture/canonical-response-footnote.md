# Canonical Response Footnote

The response footnote is the shared inspection view attached to a completed
Footnote response. It gives each surface a common source for presenting
response context without requiring every platform to reproduce the same UI.

The shared TypeScript view is
[`ResponseFootnote`](../../packages/contracts/src/policy/responseFootnote.ts).
It selects existing fields from
[`ResponseMetadata`](../../packages/contracts/src/policy/types.ts); it is not a
separate stored record or API response.

Surface adapters first call `projectResponseFootnote({ metadata, artifacts })`.
The projection is serializable and bounded: `facts` includes only selected
response-footnote fields, while `summary`, `trace`, and `actions` provide
presentation-safe values. It does not calculate provenance, safety authority,
or TRACE scores. `licenseContext` is recorded metadata shown as licensing
context, not a new license decision.
`safetyTier` is a recorded sensitivity level, not an evaluator result;
the projection keeps evaluator authority, decision, and evaluator safety tier
separate and unavailable when not recorded.

The full web version presents a compact summary of TRACE, sources, and safety,
followed by four sections:

- Sources
- Workflow
- Controls
- Details (including labeled Workflow, Provenance, and Safety record subsections)

The web Details disclosure includes the Workflow subsection even when no
workflow record was captured; it says workflow details are unavailable rather
than fabricating a run. Provenance classification, assessment method, conflicts,
and limitations are shown only when recorded.

Other surfaces may expose these sections through platform-appropriate
interactions while preserving their meaning. For example, Discord can use
ephemeral messages instead of dropdowns.

Sections remain visible when their information is unavailable and explain why.
For now, Controls describes the controls that shaped the response; it can grow
alongside Footnote's steerability capabilities.

TRACE renders the five shared axes (Tightness, Rationale, Attribution, Caution,
Extent) from final values on a `1..5` scale. Target values remain distinct. A
missing final axis is neutral and labeled unavailable; a target-only axis is
partial, never inferred as a final value.

Action availability is separate from recorded facts:

| Action   | Meaning                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sources  | Recorded citations and grounding status; prepared responses keep these inspectable.                                                                        |
| Controls | Recorded control-influence records; prepared responses keep these inspectable.                                                                             |
| Trace    | A response-bound artifact or viewer. Live web responses begin `unknown` until the artifact is confirmed; a missing response identity makes it unavailable. |
| Report   | Incident/report action. The web footnote intentionally shows `Unavailable on web` because no anonymous report endpoint or token is exposed.                |

The web adapter is a dynamic accessible component at
`@components/CanonicalResponseFootnote`; it uses theme tokens and one
projection for light, dark, and narrow layouts. Discord uses the same
projection in its backend-owned PNG card and preserves Sources/Controls/Trace
in its native Details interaction plus the existing Report button. A failed
SVG, raster conversion, storage write, or attachment upload must not remove
the assistant answer or the independent native controls.

The Trace card is a posture disclosure, not an answer-quality score. Its wheel
and axis bars use the same final values and descriptions as the web component;
no `evidenceScore` or `freshnessScore` quality chip is used in the canonical
card. The backend `/api/trace-cards/from-trace` path reads stored metadata and
does not manufacture a prepared Trace identity.

The footnote is a focused view of response metadata, not a replacement for the
full response or trace.

## Related material

- [Platform Experience Standard](./platform-experience-standard.md)
- [Answer Posture and Control Influence](./answer-posture-and-control-influence.md)
- [Workflow](./workflow.md)
- [`ResponseMetadata` schema](../../packages/contracts/src/web/schemas.ts)
