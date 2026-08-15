---
type: concept
title: "Contract: Ledger decision record (Supabase)"
description: Hash-chained decision row — every route, disposition, and observed-not-acted span
timestamp: 2026-08-15T20:00:00Z
---

Table `decisions` (Supabase). One row per detection, including allow-observed spans (ADR 0004).

| column | contents |
|---|---|
| `id` | serial |
| `trace_id` | transcript id |
| `span_hmac` | HMAC(salt, raw span) — salt client-side, never logged |
| `entity_type` | GLiNER2-PII type |
| `confidence` | detector confidence |
| `route` | auto-redact \| consult \| allow-observed |
| `disposition` | redact \| pseudonymize \| allow \| timeout \| null (non-consulted) |
| `policy_version` | FK into policy table |
| `model_id` | detector model id (base or fine-tune job UUID) |
| `prompt_hash` | hash of specialist prompt, null if non-consulted |
| `prev_hash` | previous row's `row_hash` (genesis: 64 zeros) |
| `row_hash` | sha256(prev_hash + canonical-JSON of the row's payload fields) |

Chain integrity check = recompute forward from genesis. Claim scope: tamper-evident, not
tamper-proof (ADR 0004).
