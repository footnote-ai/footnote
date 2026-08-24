# Prompt Resolution Order

This is the canonical order Footnote uses to build runtime prompt text.

1. Load shared base prompts from `packages/prompts/src/defaults.yaml`.
2. Apply optional `PROMPT_CONFIG_PATH` overrides by prompt key (full key replacement, not line-by-line merge).
3. Select the system prompt layers for the request path.
    - Conversational text and voice paths use a shared conversational system layer first.
    - A surface-specific system layer is appended after the shared layer.
4. Resolve the active persona layer in this order:
    - If `BOT_PROFILE_PROMPT_OVERLAY` is non-empty, use it.
    - Else, if `BOT_PROFILE_PROMPT_OVERLAY_PATH` is set and readable, use that file.
    - Else, use the default persona bundle for that surface.
5. Compose prompts by path:
    - Discord chat / realtime voice / web chat: `shared conversational system + surface system + exactly one active persona layer`.
    - The default active persona layer for those paths is `shared Footnote persona + surface persona supplement`.
    - If an overlay is present, it replaces that whole default persona layer rather than stacking on top of it.
    - Image paths keep their existing `surface system + exactly one active persona layer` structure.
6. Interpolate prompt variables for selected keys.
7. Resolve persona expression strength in the backend with this precedence:
    - valid `personaExpressionStrength` request override;
    - valid `personaExpressionProfileStrength` value carried by a configured
      persona adapter;
    - valid `BOT_PROFILE_PERSONA_EXPRESSION_STRENGTH` bot-profile default;
    - built-in persona default (`strong` for Winter, `balanced` otherwise).
      Invalid or absent operator values fail open to the built-in persona default.

## Operator Notes

- `PROMPT_CONFIG_PATH` is shared by backend and Discord bot runtimes.
- `PROMPT_CONFIG_PATH` applies before Discord profile overlay composition.
- `BOT_PROFILE_*` overlay settings are Discord bot runtime specific.
- `BOT_PROFILE_PERSONA_EXPRESSION_STRENGTH` is an optional prose-only default;
  Discord carries it through the profile-specific request field and the backend
  records its source as `profile`.
- If both `BOT_PROFILE_PROMPT_OVERLAY` and `BOT_PROFILE_PROMPT_OVERLAY_PATH` are set, inline text wins and the file path is ignored.
- All bot paths now run with one active persona layer, not stacked personas.
- The shared conversational prompt core is used by Discord chat, realtime voice, and web chat.
- Copy/paste-ready persona overlay template paths:
    - `packages/prompts/src/profile-overlays/danny.md`
    - `packages/prompts/src/profile-overlays/myuri.md`
    - `packages/prompts/src/profile-overlays/winter.md`

## Optional Presentation

`presentation` is a backend-owned optional candidate step after planning,
retrieval, tool, citation, and safety context collection. It is disabled by
default:

```env
CHAT_PRESENTATION_ENABLED=false
CHAT_PRESENTATION_PROFILE_ID=
CHAT_PRESENTATION_TIMEOUT_MS=2000
# Retained for reading older deployments; #540 does not run a presentation audit.
CHAT_PRESENTATION_VALIDATOR_PROFILE_ID=
CHAT_PRESENTATION_VALIDATOR_TIMEOUT_MS=1500
```

The presentation profile selects an enabled backend profile. It is deployment
policy, not persona identity. It writes one full-prose candidate using the
collected context and active persona guidance. The candidate has no tools or
search. The normal main generation then reconciles that candidate with the
authoritative context, and the ordinary persona-aware assess/revision loop
reviews the resulting answer. The candidate is preferred expression, not
evidence or policy: authoritative context owns facts, uncertainty,
attribution, scope, permissions, refusals, provenance, TRACE, and safety.

If the candidate is disabled, malformed, times out, or fails at its provider,
the workflow simply runs normal generation and review without candidate text.
The candidate is never passed into ordinary assessment or revision. New trace
receipts record whether the candidate was generated or unavailable, its
requested and observed draft attribution, expression resolution, and an
opaque candidate identifier. Historical finalizer/audit receipts remain
readable through an explicit legacy flow, but new runs do not create those
fields.

TRACE caution remains observed presentation metadata and may protect answer
posture while the candidate is written. It never skips or weakens persona
expression. The resolved expression strength controls prose only; facts,
uncertainty, attribution, scope, permissions, refusals, provenance, TRACE
values, and safety decisions remain authoritative. Footnote is the default
persona; Discord can select Danny, Myuri, or Winter.

#### Separate follow-up: workflow token sizing

Trace `furjkYEW` shows a separate workflow-budget issue: planner usage was
3,003 tokens, the presentation candidate used 7,000, and authoritative
generation used 6,715, for 16,718 against a 14,000-token workflow limit.
Assessment therefore did not run. Candidate usage remains recorded as
presentation usage; sizing the workflow budget is follow-up work and is not
resolved by hiding or dropping that accounting here.
