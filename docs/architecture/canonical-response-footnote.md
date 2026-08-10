# Canonical Response Footnote

The response footnote is the shared inspection view attached to a completed
Footnote response. It gives each surface a common source for presenting
response context without requiring every platform to reproduce the same UI.

The shared TypeScript view is
[`ResponseFootnote`](../../packages/contracts/src/policy/responseFootnote.ts).
It selects existing fields from
[`ResponseMetadata`](../../packages/contracts/src/policy/types.ts); it is not a
separate stored record or API response.

The full web version presents a compact summary of TRACE, sources, and safety,
followed by four sections:

- Sources
- Workflow
- Controls
- Details

Other surfaces may expose these sections through platform-appropriate
interactions while preserving their meaning. For example, Discord can use
ephemeral messages instead of dropdowns.

Sections remain visible when their information is unavailable and explain why.
For now, Controls describes the controls that shaped the response; it can grow
alongside Footnote's steerability capabilities.

The footnote is a focused view of response metadata, not a replacement for the
full response or trace.

## Related material

- [Platform Experience Standard](./platform-experience-standard.md)
- [Answer Posture and Control Influence](./answer-posture-and-control-influence.md)
- [Workflow](./workflow.md)
- [`ResponseMetadata` schema](../../packages/contracts/src/web/schemas.ts)
