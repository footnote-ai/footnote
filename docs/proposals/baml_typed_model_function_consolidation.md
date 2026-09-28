# Where BAML fits in Footnote

**Direction:** Likely adoption; the integration is still being worked out.
**Updated:** 2026-09-28

BAML lets us keep a model function's prompt and output type together, then
use a generated client to call it and parse the answer. That is appealing in
Footnote, where changing a structured response can mean updating a prompt,
a schema, a parser, and several tests in different places.

We expect to use BAML. The question is where it makes the code easier to work
on and how to connect it to the rest of Footnote. It does not need to replace
our runtime, policy, or provenance to be useful.

## What the experiments taught us

We started with `ReviewDecision`, the result used to decide whether an answer
is ready or needs revision. BAML could describe and parse valid decisions,
but its forgiving parser also accepted some values that Footnote rejects.
For example, it could turn a numeric string into a number or drop a malformed
nested value. Checking the result afterward cannot always recover what was
lost during parsing.

That matters for this particular contract. It tells us to choose deliberately
which recoveries are acceptable and where strict checks belong. It does not
tell us that BAML is a poor choice for model functions generally.

The later `news` experiments showed a more obvious benefit: a prompt and its
model-facing type were easy to find and change together. The compiler caught
some mistakes, and a fresh agent could find the source without a long handoff.
Public response validation, URL checks, timestamp cleanup, and field mapping
still needed Footnote code. Those are legitimate application responsibilities,
not evidence that BAML failed to replace them.

The supervision comparison was less conclusive. Some tasks stopped at package
manager or approval problems, the older fixture lacked a complete runnable
test path, and the newer Canary follow-up had no matching native control.
Canary supplied useful inspection and testing tools, but required migrating
the older syntax. These trials exposed integration work; they did not provide
a fair basis for rejecting adoption or prove a reduction in total review time.

## The direction from here

Start with an ordinary typed model function where keeping the prompt and type
together helps. The `news` work is a useful reference, not a commitment to
migrate that function first. Assess and planner remain possible later uses,
but their policy-sensitive output needs more care. The next decision belongs
in [#727](https://github.com/footnote-ai/footnote/issues/727), within the broader
[BAML investigation](https://github.com/footnote-ai/footnote/issues/716).

BAML should own the model-function definition and the parsing we deliberately
choose to give it. Footnote should still decide which provider to use, whether
an attempt may run, how retries and cancellation work, and how usage, cost,
workflow results, and provenance are recorded. Generated types should map to
Footnote's shared contracts rather than quietly redefine public responses.

Before migrating a function, settle its prompt overrides, strict validation
and normalization, failure reporting, and reproducible client generation.
Preserve the distinction between a bad model answer and a failed provider
request. Compare the existing attempt evidence, including reason codes,
structured-output outcomes, provider/model identity, purpose, contract type,
and apply outcome wherever relevant. Debugging tools must not start retaining
private prompts or responses by default.

The useful test is whether an ordinary change becomes easier to make and
review. Remove duplicated model-function plumbing where BAML replaces it;
do not demand that it remove Footnote's own policy to justify its place.
[Jev](./semantic_judgment_context_resolution.md) is a separate investigation
and does not depend on BAML adoption.

## Evidence

These are historical experiment reports, not the current adoption decision.
Their cautious recommendations should be read alongside the limitations above.

- [Assess parsing, requests, and validation](https://github.com/footnote-ai/footnote/blob/44b69c9796306df1fddaf2c4f404e74ebcd56fb8/docs/evaluations/baml-assess-semantic-equivalence-726.md) — #734, #737, and #742.
- [Agent supervision](https://github.com/footnote-ai/footnote/blob/a3afefaf2c6e873d5cc0939435fef3c5c7b8e281/docs/evaluations/baml-agent-supervision-727.md) and [Canary follow-up](https://github.com/footnote-ai/footnote/blob/7d17146650081eaf79f52e4b110c073478cd1dae/docs/evaluations/baml-canary-delta-744.md) — #744 and #746.
- [News contract comparison](https://github.com/footnote-ai/footnote/blob/749a8501b0fce33eedd50ad9828efd71d3228f12/docs/evaluations/baml-news-maintainability-727.md) — #747.
