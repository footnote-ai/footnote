# OpenJEV runtime benchmark (#718)

This is a reproducible, opt-in benchmark for answering one practical question:

> Can a small OpenJEV model run beside Footnote's local generator on a 16 GB
> AMD Radeon RX 7800 XT?

The benchmark does not change Footnote behavior. It does not add Python to the
Footnote project and it does not download model weights unless an operator
explicitly provisions the benchmark environment and supplies a pinned model
revision.

## Short answer so far

The RX 7800 XT is present on the current Windows machine. The earlier result
that reported `torch 2.11.0+cpu` only showed that the current Python install
was CPU-only. It did **not** show that the AMD card cannot run OpenJEV.

The next real run should use either:

1. Linux with ROCm, or
2. WSL2 with AMD's ROCDXG/ROCm support.

The current WSL installation is not ready yet: it has Ubuntu 24.04.4 and
`/dev/dxg`, but no ROCm installation, `rocminfo`, `rocm-smi`, `/dev/kfd`, or
OpenJEV weights. No model-backed result is available yet.

## Why Python appears here

OpenJEV's upstream reference implementation is Python code built around
Transformers. The reference path is useful for checking that we are measuring
the model correctly. OpenJEV also provides a Python package for its SGLang
server because SGLang needs custom sequence-classification support.

That makes Python a **benchmark/server dependency**, not a Footnote dependency:

- Footnote remains TypeScript.
- No Python package or root-level Python toolchain was added.
- A future Footnote integration should call a separately managed model server
  over HTTP rather than importing Python into the backend.

## Two benchmark paths

### 1. Python reference path

`openjev_runtime_benchmark.py` follows the upstream Transformers-style API and
exercises `predict`, `predict_hypotheses`, and `rerank` when the checked-out
OpenJEV code provides them. It measures model load time, latency, batch size,
candidate length, and PyTorch-reported per-process memory.

PyTorch's ROCm build uses the same `torch.cuda`-compatible API surface for
device access. The harness therefore reports a generic accelerator state and
recognizes ROCm/HIP; `cuda_available` is retained in the JSON only for
compatibility with the first harness version.

Run it in a separately provisioned environment:

```powershell
python scripts/openjev_runtime_benchmark.py `
  --revision <model-or-commit-revision> `
  --openjev-code-path <path-to-openjev-source> `
  --output artifacts/openjev-runtime-718/<run-id>.json
```

The defaults cover 10, 40, and 80 candidates with 32, 128, and 512-word
inputs. The revision is required so a result cannot silently drift to another
model version.

### 2. TypeScript HTTP path

The TypeScript driver calls an already-started OpenJEV-compatible server at
`POST /classify`. The upstream OpenJEV SGLang client sends a batch of premise /
hypothesis texts and receives three raw scores for contradiction, entailment,
and neutral. This is a much closer shape to a future Footnote integration than
embedding Python in the backend.

The driver uses Node's built-in `fetch`; it adds no package dependency:

```powershell
pnpm exec tsx scripts/openjev_http_benchmark.ts `
  --url http://127.0.0.1:30000 `
  --model-id AlexWortega/openjev `
  --revision <model-or-commit-revision> `
  --output artifacts/openjev-runtime-718/<http-run-id>.json
```

The server is started separately with its pinned model and runtime. The HTTP
benchmark records 10/40/80 candidate batches, 32/128/512-word inputs,
latency, pairs per second, response-shape errors, and the expected model
identity/revision. It does not pretend that an HTTP response proves the model
was loaded with the expected weights; the server setup must record that too.

The documented boundary gives us batch classification and raw three-value
scores. It does not, by itself, define a Footnote health endpoint or guarantee
that an aborted HTTP request cancels GPU work. The benchmark uses an HTTP
timeout; a future wrapper would need to add health, loaded-model identity, and
server-side cancellation semantics if Footnote needs them.

## AMD runtime options

| Path                        | Current assessment                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native Windows PyTorch/ROCm | Not the first path to recommend. AMD's current Windows matrix does not list the RX 7800 XT, and the full ROCm stack is not supported on Windows.                                                                                                                                                       |
| Native Linux + ROCm         | Cleanest reference environment. AMD's current Linux matrix lists the RX 7800 XT and supported PyTorch/ROCm combinations.                                                                                                                                                                               |
| WSL2 + ROCDXG/ROCm          | Best path to try on this Windows desktop. AMD's current WSL matrix lists the RX 7800 XT, but the current WSL install still needs the supported driver and ROCm/ROCDXG packages.                                                                                                                        |
| SGLang `/classify`          | Best candidate for a TypeScript client because OpenJEV documents this server boundary. AMD support is still a candidate to validate, not a completed result.                                                                                                                                           |
| llama.cpp or Ollama         | Not the primary path. Those projects can use AMD backends in general, but OpenJEV is a custom three-score sequence classifier and does not currently provide an official GGUF/Ollama execution path. Prompting a text generator and reparsing prose would lose the model's intended classifier output. |

Primary references:

- [OpenJEV README and model card](https://huggingface.co/AlexWortega/openjev/blob/main/README.md)
- [AMD Linux Radeon compatibility](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/native_linux/native_linux_compatibility.html)
- [AMD Windows Radeon compatibility](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/windows/windows_compatibility.html)
- [AMD WSL ROCm guide](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/install/installrad/wsl/howto_wsl.html)
- [ROCm/librocdxg compatibility](https://github.com/ROCm/librocdxg/)
- [AMD SGLang serving notes](https://rocm.docs.amd.com/projects/ai-ecosystem/en/latest/inference/sglang.html)
- [PyTorch installation selector](https://pytorch.org/get-started/locally/)

## Generator coexistence

The useful question is not whether OpenJEV loads by itself. It is whether it
can coexist with the local generator Footnote normally uses. A provisioned run
should measure, separately:

- generator alone memory;
- OpenJEV alone memory;
- both resident;
- sequential requests;
- overlapping requests;
- latency impact;
- out-of-memory behavior;
- unload/reload cost if both cannot remain resident.

The Python harness can start an explicitly supplied disposable generator command
before loading OpenJEV. The HTTP path can test the same server arrangement from
TypeScript. Neither harness infers cross-process GPU memory or generator health
from process existence alone.

Use synthetic inputs only. Never send private conversation or attachment
content to a newly provisioned model/provider without explicit authorization.

## Exact current blocker

Real model-backed benchmarking still requires provisioning and validating a
ROCm/ROCDXG environment for the RX 7800 XT, then starting a pinned OpenJEV
Transformers or SGLang server and running the reference and HTTP benchmarks.
The blocker is not simply “no CUDA.” The current machine has the AMD GPU, but
the available Python and WSL environments do not yet have a supported
accelerator runtime or model weights.

## Interpretation

These measurements will be compared with the strong cheap baselines from #717:
BM25 text search and bounded deterministic conversation expansion. OpenJEV is a
challenger, not the assumed solution. A small aggregate gain at much higher
runtime cost would not by itself justify a new Footnote runtime abstraction.
