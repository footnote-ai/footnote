# Presentation Contract Status

Status: current runtime uses the candidate-review flow. It does not run a
model-backed presentation validator or audit.

The optional presentation call proposes wording and style. Candidate admission
only checks mechanical usability as ordinary answer prose. Authoritative
generation owns the answer, and the ordinary assessment/revision loop owns
semantic review, grounding, posture, and corrections.

Current receipts record the candidate's requested and observed attribution,
admission outcome, and skip or failure reason. They do not claim validator
model execution. Historical finalizer/audit receipts remain readable through a
separate legacy schema branch, but new runs do not emit that flow.

The canonical settings template no longer exposes validator settings. Existing
YAML files may still load those two retired keys with explicit deprecated and
ignored warnings; they are not projected into runtime configuration.

Related work:

- [Presentation contract drift issue #563](https://github.com/footnote-ai/footnote/issues/563)
- [Model-strength escalation follow-up #564](https://github.com/footnote-ai/footnote/issues/564)
- [Workflow budget review #548](https://github.com/footnote-ai/footnote/issues/548)
