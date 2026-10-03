# Provider Retention

Provider request settings and Footnote-owned storage are separate. The trace
`providerRetention` field records configured/request-side posture only; it does
not verify provider account settings, upstream routing, or deletion.

| Path                                             | Request/configuration posture                                                                              | Limits                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OpenAI text, planner, review, and presentation   | OpenAI calls set `store: false`.                                                                           | This is not a claim that OpenAI retains no data under account or safety policies.          |
| OpenRouter model calls                           | Profiles may set `dataCollection` and `zdr`; the request carries those routing options.                    | A request is not proof that OpenRouter or its selected upstream honored the setting.       |
| Ollama text and image description                | `OLLAMA_BASE_URL` determines local versus remote; local inference still requires the existing opt-in.      | A remote Ollama endpoint has its own provider/account policy; Footnote cannot verify it.   |
| OpenAI image generation                          | Responses are retained because the Discord variation flow uses `previous_response_id` on follow-ups.       | This path is stateful; traces mark that state use and make no ZDR claim.                   |
| Image description, embeddings, TTS, and Realtime | These paths do not have a shared, supported request-storage control in their current adapters.             | Provider/account retention is unknown; the request continues without blocking.             |
| Search and provider tools                        | Configured search integrations and provider-native tools send query/context to their configured providers. | Retention depends on the endpoint and account policy; no Footnote verification is implied. |

Footnote separately stores traces, operational logs, context state, and incident
records under their own storage behavior. Provider request flags do not change
those stores or establish their deletion schedule. Review the relevant
deployment and storage configuration independently.
