# Ollama Provider Controls and Observations

Footnote profiles may request Ollama's native `think` control for one model.
The capability list is an explicit declaration of values discovered for that
model with Ollama's `/api/show`; a declared value is not inferred from a model
name or assumed to work for other profiles.

```yaml
capabilities:
    canUseSearch: false
    supportedOllamaThinkingControls: [false, low, medium, high]
providerOptions:
    ollama:
        think: high
```

The backend forwards the profile's provider options with its generation
request. The runtime applies the setting only when the selected provider is
Ollama and that exact value appears in `supportedOllamaThinkingControls`.
Unknown or unsupported controls are recorded as ignored, and generation
continues without the control. It does not change the TrustGraph default.

VoltAgent remains the generation orchestrator. Boolean controls use its
existing Ollama provider mapping. The installed `ollama-ai-provider-v2` schema
accepts only boolean `think` values, so the runtime uses that provider's
request-fetch seam only for explicitly supported named strings; the normal
VoltAgent `Agent.generateText` path still owns message projection, tools,
structured output, cancellation, usage mapping, and error handling.

The attempt record may include an `ollama` observation with
`provider_reported` authority. Its allowlist contains the response's model,
digest, native duration values in nanoseconds, prompt/evaluation counts, and a
boolean indicating whether a thinking field was present. These provider
durations are not Footnote-observed wall time and are not converted to
milliseconds. Missing values stay unavailable. Hidden reasoning text is never
copied into the Footnote result or Attempt record, and no reasoning-token count
is synthesized from these observations.

The canonical Attempt observation is the handoff surface for later timing and
telemetry work: #565 can consume the provider's nanosecond facts alongside
Footnote wall time, and #584 can choose an explicit privacy-safe telemetry
projection using the recorded source and authority. This change adds neither a
parallel store nor an outbound telemetry exporter.
