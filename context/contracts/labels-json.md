---
type: concept
title: "Contract: data/labels.json"
description: Terac rater results format — Track B produces, Track A's threshold tuner consumes
timestamp: 2026-08-15T20:00:00Z
---

Producer: Track B (`scripts/fetch_labels.py`, polling `terac_get_submissions`). Consumer: Track A
threshold/schema tuner and the Specialist's L2→L3 escalation gate (≥20 confirmed hard-case labels,
ADR 0005).

```json
{"t01": {"leak_reports": [{"quoted_text": "...", "n_raters": 3}], "usefulness_avg": 4.2, "n_raters": 5}}
```

- `leak_reports[].quoted_text` is what raters copied from the redacted snippet — match it back to
  planted entities to find confirmed false negatives.
- `usefulness_avg` below ~2.5 signals over-redaction for that snippet's entity mix.
- Do not change this shape unilaterally (see AGENTS.md contract rule).
