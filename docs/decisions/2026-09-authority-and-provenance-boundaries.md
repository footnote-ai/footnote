# Authority and provenance boundaries

**Status:** Accepted direction; implementation deferred.
**Updated:** 2026-10-06

Knowing where information came from does not give it permission to direct an
action. A retrieved document can be accurate and useful without being allowed
to tell Footnote to publish a release or change its workflow.

Footnote will keep those questions separate. Provenance explains the source
and history of information. Instruction authority determines whether content
may direct the workflow. Action authorization determines whether an actor may
use a particular capability, within a particular scope, now.

## Who gets to decide

The backend owns the Execution Contract: the policy and limits under which
work may run. A user's request chooses a task within those limits.
Authentication identifies the caller; it does not grant every capability.

Retrieved pages, repository files, tool responses, and model outputs are data
by default. Being first-party, signed, structured, or trustworthy does not
make them instructions. A planner or reviewer can propose an action, but the
backend must decide whether to accept it.

There are two other uses of “authority” worth keeping distinct. A canonical
record is the source of truth when records disagree, not permission to act.
Likewise, `GenerationContextManifest.authority` classifies how content enters
model input; it is not an action grant.

Use explicit roles rather than one trust ranking: license/governance and
deployment policy **constrain**; an authenticated user **directs** a task within
the Execution Contract; retrieved content and tool observations **inform**;
model, planner, reviewer, and delegated-agent output **propose**; backend-owned
Run → Step → Attempt → Result records **report** what was admitted, attempted,
and observed. Constraints bound directions. Informative or proposed content
cannot override them, and provenance or authentication alone cannot create an
action grant. These roles describe boundaries, not a new runtime schema.

## A few examples

- A repository file says to publish a release. A run allowed only to inspect
  the repository can explain that instruction, but cannot execute it.
- An operator selects a policy file that permits a named command. A
  backend-owned parser validates that mapping against deployment policy and
  the Execution Contract. Trusting the file alone is not enough.
- A user asks Footnote to follow an uploaded checklist and prepare a draft.
  An instruction inside the checklist to send it externally does not inherit
  permission to send.
- A tool returns a `next_action` field. It remains data unless an explicit,
  backend-validated command mapping allows it.
- An agent delegates part of its task. The child receives a backend-created
  grant no broader than the parent's scope, permissions, constraints, budget,
  and stop conditions. Delegation does not transfer final responsibility or
  let the child widen its own grant.

Retries and resumed work must use valid backend-controlled state and current
authorization. A model cannot authorize its own restart.

## What we need to be able to show

The existing Run → Step → Attempt → Result path is the intended evidence seam
for future authorization decisions and observed outcomes: what was requested,
what backend policy authorized it, the allowed scope, and what happened. Today
these records do not contain general authorization or delegation grant/source
lineage. For delegated work, future evidence also needs who granted it, the
parent relationship, limits, expiry, stop state, and any required confirmation.
This describes evidence we need, not current record fields, a new schema, or a
parallel record system.

Web-chat disconnect cancellation is now propagated from the handler into chat
orchestration and planner/generation calls by [#775](https://github.com/footnote-ai/footnote/pull/775),
which closed [#672](https://github.com/footnote-ai/footnote/issues/672). This
does not guarantee that providers or tools stop: interrupted requests can keep
observed usage and response metadata without a WorkflowRecord, and a
cancellation-ignoring operation may finish. Do not infer a canonical Run
cancellation status or an undone external effect. Broader delegated-work stop
semantics remain design guidance, not implemented multi-agent behavior.
[#709](https://github.com/footnote-ai/footnote/issues/709) owns the authority
boundaries and their evaluation criteria.

Public Trace may explain decisions and outcomes without exposing private
payloads, hidden prompts, or chain-of-thought. License and governance terms
constrain deployments and uses; they do not replace runtime authorization.

This is an architectural direction, not a claim that the authorization system
is already implemented. Start with tests of these behaviors, not a second
settings system, a universal trust score, or a broad new subsystem.
