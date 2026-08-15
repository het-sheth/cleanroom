---
type: concept
title: "Contract: Routing policy table (Supabase)"
description: Versioned thresholds + schema wording — the deterministic core and the tuning target
timestamp: 2026-08-15T20:00:00Z
---

Table `policy`. One row per version; rows are immutable — tuning inserts a new version.

| column | contents |
|---|---|
| `version` | integer, monotonically increasing |
| `ceilings` | JSON: per-entity-type auto-redact threshold (default 0.75) |
| `floor` | below this → allow-observed (default 0.35) |
| `contextual_types` | JSON array: always-consult types (username, org, location, job_title) |
| `schema_descriptions` | JSON: `{type: natural-language description}` passed to GLiNER2 inference |
| `source` | "default" \| "terac-labels" \| "manual" |
| `created_at` | timestamp |

Routing is `route(entity_type, confidence, policy_version)` — a pure function over one row.
Tuning path: [[contracts/labels-json]] confirmed false negatives → lower that type's ceiling
and/or sharpen its `schema_descriptions` entry → new version → re-run baseline set → AFTER
metrics. Same table gates L3: fine-tune triggers at ≥20 confirmed hard-case labels (ADR 0005).
