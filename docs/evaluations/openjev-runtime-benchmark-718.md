# OpenJEV runtime benchmark (#718)

This harness is a reproducible, opt-in measurement tool for the OpenJEV runtime
experiment. It does not change Footnote runtime behavior and does not download
weights unless a user provisions the dependencies and invokes it with a pinned
model revision.

## Current machine status

The current workstation reports Python 3.13.5, `torch 2.11.0+cpu`, and no CUDA
runtime. The default invocation therefore stops before model import:

```powershell
python scripts/openjev_runtime_benchmark.py `
  --output artifacts/openjev-runtime-718/availability.json
```

Observed result: `blocked`, because `--revision` is required for explicit model
provenance. Even with a revision, this workstation cannot run the target VRAM
benchmark without CUDA. No OpenJEV weights were downloaded and no result is
being presented as an inference measurement.

## Target invocation

Run on a machine with CUDA, Transformers, the OpenJEV source checkout, and the
pinned model revision:

```powershell
python scripts/openjev_runtime_benchmark.py `
  --revision <model-or-commit-revision> `
  --openjev-code-path <path-to-openjev-source> `
  --output artifacts/openjev-runtime-718/<run-id>.json
```

Defaults cover the required 10, 40, and 80 candidate batches and 32, 128, and
512-word candidate lengths. The harness records model load time, idle and
per-process peak VRAM, grouped p50/p95 latency by operation and workload shape,
completion/error status, and the exact request. It also records the harness
revision, OpenJEV checkout revision, accelerator model, and total VRAM when
available.
It exercises `predict`, `predict_hypotheses`, and `rerank` where the provisioned
OpenJEV API exposes them.

The model and API assumptions are based on the upstream OpenJEV README:
[OpenJEV README](https://huggingface.co/AlexWortega/openjev/blob/main/README.md).
The revision is deliberately required at the CLI boundary so a result cannot
silently drift to a different model revision.

## Generator coexistence

An explicitly supplied long-running generator command can be started before
OpenJEV loads:

```powershell
python scripts/openjev_runtime_benchmark.py `
  --revision <revision> `
  --openjev-code-path <path-to-openjev-source> `
  --output artifacts/openjev-runtime-718/<coexistence-run-id>.json `
  --generator-command python <generator script> --<generator-arg> <value>
```

The harness records the command and process id, then terminates that process
when the run ends. The command must provide its own readiness and generator
metrics; this harness does not infer generator health, cross-process VRAM peak,
or overlap quality from process existence. Use a dedicated, disposable target
machine and synthetic inputs. Never pass private conversation or attachment
content to a newly provisioned model/provider without explicit authorization.

## Interpreting results

Record the exact model revision, runtime versions, quantization, hardware,
context settings, and batch parameters alongside each run. A successful load is
not evidence that OpenJEV can remain resident with Footnote's local generator.
The #718 issue remains blocked until a suitable CUDA/weights environment
produces real measurements for load size, peak VRAM, sequential and overlapping
coexistence, throughput, load/unload cost, and failure behavior under memory
pressure.
