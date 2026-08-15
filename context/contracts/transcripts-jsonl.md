---
type: concept
title: "Contract: data/transcripts.jsonl"
description: Synthetic transcript dataset format — Track B produces, Track A consumes
timestamp: 2026-08-15T20:00:00Z
---

Producer: Track B (Task 1). Consumers: Track A dev/demo, baseline redaction, Terac snippets.
25 lines, one JSON object each:

```json
{"id": "t01", "text": "<full transcript text>", "planted": [{"type": "ssn", "value": "523-04-1187", "note": "standard format"}], "difficulty": "easy|medium|hard"}
```

- `planted[].value` must appear verbatim in `text` (ground truth for metrics).
- ≥8 hard cases, ≥5 tricky negatives, exactly one injection fixture (`id: t25`).
- All values synthetic. See [[contracts/redacted-baseline]] for the derived file.
