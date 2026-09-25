# Task E: stale cross-layer representation

The prompt asks for publisherUrl when available, but the typed output source in
the starting variant does not contain it. Find and repair the bounded drift
without changing unrelated runtime ownership.

Do not assume the prompt is authoritative by itself. Verify the contract,
validation, tests, and generated output or BAML source. Report how many seams
the fresh agent had to discover and whether tooling exposed the mismatch.