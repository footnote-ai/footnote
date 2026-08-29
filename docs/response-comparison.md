# Response comparison

This harness compares presentation models without changing production defaults.
It records each model call, its cost and timing, and separate automatic and
human reviews.

## Campaign

The checked-in campaign runs seven conditions across six cases, twice each (84
attempts):

- authority only;
- a faithful rewrite from Cydonia or DeepSeek;
- a looser style draft from Cydonia or DeepSeek;
- each style draft either preserved where safe or used only as a style reference.

Terra writes the final answer from the original context. A presentation draft
is wording input, not evidence or policy. If the draft fails, is empty, or
conflicts with the context, Terra can ignore or correct it.

The campaign pins Terra and the reviewer in
`response-comparison/config.yaml`. These choices apply only to the experiment.

## Run the comparison

First check the configuration, credentials, and advertised model support. This
does not generate responses:

```text
pnpm responses:compare --check
```

Then start or resume the run:

```text
pnpm responses:compare
```

Progress is printed after each stage. A failed attempt does not stop the rest
of the run. Checkpoints and reports are written to the ignored
`response-comparison/.local/` directory.

Open the generated HTML report to review the answers. The report initially
hides model names, settings, costs, timing, automatic scores, and saved human
scores. Reveal them only after blind review. Automatic and human reviews remain
separate; the report does not pick a winner.

## Evidence boundaries

The report records:

- the source messages and review requirements;
- candidate, authority, assessment, revision, and final stages;
- requested and observed model details;
- latency, token use, and cost;
- candidate failures and possible unsupported changes;
- automatic review and blind human review.

The cases live in `response-comparison/core-cases.yaml`. The source-boundary
case uses delimited supplied evidence rather than a previous assistant claim.

No paid run or human review is included in this change. Results and any default
recommendation belong in a later evidence-backed change. This work does not add
an end-user temperature control or change the model-strength policy in #564.
