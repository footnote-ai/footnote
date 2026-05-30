# Explicit Domain Modeling for Trust Boundaries

**Decision:** Keep TypeScript as Footnote’s project language, and use more explicit types for workflow, review, failure, and provenance paths where loose shapes would make runs harder to inspect.
**Date:** 2026-05-30

---

## 1. Context

Footnote’s backend does more than pass a prompt to a model and return text. It decides which workflow can run, which model or tool result can be used, what counts as a recoverable failure, when review has passed, and what record should be left behind for someone to inspect later.

Those are the places where loose code shapes matter most. A `null` parse result, a broad object with several optional fields, or a thrown string that means “routing was exhausted” can work technically while still hiding useful meaning from the next person reading the code or the trace.

This discussion came partly from looking at functional programming. Some of those habits are useful here: make the possible cases visible, make expected failure explicit, and avoid representing states that should not exist. The goal is not to turn Footnote into a functional-programming project. The goal is to use TypeScript in a way that better matches Footnote’s own promises.

## 2. Constraints

Footnote also needs to stay approachable. The project has TypeScript-facing surfaces across the backend, web, Discord, and future clients. It should remain possible for a new contributor to clone the repo, follow the main paths, and make a sensible change without learning a new language or a heavy programming framework first.

So this decision does not change the project language. It keeps the work in TypeScript and focuses on the parts of the code where unclear state makes behavior harder to audit.

## 3. Decision

In workflow, review, failure, provenance, context, audit, and metadata paths, prefer explicit domain shapes over loose ones.

Use discriminated unions, small named helpers, and narrow result types where they make important cases easier to see. Expected failures should usually carry their reason directly instead of disappearing into `null`, `undefined`, or message-string exception flow.

This applies especially to:

- workflow legality and transitions
- review decision parsing
- expected model or routing failures
- context results
- provenance classification
- audit events
- metadata derivation and finalization records

The backend remains the authority for policy, routing, failure classification, and finalization.

## 4. Practical guidance

Start with native TypeScript. Prefer clear unions and named functions before adding a library.

A small Result-style helper or library may be useful at a few expected-failure seams, but this decision does not adopt a broad effect framework. It also does not replace every exception with a Result type. Programmer errors, impossible states, and truly exceptional failures can still be exceptions.

Current examples that fit this decision include:

- review parsing that loses failure reason details
- routing or model exhaustion represented through throw/catch strings
- optional result shapes that allow invalid combinations
- provenance or metadata derivation mixed with timestamps, generated ids, or logging
- workflow or context state changes spread across branch logic

These examples describe the scope of the decision. They are not a rollout plan.

## 5. Non-goals

- No rewrite in Haskell, Rust, OCaml, or another language.
- No project-wide functional-programming framework.
- No blanket rule that all failures must use Result.
- No abstraction added only to make code look more principled.
- No public interface shape that cannot stay serializable.

## 6. Consequences

This will add some type and helper code in the paths where Footnote’s behavior needs to be easiest to inspect. That is worth it when the new shape prevents an invalid state, preserves a useful failure reason, or makes review/audit behavior easier to follow.

It is not worth it when the old code was already clear.
