# NYC September 11 archive preview

The `/explore/nyc-sept11` experience is a deliberately bounded, signed-in
preview. It is disabled unless all three process settings are present:

- `FOOTNOTE_ARCHIVE_PREVIEW_ENABLED=true`
- `FOOTNOTE_ARCHIVE_SERVICE_URL=<private archive-service URL>`
- `FOOTNOTE_ARCHIVE_SERVICE_TOKEN=<secret>`

The backend sends only the user's query to the fixed private archive service,
then gives the fixed DeepSeek V4 Flash 0731 generation path the returned source
excerpts. The request cannot select a collection, flow, model, URL, result
count, web search, project context, or personal context. Answers are accepted
only when deterministic `[S1]`–`[S5]` citation validation succeeds or the model
explicitly states that the indexed records do not establish the answer.

Archive metadata is additive to normal response metadata and contains only
serializable document/page pointers. The service and Footnote logs do not
record query text or source bodies. `completeArchive` is always `false` and the
preview must not be advertised as the complete NYC September 11 archive.

This feature does not ingest tranche 1, alter generic `/api/chat` behavior, or
replace the existing TrustGraph graph-RAG integration. Private deployment is a
separate operational step and must remain disabled until the archive-service
preflight and frozen benchmark gates pass.
