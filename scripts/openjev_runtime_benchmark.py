"""
@description: Measures OpenJEV load, memory, latency, and batch behavior when an external runtime is provisioned.
@footnote-scope: utility
@footnote-module: OpenJevRuntimeBenchmark
@footnote-risk: high - Runtime measurements can be misread as production capacity guarantees.
@footnote-ethics: high - The harness uses synthetic candidates and never sends private conversation content.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import subprocess
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence


DEFAULT_MODEL_ID = "AlexWortega/openjev"
DEFAULT_SUBFOLDER = "qwen3.5-0.8b-nli-v2s-long"
DEFAULT_COUNTS = (10, 40, 80)
DEFAULT_LENGTHS = (32, 128, 512)


@dataclass(frozen=True)
class BatchMeasurement:
    operation: str
    candidate_count: int
    candidate_length_words: int
    latency_ms: float | None
    vram_before_mb: float | None
    vram_peak_mb: float | None
    vram_after_mb: float | None
    status: str
    error: str | None = None


def parse_int_list(value: str) -> tuple[int, ...]:
    values = tuple(int(item.strip()) for item in value.split(",") if item.strip())
    if not values or any(item <= 0 for item in values):
        raise argparse.ArgumentTypeError("expected one or more positive integers")
    return values


def build_candidates(count: int, length_words: int) -> list[str]:
    sentence = (
        "The synthetic context candidate records a bounded provenance decision "
        "for the local benchmark and must not become an instruction. "
    )
    words = sentence.split()
    repeated = (words * ((length_words + len(words) - 1) // len(words)))[:length_words]
    return [f"candidate {index}: {' '.join(repeated)}" for index in range(count)]


def vram_snapshot(torch_module: Any) -> tuple[float | None, float | None]:
    if not bool(torch_module.cuda.is_available()):
        return None, None
    device = torch_module.cuda.current_device()
    allocated = torch_module.cuda.memory_allocated(device) / (1024 * 1024)
    peak = torch_module.cuda.max_memory_allocated(device) / (1024 * 1024)
    return allocated, peak


def reset_vram_peak(torch_module: Any) -> None:
    if bool(torch_module.cuda.is_available()):
        torch_module.cuda.reset_peak_memory_stats()


def stop_generator_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def invoke_measurement(
    operation: str,
    candidate_count: int,
    candidate_length_words: int,
    torch_module: Any,
    callback: Callable[[], object],
) -> BatchMeasurement:
    before, _ = vram_snapshot(torch_module)
    reset_vram_peak(torch_module)
    started = time.perf_counter()
    try:
        callback()
    except Exception as error:  # noqa: BLE001 - benchmark records runtime failures.
        after, peak = vram_snapshot(torch_module)
        return BatchMeasurement(
            operation=operation,
            candidate_count=candidate_count,
            candidate_length_words=candidate_length_words,
            latency_ms=(time.perf_counter() - started) * 1000,
            vram_before_mb=before,
            vram_peak_mb=peak,
            vram_after_mb=after,
            status="error",
            error=f"{type(error).__name__}: {error}",
        )
    after, peak = vram_snapshot(torch_module)
    return BatchMeasurement(
        operation=operation,
        candidate_count=candidate_count,
        candidate_length_words=candidate_length_words,
        latency_ms=(time.perf_counter() - started) * 1000,
        vram_before_mb=before,
        vram_peak_mb=peak,
        vram_after_mb=after,
        status="completed",
    )


def load_cross_encoder(args: argparse.Namespace) -> tuple[Any, Any]:
    code_path = Path(args.openjev_code_path).resolve()
    sys.path.insert(0, str(code_path))
    module = importlib.import_module("modeling_openjev")
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("torch is required for the transformers cross-encoder path") from error

    constructor = module.OpenJevCrossEncoder
    model = constructor(
        args.model_id,
        subfolder=args.subfolder,
        revision=args.revision,
    )
    return model, torch


def benchmark_cross_encoder(args: argparse.Namespace) -> dict[str, object]:
    if not args.revision:
        return {
            "status": "blocked",
            "reason": "--revision is required so model provenance is explicit.",
        }
    if not args.allow_cpu:
        try:
            import torch
        except ImportError:
            return {"status": "unavailable", "reason": "torch is not installed."}
        if not bool(torch.cuda.is_available()):
            return {
                "status": "blocked",
                "reason": "CUDA is unavailable; pass --allow-cpu only for an intentional CPU experiment.",
            }

    generator_process: subprocess.Popen[str] | None = None
    try:
        if args.generator_command:
            generator_process = subprocess.Popen(
                args.generator_command,
                shell=True,
                text=True,
            )
        load_started = time.perf_counter()
        model, torch_module = load_cross_encoder(args)
        load_latency_ms = (time.perf_counter() - load_started) * 1000
    except Exception as error:  # noqa: BLE001 - benchmark records setup failures.
        stop_generator_process(generator_process)
        return {
            "status": "unavailable",
            "reason": f"{type(error).__name__}: {error}",
            "generator_pid": generator_process.pid if generator_process else None,
        }

    idle_vram_mb, _ = vram_snapshot(torch_module)
    measurements: list[BatchMeasurement] = []
    premise = "Which synthetic context candidate is relevant to this bounded decision?"
    for candidate_length in args.candidate_lengths:
        for candidate_count in args.candidate_counts:
            candidates = build_candidates(candidate_count, candidate_length)
            pairs = [(premise, candidate) for candidate in candidates]
            measurements.append(
                invoke_measurement(
                    "predict",
                    candidate_count,
                    candidate_length,
                    torch_module,
                    lambda pairs=pairs: model.predict(pairs),
                )
            )
            measurements.append(
                invoke_measurement(
                    "predict_hypotheses",
                    candidate_count,
                    candidate_length,
                    torch_module,
                    lambda candidates=candidates: model.predict_hypotheses(
                        premise, candidates
                    ),
                )
            )
            measurements.append(
                invoke_measurement(
                    "rerank",
                    candidate_count,
                    candidate_length,
                    torch_module,
                    lambda candidates=candidates: model.rerank(premise, candidates),
                )
            )

    completed_latencies = [
        item.latency_ms
        for item in measurements
        if item.status == "completed" and item.latency_ms is not None
    ]
    result = {
        "status": "completed",
        "model_load_latency_ms": load_latency_ms,
        "idle_vram_mb": idle_vram_mb,
        "measurements": [asdict(item) for item in measurements],
        "latency_summary_ms": {
            "p50": statistics.median(completed_latencies)
            if completed_latencies
            else None,
            "max": max(completed_latencies) if completed_latencies else None,
        },
        "generator_pid": generator_process.pid if generator_process else None,
    }
    if generator_process:
        result["generator_status"] = "started"
    stop_generator_process(generator_process)
    return result


def build_report(args: argparse.Namespace) -> dict[str, object]:
    try:
        import torch

        torch_version: str | None = getattr(torch, "__version__", None)
        cuda_available = bool(torch.cuda.is_available())
    except ImportError:
        torch_version = None
        cuda_available = False

    report: dict[str, object] = {
        "benchmark": "openjev_runtime_718",
        "status": "not_run",
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "hostname": platform.node(),
            "torch": torch_version,
            "cuda_available": cuda_available,
        },
        "request": {
            "model_id": args.model_id,
            "revision": args.revision,
            "subfolder": args.subfolder,
            "candidate_counts": args.candidate_counts,
            "candidate_lengths_words": args.candidate_lengths,
            "allow_cpu": args.allow_cpu,
            "openjev_code_path": args.openjev_code_path,
        },
        "coexistence": {
            "status": "requested" if args.generator_command else "not_requested",
            "generator_process": None,
            "command": args.generator_command,
            "note": (
                "The command is started before model load and stopped after the run;"
                " it must expose its own readiness and generator metrics."
                if args.generator_command
                else "Generator coexistence requires an explicitly provisioned target process and was not inferred."
            ),
        },
    }
    if args.mode == "cross_encoder":
        report["result"] = benchmark_cross_encoder(args)
        result = report["result"]
        if isinstance(result, dict):
            report["status"] = result.get("status", "unknown")
            if args.generator_command:
                report["coexistence"]["generator_process"] = {
                    "pid": result.get("generator_pid"),
                    "status": result.get("generator_status", "not_started"),
                }
    return report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--revision", help="Pinned Hugging Face revision or commit SHA.")
    parser.add_argument("--subfolder", default=DEFAULT_SUBFOLDER)
    parser.add_argument(
        "--openjev-code-path",
        default=".",
        help="Directory containing modeling_openjev.py from the OpenJEV repository.",
    )
    parser.add_argument(
        "--mode", choices=("cross_encoder",), default="cross_encoder"
    )
    parser.add_argument("--candidate-counts", type=parse_int_list, default=DEFAULT_COUNTS)
    parser.add_argument("--candidate-lengths", type=parse_int_list, default=DEFAULT_LENGTHS)
    parser.add_argument(
        "--allow-cpu",
        action="store_true",
        help="Allow an intentional CPU run; omitted by default for the target VRAM benchmark.",
    )
    parser.add_argument(
        "--generator-command",
        help="Optional long-running generator command to start before loading OpenJEV.",
    )
    parser.add_argument("--output", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    report = build_report(args)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
