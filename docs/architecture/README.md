# Architecture Reading Guide

Use this section to understand how Footnote is put together.

If you are new, start with the first few items below. The later items add more
detail once you have the main runtime shape in mind.

## Important Concepts

1. [Workflow](./workflow.md): read this next for the
   current workflow and planner model, including mode, profile, review/refinement,
   step routing chains, planner boundaries, workflow-facing wording, placement,
   and provenance presentation boundaries.
2. [Answer Posture And Control Influence](./answer-posture-and-control-influence.md):
   use this when you need the metadata map for mode, TRACE, planner influence,
   control influence, and provenance.
3. [Platform Experience Standard](./platform-experience-standard.md): the
   behavior web and Discord must keep consistent, and where their presentation
   can differ.
4. [Canonical Response Footnote](./canonical-response-footnote.md): the
   portable response-inspection contract shared by future platform footnotes.
5. [TRACE Temperament Contract](./trace-temperament-contract.md): canonical
   TRACE defaults, level matrix semantics, and compact rubric rules.
6. [Prompt Resolution Order](./prompt-resolution.md): how prompt layers and
   overrides resolve at runtime.
7. [Bounded User Control Mapping](./bounded-user-control-mapping.md): what
   users can steer directly and what stays backend-owned.
8. [Context Integrations](./context-integrations/README.md): shared rules for
   external systems that can add context without taking execution authority.

## Context Integrations

- [TrustGraph](./context-integrations/trustgraph.md): current TrustGraph seam,
  runtime boundaries, scope rules, and activation posture.
- [Weather Forecast](./context-integrations/weather-forecast.md): backend-owned
  weather tool seam, clarification behavior, and fail-open integration rules.
- [Web Search](./context-integrations/web-search.md): provider-neutral search
  context-step seam, fallback behavior, and configuration.

## Incident And Safety

- [Incident Handling](./incident-handling.md)
- [Safety Evaluation](./safety-evaluation.md)
- [Langfuse Metadata Mirror](./langfuse-metadata-mirror.md): optional,
  metadata-only mirror for maintainer observability with fail-open behavior.

## Subsystem Notes

- [Public Web Surfaces](./public-web-surfaces.md): route ownership, prepared
  homepage content, shared live chat, and embed boundaries.

- [Admin Settings API](./admin-settings-architecture.md): trusted YAML settings
  management API (`/api/admin/*`), auth/ETag semantics, and planned admin
  surface direction.
- [First-Setup Flow](./first-setup-flow.md): bootstrap link/session flow used
  when `footnote.yaml` is missing, including setup-route gating and first-write
  sentinel behavior.
- [Account Identity and Access](../auth/README.md):
  proposed provider-neutral login direction for administrators and future user
  accounts.
- [Footnote and Common Agentic Patterns](./footnote-and-common-agentic-patterns.md):
  external-pattern comparison and fit.
- [Footnote Annotations](./footnote-annotations.md): code annotation conventions.
- [Tool Invocation Contract v1](./tool-invocation-contract-v1.md): tool-call
  contract details.
- [Embedding Footnote](./embedding.md): maintained `/embed` route behavior,
  host integration contract, and height-messaging expectations.
- [Realtime Voice System](./realtime-voice.md): implementation-oriented
  walkthrough of the current backend-owned realtime voice boundary.
