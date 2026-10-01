# Context Retrieval and Knowledge Reporting

Status: completed by [PR #538](https://github.com/footnote-ai/footnote/pull/538) for [issue #533](https://github.com/footnote-ai/footnote/issues/533). The backend now separates conversation and prompt context from retrieved evidence and reports source state truthfully. The implementation did not add source-code retrieval or a general claim verifier.

The separate follow-up for bounded, revision-aware source-code retrieval is [#539](https://github.com/footnote-ai/footnote/issues/539). Current context integration behavior is documented under [Context Integrations](../../architecture/context-integrations/README.md).
