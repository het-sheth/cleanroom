---
type: concept
title: Build order and cut list
description: Live plan — update the checkboxes as state changes; this page is the coordination point
timestamp: 2026-08-15T21:05:00Z
---

Submissions lock 6:45 PM PDT. Demo: live Claude Code session with planted PII, split screen with
dashboard (catches, dispositions, Band consult log, ledger rows), injection fixture as the
security moment.

## Track B (teammate — `prompts/teammate-track-b.md`)
- [x] 25 synthetic transcripts ([[contracts/transcripts-jsonl]]) — `data/transcripts.jsonl`,
      regenerate with `python3 scripts/gen_transcripts.py` (validates verbatim planting on write).
      82 planted entities / 19 types; 10 hard-case transcripts, 5 tricky negatives, t25 injection.
- [~] Baseline redaction + BEFORE metrics ([[contracts/redacted-baseline]]) — `scripts/redact_baseline.py`
      now adapted to the live-verified contract ([[../research/pioneer]]): FLAT payload with the
      REQUIRED `schema` field, response flattened from the `result.data.entities` dict-of-types,
      and cold-start 403/422 retried at 25s while `card_required` / missing-schema fail fast.
      Verified offline against the documented shape + both error paths. Real BEFORE numbers
      BLOCKED only on the key itself — Track B has none. `--mock` mode
      produces the full pipeline output now so downstream work is not gated: mock BEFORE is
      71/82 overall, 43/50 hard cases — a smoke test, NOT a detector measurement, never quote it.
- [ ] Terac study LIVE — opportunity id: ___ , quoted ETA: ___  ← CLOCK-CRITICAL, **BLOCKED**:
      Terac MCP is not configured in this environment and credits are not redeemed. Nothing in
      Track B can unblock this; it needs the account holder. **The payload is already built** —
      `data/study_snippets.json`, 15 snippets, 8 findable leaks, launchable as-is
      ([[terac-study-spec]]). Send that file only; `data/study_ground_truth.json` is the key.
- [~] `scripts/fetch_labels.py` runs clean ([[contracts/labels-json]]) — aggregation verified
      offline against a synthetic dump, emits the exact frozen shape. Auth check pending study.
- [ ] Stripe checkbox submitted (team name + payment link + rk_ key) — needs account holder.

### Cross-track status
All three [[integration-risks]] are settled. Per-type placeholder numbering is **done on both
sides** — Track A acked and corrected [[contracts/redacted-baseline]]; Track B's redactor now
numbers per type and uses Track A's token normalization. Finding 3's fixtures are verified
against the shipped `sentinel/lib/policy.js` (46 consult / 25 auto-redact / 11 allow-observed).

Track B's remaining three items are **all blocked on credentials or a human account**, not on
work: real BEFORE numbers (Pioneer 403 `card_required`), the Stripe checkbox, and Replay QA
signup. See the blocked list above.

## Track A (Het + Claude)
- [ ] Sentinel core (plan: docs/superpowers/plans/2026-08-15-sentinel-core.md, branch
      feat/sentinel-core, Tasks 1–4): policy routing, hash-chain ledger, Pioneer detector client,
      redactor, mock-mode CLI ([[contracts/ledger-row]])
- [ ] Fine-tune loop (plan Task 5, elevated per 2026-08-15 decision): `/generate` NER data →
      launch LoRA on gliner2-base → job-id shown live in demo; ≥20-label gate + 1-job cap in code
      ([[research/pioneer]]). CONFIRM AT BOOTH: does hackathon credit cover /felix/training-jobs?
- [ ] Band room: Specialist + exporter-as-agent, metadata-only consults
      ([[contracts/consultation-payload]]), fail-closed gate
- [ ] Escalation ladder caps: Terac auto-launch (synthetic only), fine-tune trigger ≥20 labels,
      1-job cap (ADR 0005)
- [ ] Threshold/schema tuner: labels.json → policy v(n+1) → AFTER metrics
- [ ] Dashboard + injection demo + pitch slide (boundary caveat + ZDR screenshot)

## Stretch (strict order, only after core loop works end-to-end)
1. Local `pip install gliner2` toggle (retires ADR 0002 tension)
2. Pseudonymize disposition (else binary redact/allow)
3. Fine-tuned model A/B in dashboard

## Cut order if hour 4 looks bad
1. Pseudonymize → binary
2. Live injection demo → canned replay
3. Autonomous Terac/fine-tune triggers → manual launches (same calls, narrated ladder)
Never cut: Terac study itself (mandatory criterion), GLiNER2-PII usage, ledger.

## Booth/pitch assets
- [ ] ZDR screenshot from Pioneer UI (Het)
- [ ] Quote Pioneer booth answers by name in the pitch
