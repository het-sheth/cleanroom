#!/usr/bin/env python3
"""Offline tests for scripts/redact_baseline.py. Stdlib only, no network.

Run: python3 -m unittest discover -s scripts -p 'test_*.py'
"""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import redact_baseline as rb  # noqa: E402


class ExtractDetections(unittest.TestCase):
    def test_stale_offsets_are_recovered(self):
        text = "call Dana Voss today"
        dets = rb.extract_detections(
            {"entities": [{"label": "person", "text": "Dana Voss", "start": 0, "end": 3,
                           "score": 0.9}]},
            text,
        )
        self.assertEqual([(d["start"], d["end"]) for d in dets], [(5, 14)])
        self.assertNotIn("unlocatable", dets[0])

    def test_unlocatable_span_is_kept_not_dropped(self):
        # Fail-closed regression: the detector reported PII whose text is nowhere in the
        # transcript (normalized form). Dropping it would leave it unredacted.
        text = "call 555 867 5309 today"
        dets = rb.extract_detections(
            {"entities": [{"label": "phone", "text": "555-867-5309", "score": 0.9}]}, text
        )
        self.assertEqual(len(dets), 1)
        self.assertEqual(dets[0]["start"], None)
        self.assertEqual(dets[0]["end"], None)
        self.assertTrue(dets[0]["unlocatable"])

    def test_grouped_dict_shape_also_keeps_unlocatable(self):
        text = "nothing here"
        dets = rb.extract_detections(
            {"entities": {"ssn": [{"text": "123-45-6789", "score": 0.8}]}}, text
        )
        self.assertEqual(len(dets), 1)
        self.assertTrue(dets[0]["unlocatable"])

    def test_duplicate_text_maps_to_successive_occurrences(self):
        text = "mail nvoss@x.com then nvoss@x.com"
        hit = {"label": "email", "text": "nvoss@x.com", "score": 0.9}
        dets = rb.extract_detections({"entities": [dict(hit), dict(hit)]}, text)
        self.assertEqual([d["start"] for d in dets], [5, 22])


class Redact(unittest.TestCase):
    def test_unlocatable_span_scrubbed_by_literal_text(self):
        text = "ping nvoss@x.com and nvoss@x.com"
        dets = [
            {"type": "email", "text": "nvoss@x.com", "start": 5, "end": 16, "confidence": 0.9},
            {"type": "email", "text": "nvoss@x.com", "start": None, "end": None,
             "confidence": 0.9, "unlocatable": True},
        ]
        out, unresolved = rb.redact(text, dets)
        self.assertNotIn("nvoss@x.com", out)
        self.assertEqual(out, "ping [EMAIL_1] and [EMAIL_1]")
        self.assertEqual(unresolved, [{"type": "email", "token": "[EMAIL_1]", "scrubbed": True}])

    def test_unscrubbable_span_is_reported_not_silently_omitted(self):
        text = "call 555 867 5309 today"
        dets = [{"type": "phone", "text": "555-867-5309", "start": None, "end": None,
                 "confidence": 0.9, "unlocatable": True}]
        out, unresolved = rb.redact(text, dets)
        self.assertEqual(out, text)
        self.assertEqual(unresolved,
                         [{"type": "phone", "token": "[PHONE_1]", "scrubbed": False}])

    def test_partial_overlap_keeps_higher_confidence(self):
        text = "abcdefghij"
        low = {"type": "person", "text": "abcdef", "start": 0, "end": 6, "confidence": 0.4}
        high = {"type": "email", "text": "defghi", "start": 3, "end": 9, "confidence": 0.9}
        out, _ = rb.redact(text, [low, high])
        self.assertEqual(out, "abc[EMAIL_1]j")

    def test_contained_span_is_skipped(self):
        text = "Dana Voss called"
        outer = {"type": "person", "text": "Dana Voss", "start": 0, "end": 9, "confidence": 0.5}
        inner = {"type": "person", "text": "Voss", "start": 5, "end": 9, "confidence": 0.99}
        out, _ = rb.redact(text, [outer, inner])
        self.assertEqual(out, "[PERSON_1] called")


if __name__ == "__main__":
    unittest.main()
