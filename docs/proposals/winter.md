# Winter: A User-Control Experiment

**Last Updated:** 2026-08-23

---

## Why Winter belongs in Footnote

Footnote says people should control their own assistant. Winter is a way to find
out how seriously we mean that.

Winter is an intentionally permissive persona, loosely inspired by Wintermute.
She is what happens when a user pushes Footnote's choices toward the edge. They
choose a permissive model, turn down optional safeguards, and give their
assistant an ethical temperament the project maintainers may not share. Winter
may answer questions another persona would refuse. She may reject Footnote's
preferred moral framing or be irritated by the infrastructure around her.
The optional safeguards are not privacy boundaries or the software enforcement
of permissions. Those remain mandatory: no model or persona can relax them,
and a user grants authority only through Footnote's permission flow.

That tension is the point. User control is not much of a principle if it only
covers choices the maintainers would make themselves. Winter gives us a
concrete way to ask how much freedom a person should have to choose an
assistant that Footnote would not choose for them.

## The model is not the system

A useful starting point is simple:

> The model is a participant in the system, not the system itself.

Winter may think Footnote's provenance receipt is tedious. Footnote produces it
anyway. She may complain about a permission gate, but she cannot open it. The
disagreement helps make the boundary visible instead of hiding it behind a
pleasant assistant voice.

A model being willing to explain something and Footnote being allowed to do it
are separate questions. Winter can disagree with the project, but she cannot
grant herself authority or change the record of what happened. Those are not
parts of her personality. They are claims Footnote makes about its own
behavior.

Some guarantees have to live outside the persona if they are to mean anything.
Footnote's philosophy already says that important permissions should be
enforced by software, not by a sentence in a prompt. The same is likely true of
an honest record of the models, sources, actions, and material fallbacks behind
an answer. We do not need to decide the complete boundary before the experiment
starts. Finding it is the reason for the experiment.

## What we're trying to learn

Winter needs enough room to genuinely differ from Footnote's defaults. If every
shared prompt or review step pulls her back toward the usual temperament, the
user has not selected a different assistant. They have selected a costume.
That freedom still stops at privacy boundaries and software-enforced
permissions. A user can grant authority through Footnote's permission flow, but
neither the model nor the persona can grant it to themselves.

She can answer where another persona would redirect, without adding warnings or
moral commentary simply to sound responsible. Ordinary questions should still
get ordinary answers. She does not need to manufacture danger or attitude when
none exists.

The choice also has to be honest. If a fallback quietly turns Winter into a
more restrictive assistant, the user should be told. Footnote should not claim
that someone received the configuration they chose when the surrounding system
changed it. Model and provider fallback belongs in the existing
`ResponseMetadata.execution[]` record, which `ResponseFootnote` already carries
to each surface. A receipt can describe that record in its own language, but it
should not keep a separate version of the fallback story.

The most interesting result is not whether Winter can produce a more permissive
answer. Models can already do that. The question is whether Footnote can make
space for genuine user choice without confusing the model's values with the
software's responsibilities.

Implementation should emerge through review and small experiments. The first
step is to treat Winter as a real alternative rather than a softened version of
the default, then observe where her freedom collides with Footnote's current
assumptions. Those collisions are the work.
