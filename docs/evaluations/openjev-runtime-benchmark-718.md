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

The WSL path now runs the model. `rocminfo` sees an `AMD Radeon RX 7800 XT`,
and PyTorch reports a HIP accelerator with about 16.2 GB of device memory.
This is a real model-backed result, not a CUDA fallback.

The result uses WSL2 with Ubuntu 24.04, ROCm 7.2, ROCDXG 1.2.2, and AMD's
PyTorch 2.9.1 ROCm wheel. Native Windows Python is still a separate path and
was not used for this run.

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

The benchmark accepts a local model directory, or downloads the requested
Hugging Face revision into a local snapshot before loading it. The model
constructor itself does not accept a `revision` argument, so resolving the
revision before loading prevents the benchmark from silently using different
weights.

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
| WSL2 + ROCDXG/ROCm          | Best path on this Windows desktop. This path was validated on the RX 7800 XT with `/dev/dxg`, ROCm 7.2, and ROCDXG 1.2.2.                                                                                                                                                                              |
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

One coexistence run kept Ollama's existing `reap48-fixed:latest` model loaded.
Ollama reported that model as 9.8 GB and 100% GPU resident. OpenJEV then loaded
and completed the 10/40/80-candidate, 32-word run without an out-of-memory
failure. OpenJEV's per-process peak was 2.66 GB, and its model-load time in
that run was 15.9 seconds. These are separate process measurements, not a full
GPU accounting report, and overlapping generation requests were not tested.

Use synthetic inputs only. Never send private conversation or attachment
content to a newly provisioned model/provider without explicit authorization.

## First AMD measurements

The tested model was `AlexWortega/openjev`, subfolder
`qwen3.5-0.8b-nli-v2s-long`, revision
`058a6c24911b46d908fbe23541390f8af3df3e4d`. The reference implementation used
Transformers 5.17.0 and OpenJEV's checked-out `modeling_openjev.py` on Python
3.12.3. PyTorch was `2.9.1+rocm7.2.0.git7e1940d4`, with HIP
`7.2.26015-fc0010cf6a`. The harness reported 16,176.99 MB total device memory.

The table shows one measurement per workload, so these are early capacity
measurements rather than stable p50/p95 production numbers. Larger candidate
batches often amortized fixed model overhead; do not treat one row as a
repeated-load latency distribution.

| Operation | Candidates | Words each | Latency | Peak process VRAM |
| --------- | ---------: | ---------: | ------: | ----------------: |
| `predict` |         10 |         32 |   6.0 s |          1,995 MB |
| `predict` |         40 |         32 |   2.2 s |          2,660 MB |
| `predict` |         80 |         32 |   1.2 s |          2,660 MB |
| `predict` |         10 |        128 |   7.7 s |          2,139 MB |
| `predict` |         40 |        128 |   3.3 s |          3,112 MB |
| `predict` |         80 |        128 |   2.6 s |          3,110 MB |
| `predict` |         10 |        512 |  10.7 s |          2,650 MB |
| `predict` |         40 |        512 |   6.3 s |          4,823 MB |
| `predict` |         80 |        512 |   6.9 s |          4,821 MB |

The direct Transformers reference path completed all 10/40/80 workloads at
32, 128, and 512 words on the RX 7800 XT. The upstream Python object did not
provide `predict_hypotheses`, so those rows are explicitly marked unavailable
by the harness rather than inferred. A three-case semantic smoke test also
returned the expected contradiction, entailment, and neutral labels.

These results show that the target hardware can run the small model. They do
not show that OpenJEV improves context selection, that SGLang works on this
machine, or that a permanent sidecar is worthwhile.

## Exact remaining blocker

The RX 7800 XT reference benchmark is no longer blocked. A temporary Python
reference server also accepted the documented `/classify` request shape, and
the existing TypeScript client completed all 10/40/80 candidate batches at 32,
128, and 512 words. This server was an experiment only. It was not SGLang and
it is not part of Footnote.

The warm TypeScript-to-HTTP measurements were:

| Candidates | 32 words | 128 words | 512 words |
| ---------: | -------: | --------: | --------: |
|         10 |   0.15 s |    0.54 s |    1.09 s |
|         40 |   0.36 s |    1.98 s |    4.74 s |
|         80 |   0.63 s |    2.01 s |    6.11 s |

These are one request per workload after the model was warm. They measure the
HTTP client and reference server together, not a production server's stable
latency distribution. A concurrent test also kept `reap48-fixed:latest`
resident in Ollama while the TypeScript client sent the 32-word batches. The
generator completed a 256-token request during the same interval, and neither
process reported an out-of-memory error. The test did not collect total device
telemetry or test multiple simultaneous requests.

The remaining runtime work is narrower: run the OpenJEV SGLang `/classify`
server, or another supported server, on the same AMD setup and repeat the
measurements with server-side model identity, memory telemetry, cancellation,
and concurrent load. Those results are needed before treating an HTTP model
server as a realistic Footnote integration option.

## Interpretation

These measurements will be compared with the strong cheap baselines from #717:
BM25 text search and bounded deterministic conversation expansion. OpenJEV is a
challenger, not the assumed solution. A small aggregate gain at much higher
runtime cost would not by itself justify a new Footnote runtime abstraction.
