# Task D: malformed result regression

A fixture now contains an article with a malformed url and an unknown related
field. Diagnose the contract-drift path and add a regression test that keeps
the strict Footnote boundary understandable: malformed URLs and unknown fields
must not silently become accepted domain output.

Preserve fail-open behavior where the existing service intentionally recovers
weak timestamps. Do not replace strict validation with tolerant parsing.
Record whether the variant's tooling points to the right source of truth.