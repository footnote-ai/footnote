# Domain Docs

Use the repository's current architecture and code to understand its terms.
There is no single glossary or ADR directory; the maintained material is
organized by purpose:

- `docs/architecture/` describes current system behavior and boundaries.
- `docs/status/` records implementation state and remaining verification.
- `docs/decisions/` records decisions and their rationale.
- `docs/proposals/` holds ideas that are exploratory or not adopted.

Start with the relevant page in
[the architecture guide](../architecture/README.md), then follow its links to
the owning package, contracts, and tests. Treat proposals as proposals and
status documents as snapshots, not as a replacement for current code.

When terminology differs across sources, use the current contract and
implementation for behavior, and call out a genuine documentation conflict
rather than silently inventing a new term or decision.
