"""
@description: Tests the OpenJEV runtime harness without importing model dependencies or downloading weights.
@footnote-scope: test
@footnote-module: OpenJevRuntimeBenchmarkTests
@footnote-risk: low - Harness tests only deterministic input/report preparation.
@footnote-ethics: high - Test candidates are synthetic and no external model is invoked.
"""

import unittest
from pathlib import Path

from openjev_runtime_benchmark import (
    DEFAULT_COUNTS,
    DEFAULT_LENGTHS,
    build_candidates,
    build_report,
    collect_measurements,
    parse_args,
    safe_output_path,
    summarize_measurements,
)


class OpenJevRuntimeBenchmarkTests(unittest.TestCase):
    def test_candidate_shapes_cover_requested_batch_and_length_dimensions(self) -> None:
        candidates = build_candidates(DEFAULT_COUNTS[0], DEFAULT_LENGTHS[0])

        self.assertEqual(len(candidates), DEFAULT_COUNTS[0])
        self.assertTrue(all(candidate.startswith("candidate ") for candidate in candidates))
        self.assertTrue(all(len(candidate.split()) == DEFAULT_LENGTHS[0] for candidate in candidates))

    def test_summary_groups_latency_and_reports_partial_status(self) -> None:
        from openjev_runtime_benchmark import BatchMeasurement

        measurements = [
            BatchMeasurement("predict", 10, 32, 10.0, None, None, None, "completed"),
            BatchMeasurement("predict", 10, 32, 20.0, None, None, None, "completed"),
            BatchMeasurement("rerank", 10, 32, None, None, None, None, "unavailable"),
        ]

        summary = summarize_measurements(measurements)

        self.assertEqual(summary["status"], "partial")
        workloads = summary["workloads"]
        self.assertEqual(workloads[0]["p50"], 15.0)
        self.assertEqual(workloads[0]["p95"], 19.5)
        self.assertIsNone(workloads[1]["p95"])

    def test_missing_hypotheses_capability_is_unavailable(self) -> None:
        class FakeCuda:
            @staticmethod
            def is_available() -> bool:
                return False

        class FakeTorch:
            cuda = FakeCuda()

        class FakeModel:
            @staticmethod
            def predict(_pairs: object) -> list[float]:
                return [1.0]

            @staticmethod
            def rerank(_premise: str, _candidates: list[str]) -> list[float]:
                return [1.0]

        args = parse_args(["--candidate-counts", "1", "--candidate-lengths", "2"])
        measurements = collect_measurements(FakeModel(), FakeTorch(), args)

        hypotheses = next(item for item in measurements if item.operation == "predict_hypotheses")
        self.assertEqual(hypotheses.status, "unavailable")

    def test_report_is_blocked_without_revision_and_target_cuda(self) -> None:
        args = parse_args([])
        report = build_report(args)

        self.assertEqual(report["benchmark"], "openjev_runtime_718")
        self.assertIn(report["status"], {"blocked", "unavailable"})
        self.assertEqual(report["coexistence"]["status"], "not_requested")

    def test_generator_command_is_parsed_without_shell_recomposition(self) -> None:
        args = parse_args(["--generator-command", "python", "generator.py", "--port", "9000"])

        self.assertEqual(args.generator_command, ["python", "generator.py", "--port", "9000"])

    def test_output_path_must_remain_inside_working_directory(self) -> None:
        self.assertIsNotNone(safe_output_path(Path("artifacts/result.json")))
        with self.assertRaises(ValueError):
            safe_output_path(Path("../outside-result.json"))


if __name__ == "__main__":
    unittest.main()
