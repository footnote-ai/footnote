# Footnote Documentation

AI answers can sound convincing even when you can't tell what they relied on.
Footnote tries to make that easier to question. Its traces bring together the
available sources, tools, and steps behind a response. They give you a place
to start checking an answer, though they can't prove it's right.

If you want to see Footnote before reading about it, [open the web
app](https://ai.jordanmakes.dev). The homepage has prepared examples that don't
call a model; live chat is separate. To run your own instance, start with the
[deployment guide](../deploy/README.md).

## Find your way around

If you want to understand how a particular answer was made, start with
[Workflow](architecture/workflow.md). It explains how requests move through
planning, context, and review. The [philosophy](Philosophy.md) explains why
provenance and user control matter to the project.

If you use Discord, the [Voice guide](architecture/realtime-voice.md) explains
the differences between Standard and Live, including why independently spoken
Live responses aren't necessarily the exact text that Workflow approved.

If you'd like to contribute, start with the [contributor guide](ai/README.md).
The [documentation map](README.md) has links to the API, architecture, current
work, decisions, and proposals.
