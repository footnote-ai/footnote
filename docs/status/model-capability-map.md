# Current model deployment map

This view is generated from the versioned registry. It records current evidence and maintainer judgments; it is not a universal ranking or production routing policy.

## Current assessment

- **2026-09-12 — local-ollama-cohort (maintainer judgment):** Keep this cohort as experiment setup only; it is not production model policy and does not establish a universally best model or transferable quantization result.
  Evidence: [local-ollama-cohort](./local-ollama-model-cohort.md).

## Deployments

Every deployment in the current local Ollama cohort is experimental. No per-deployment production recommendation or live result is recorded.

### ollama-local-footnote

- **Model:** Qwen3.8 — qwen3.8:27b-q4_K_M
- **Role:** upper-local dense quality test (maintainer judgment)
- **Runtime:** Ollama; local development; Q4_K_M; about 17 GB locally.
- **Hardware:** AMD Radeon RX 7800 XT 16 GB VRAM; 32 GB system RAM.
- **Unknown:** model revision, artifact digest, Ollama version, supported Ollama thinking controls.
- **Evidence:** [local-ollama-cohort](./local-ollama-model-cohort.md), [ollama-provider-controls](./ollama-provider-controls.md).

### ollama-local-danny

- **Model:** Qwen3.6 — hf.co/crucible-labs/Qwen3.6-35B-A3B-REAP-48-v2-GGUF:latest
- **Role:** sparse/MoE efficiency and reasoning comparison (maintainer judgment)
- **Runtime:** Ollama; local development; Q4_K_M; about 9.4 GB locally.
- **Hardware:** AMD Radeon RX 7800 XT 16 GB VRAM; 32 GB system RAM.
- **Unknown:** model revision, Ollama version, supported Ollama thinking controls.
- **Evidence:** [local-ollama-cohort](./local-ollama-model-cohort.md), [ollama-provider-controls](./ollama-provider-controls.md).

### ollama-local-myuri

- **Model:** Qwen3.5 — huihui_ai/qwen3.5-abliterated:9b
- **Role:** behavioral variant and stress case; not stock-Qwen3.5 representative (maintainer judgment)
- **Runtime:** Ollama; local development; Q4_K_M; about 6.6 GB locally.
- **Hardware:** AMD Radeon RX 7800 XT 16 GB VRAM; 32 GB system RAM.
- **Unknown:** model revision, artifact digest, Ollama version, supported Ollama thinking controls.
- **Evidence:** [local-ollama-cohort](./local-ollama-model-cohort.md), [ollama-provider-controls](./ollama-provider-controls.md).

### ollama-local-winter

- **Model:** Ling 3.0 — hf.co/inclusionAI/Ling-3.0-tiny-GGUF:Q5_K_M
- **Role:** edge-efficient architecture test; 1.3B active MoE parameters (maintainer judgment)
- **Runtime:** Ollama; local development; Q5_K_M; about 5.6 GB locally.
- **Hardware:** AMD Radeon RX 7800 XT 16 GB VRAM; 32 GB system RAM.
- **Unknown:** model revision, artifact digest, Ollama version, supported Ollama thinking controls.
- **Evidence:** [local-ollama-cohort](./local-ollama-model-cohort.md), [ollama-provider-controls](./ollama-provider-controls.md).

## Live evaluation

not run or scheduled; no observation date or model/deployment is linked.
