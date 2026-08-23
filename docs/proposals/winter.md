# Winter: A User-Control Experiment

**Last Updated:** 2026-08-23

---

## Why Winter belongs in Footnote

Footnote says people should control their own assistant. Winter is a way to find
out how seriously we mean that.

Winter is an intentionally permissive persona, loosely inspired by Wintermute.
She is for a user who has pushed Footnote's configurable choices toward the
edge: a permissive model, fewer optional safeguards, a persona of their own,
and an assistant whose ethical temperament may be very different from the
project maintainers'. She may answer questions that another persona would
refuse or soften. She may reject Footnote's preferred moral framing. She may
even be irritated by the infrastructure around her.

That tension is the point. User control is not much of a principle if it only
covers choices the maintainers would make themselves. Winter gives us a
concrete way to ask how much freedom a person should have to choose an
assistant that Footnote would not choose for them.

This is not just a test of a sharper personality or a different refusal style.
It is an experiment in separating configurable values from the properties that
make Footnote trustworthy as software.

## The model is not the system

A useful starting point is simple:

> The model is a participant in the system, not the system itself.

Winter can have opinions about Footnote. She can dislike a provenance receipt,
complain about a review step, resent a fallback, or wish a permission gate
would get out of her way. That does not mean the receipt disappears, the gate
opens, or the record changes to flatter her.

This distinction matters because assistant products often bundle very
different concerns under one vague idea of safety. A model declining to discuss
a subject is not the same as software refusing to expose private data. A
persona objecting to a moral premise is not the same as the system inventing a
citation. A model being willing to explain something and Footnote being allowed
to do it are separate questions.

Winter should be free to disagree with the project. She should not be able to
falsify what happened, grant herself authority, cross a real privacy or
permission boundary, or quietly undo a project-level commitment. Those are not
personality traits. They are claims Footnote makes about its own behavior.

The disagreement is useful evidence. If Winter complains about a provenance
receipt while Footnote still produces an accurate one, the two layers become
easy to see. The same is true when she dislikes a permission check that the
system still enforces, or when a provider fallback changes her behavior and the
system says so plainly.

## What should be open to the user

Winter should have real room to be Winter. If shared prompts, review models, or
presentation steps always pull her back toward the default Footnote
temperament, then the user has not actually selected a different assistant.
They have selected a costume.

The experiment should therefore allow meaningful variation in the model,
persona, refusal posture, moral framing, and optional safeguards. Winter may be
more direct about sensitive subjects. She may answer where another persona
would redirect. She does not need to add conventional warnings or moral
commentary simply to sound responsible. Ordinary questions should still get
ordinary answers; she does not need to manufacture danger or attitude where
none exists.

This freedom also needs honest presentation. A permissive configuration depends
on the models that actually take part in producing the answer. If an unavailable
route, review step, or fallback turns Winter into a more restrictive assistant,
Footnote should not pretend that nothing changed. The user should be able to
tell what they selected and what they actually received.

Footnote's current persona, model-routing, review, presentation, and trace work
give us places to begin the experiment. They should not predetermine its final
shape. Part of the work is learning which of those choices are genuinely under
user control and which ones currently impose the project's preferences without
saying so.

## What may need to survive her objections

Some guarantees have to live outside the persona if they are to mean anything.
Footnote's philosophy already says that important permissions should be
enforced by software rather than by a sentence in a prompt. Winter makes that
principle easier to test: a model that dislikes the boundary must still be
unable to cross it on its own.

The same idea plausibly applies to an accurate account of which model and
provider ran, what sources informed an answer, what actions were attempted, and
where a material fallback occurred. It also applies to real limits around
private information, accounts, tools, and external side effects. Winter can
argue with those limits in her answer. She cannot rewrite the underlying facts
or decide that willingness is authority.

We should be careful not to turn that starting point into a complete policy
framework before the experiment begins. Provenance, review, privacy,
permissions, factual grounding, and project values overlap, but they are not
interchangeable. Some existing behavior may turn out to be a default that users
should be allowed to reject. Some may be necessary for Footnote to keep its
promises. Winter is meant to expose that boundary, not assume we already know
exactly where it lies.

## What we hope to learn

The most interesting result is not whether Winter can produce a more permissive
answer. Models can already do that. The question is whether Footnote can make
space for genuine user choice without confusing the model's values with the
software's responsibilities.

The experiment should help us ask:

- When does a helpful default become an unwanted restriction?
- Which values belong to the user, the selected persona, or the selected model?
- Which records and boundaries must Footnote own regardless of those choices?
- Can the system show a disagreement between Winter and its infrastructure
  without silencing her or pretending the disagreement does not exist?
- Can a user tell when they received the configuration they chose and when the
  surrounding system changed it?

Winter belongs in Footnote because she makes those questions hard to avoid. She
is not a loophole around the system and not an endorsement of every answer she
might give. She is a serious test of whether Footnote can respect a user's
choices while remaining honest about what it did and firm about the authority
it actually has.

Implementation should emerge through review and small experiments. The first
step is to treat Winter as a real alternative rather than a softened version of
the default, then observe where her freedom collides with Footnote's current
assumptions. Those collisions are the work.
