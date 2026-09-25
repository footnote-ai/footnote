# Current Canary `/news` fixture

This isolated fixture ports the `/news` model-facing contract from the older
`@boundaryml/baml@0.226.2` syntax to BAML Canary 0.20.1. It is not imported by
Footnote production code.

The fixture keeps prompt/type co-location, the generated TypeScript target, and
an offline parser test. Footnote's URL, unknown-field, normalization, runtime,
usage, failure, provenance, and TRACE rules remain outside this fixture.
