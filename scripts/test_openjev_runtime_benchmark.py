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
    parse_args,
    safe_output_path,
)


class OpenJevRuntimeBenchmarkTests(unittest.TestCase):
    def test_candidate_shapes_cover_requested_batch_and_length_dimensions(self) -> None:
        candidates = build_candidates(DEFAULT_COUNTS[0], DEFAULT_LENGTHS[0])

        self.assertEqual(len(candidates), DEFAULT_COUNTS[0])
        self.assertTrue(all(candidate.startswith("candidate ") for candidate in candidates))
        self.assertTrue(all(len(candidate.split()) >= DEFAULT_LENGTHS[0] for candidate in candidates))

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
