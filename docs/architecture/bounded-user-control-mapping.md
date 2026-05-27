# Bounded User Control Mapping

This doc defines the small user-facing control surface for chat.

## User-Facing Allowlist

Users get three choices:

- `express`
- `balanced`
- `grounded`

Do not add aliases, advanced toggles, or secondary sub-controls in this phase.

## What These Choices Mean

- `express`: quicker, lower-allowance route for straightforward requests
- `balanced`: default reviewed path for general requests
- `grounded`: richer context and review route, with stricter evidence posture and
  review expectations when sources are available

These labels should be easy to understand. A user should not need to know
workflow internals, provider routing, or policy terms to pick one.

## Default Direction

`balanced` is the default.

This keeps the default practical for general use while preserving clear options
for faster or more evidence-heavy runs.

## How This Maps Internally

These choices map to broad backend behavior, not direct control of internal
knobs.

- If the user chooses `express`, the system should prefer a quicker
  lower-allowance execution path.
- If the user chooses `balanced`, the system should prefer the standard
  reviewed path.
- If the user chooses `grounded`, the system should prefer a stricter reviewed
  path with stronger evidence expectations.

The backend still owns the exact runtime shape, limits, and conflict handling.

The user is picking a simple posture, not issuing low-level policy commands.

## What Stays Internal

The following controls stay internal-only in this phase:

- `provider_preference`: Too easy to mistake for policy authority when it should
  remain advisory or backend-resolved.
- `persona_tone_overlay`: Presentation styling should not look like execution
  authority.
- detailed tool controls: Tool eligibility and routing are too low-level for an
  early humane surface.
- detailed review and evidence knobs: Exposing sub-knobs too early makes users
  guess which setting is the real authority.

The rule is simple: if a control is easy to misread as "the real policy knob,"
it should stay internal until Footnote has a stronger public control model.

## Examples

- If a user picks `grounded`, expose that choice as a stricter answer posture.
  Show actual evidence separately through citations or recorded trace details.
- If a user picks `express`, do not also surface provider or tool-routing choices
  as if they are equal policy controls. Those remain backend-owned.

## Not In Scope

This doc does not define:

- UI rollout details
- API rollout details
- a final global override policy
- compatibility aliases
- speculative advanced control sets
