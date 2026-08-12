# Platform Experience Standard

[Scope](#scope) · [Requirements](#requirements) · [Web and Discord](#web-and-discord) · [Testing](#testing) · [Updating](#updating)

## Scope

Footnote has one backend and more than one way to use it. The backend owns the
response and its metadata. Web and Discord present them in ways that suit each
platform.

The platforms do not need matching layouts. They do need to preserve the same
meaning and important context.

## Requirements

Web and Discord must:

- Preserve the meaning of the backend result.
- Show provenance, sources, safety information, and limitations when they are
  part of the result.
- Keep important actions available, or provide a clear alternative.
- Put errors and unavailable states near the affected action.
- Never present missing data or unsupported work as if it were available or
  completed.

## Web and Discord

Web currently has room for the full answer, sources, trace, and controls. A
surface may offer more or less detail, but no surface becomes the authority for
response meaning.

Discord can split the same material across messages, buttons, ephemeral
replies, and attachments. Discord's limits justify a different layout, not a
different meaning.

## Testing

Each check should record:

- the input;
- the expected backend result;
- what web should show or allow;
- what Discord should show or allow; and
- the request, response data, screenshot, or payload kept as evidence.

Assert exact wording or layout only when it matters. Otherwise, test the
behavior and the information available to the user.

The current basic example is described in [Output Testing](../output-testing.md).

## Updating

When shared behavior changes, update the relevant checks. Update this page only
when the cross-platform requirements change. A presentation-only change should
update only that platform's expectations.
