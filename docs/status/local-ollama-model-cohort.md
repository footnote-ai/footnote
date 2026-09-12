# Local Ollama Model Testing Cohort

This is the current local development cohort for the four Discord persona
slots. It is an experiment configuration, not a production model policy. The
runtime source remains the ignored `.footnote-dev/footnote.local.yaml` and
`.footnote-dev/model-catalog.yaml` override files.

## Local Discord identities

The local server uses four separate Jr Discord applications so Ollama persona
testing cannot accidentally connect the normal/default bots. The local
override changes only the credential environment-variable references; the
persona IDs, display names, aliases, and prompt overlays remain `footnote`,
`danny`, `myuri`, and `winter`. The tracked `footnote.yaml` continues to point
at the normal/default applications.

Load the Jr credentials from a local env file outside the repository before
running `pnpm start`. The server supervisor then launches each configured bot
with its resolved credentials and registers that application's guild commands
at startup. No Jr credential values belong in this repository.

## Hardware envelope

- AMD Radeon RX 7800 XT with 16 GB VRAM
- 32 GB system RAM
- Ollama local runtime

The upper-local Qwen deployment is intentionally allowed to use host-memory
offload. The cohort does not include Qwen3.8 Flash-Next or Ling Flash-VL.

## Persona mapping

| Persona  | Profile                 | Ollama tag                                                   | Local artifact                                                      | Testing role                                                         |
| -------- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Footnote | `ollama-local-footnote` | `qwen3.8:27b-q4_K_M`                                         | Q4_K_M, about 17 GB locally                                         | Upper-local dense quality test                                       |
| Danny    | `ollama-local-danny`    | `hf.co/crucible-labs/Qwen3.6-35B-A3B-REAP-48-v2-GGUF:latest` | Existing Q4_K_M GGUF, about 9.4 GB locally                          | Sparse/MoE efficiency and reasoning comparison                       |
| Myuri    | `ollama-local-myuri`    | `huihui_ai/qwen3.5-abliterated:9b`                           | Existing Qwen3.5 abliterated Q4_K_M fine-tune, about 6.6 GB locally | Behavioral variant and stress case; not stock-Qwen3.5 representative |
| Winter   | `ollama-local-winter`   | `hf.co/inclusionAI/Ling-3.0-tiny-GGUF:Q5_K_M`                | Q5_K_M, about 5.6 GB locally                                        | Edge-efficient architecture test; 1.3B active MoE parameters         |

The built-in image scanner remains on the existing
`hf.co/mradermacher/Qwen2.5-VL-7B-Abliterated-Caption-it-i1-GGUF:Q4_K_M`
local configuration. Vision and persona-model experiments stay separate.

## Reproduction

The two new tags were installed with the normal Ollama commands:

```text
ollama pull qwen3.8:27b-q4_K_M
ollama pull hf.co/inclusionAI/Ling-3.0-tiny-GGUF:Q5_K_M
```

The existing Danny, Myuri, and Qwen2.5-VL tags were already available locally.
Use `ollama ls` to verify local tags and `ollama show <tag>` to inspect the
resolved model metadata. This page records the configured cohort; it does not
claim that these models are universally best or that one quantization result
generalizes to every provider or deployment.
