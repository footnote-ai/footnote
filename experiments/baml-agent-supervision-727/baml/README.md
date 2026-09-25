# Representative BAML variant

This directory mirrors the real /news model-facing output contract for the
agent-supervision experiment. It is deliberately not imported by Footnote
runtime code.

The original Footnote schema is stricter than BAML parsing. A future
integration would still pass BAML output through the existing Footnote
PostInternalNewsTaskResponseSchema and normalization before admission.