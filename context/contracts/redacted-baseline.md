---
type: concept
title: "Contract: data/redacted_baseline.jsonl + baseline_metrics.json"
description: Baseline redaction output and BEFORE metrics — Track B produces, both tracks consume
timestamp: 2026-08-15T20:00:00Z
---

Producer: Track B (Task 2), via Pioneer at default `threshold: 0.5`.

`data/redacted_baseline.jsonl`, one line per transcript:

```json
{"id": "t01", "redacted_text": "...", "detections": [{"type": "ssn", "text": "523-04-1187", "start": 120, "end": 131, "confidence": 0.83}]}
```

Placeholders are typed and indexed: `[SSN_1]`, `[PERSON_2]`.

`data/baseline_metrics.json`: per entity type, planted-caught vs planted-missed counts, computed
against [[contracts/transcripts-jsonl]] ground truth. This is the demo's BEFORE number; the AFTER
comes from re-running with the tuned policy (see [[contracts/labels-json]]).
