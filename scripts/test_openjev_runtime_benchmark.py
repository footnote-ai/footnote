"""
@description: Tests the OpenJEV runtime harness without importing model dependencies or downloading weights.
@footnote-scope: test
@footnote-module: OpenJevRuntimeBenchmarkTests
@footnote-risk: low - Harness tests only deterministic input/report preparation.
@footnote-ethics: high - Test candidates are synthetic and no external model is invoked.
"""

import unittest

from openjev_runtime_benchmark import (
    DEFAULT_COUNTS,
    DEFAULT_LENGTHS,
    build_candidates,
    build_report,
    parse_args,
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


if __name__ == "__main__":
    unittest.main()
