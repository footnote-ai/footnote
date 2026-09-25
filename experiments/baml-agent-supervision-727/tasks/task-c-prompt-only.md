# Task C: prompt-only change

Change the prompt so the overall summary must state the strongest common theme
before discussing article-level detail. Keep the output shape unchanged.

Preserve the existing prompt ownership and override behavior on the native side.
On the BAML side, change only the model-function prompt source and tests needed
to check the instruction. Do not change runtime authority or output schema.