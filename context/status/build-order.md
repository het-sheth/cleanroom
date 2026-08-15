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
      written and unit-tested offline against three candidate response shapes. BLOCKED on
      `PIONEER_API_KEY`. Run `--probe` first to confirm the real shape, then the full pass.
- [ ] Terac study LIVE — opportunity id: ___ , quoted ETA: ___  ← CLOCK-CRITICAL, **BLOCKED**:
      Terac MCP is not configured in this environment and credits are not redeemed. Nothing in
      Track B can unblock this; it needs the account holder. Snippet set is ready to go the
      moment baseline redactions exist (15 = 10 hard + t25 + 4 easy).
- [~] `scripts/fetch_labels.py` runs clean ([[contracts/labels-json]]) — aggregation verified
      offline against a synthetic dump, emits the exact frozen shape. Auth check pending study.
- [ ] Stripe checkbox submitted (team name + payment link + rk_ key) — needs account holder.

### Note for Track A — redaction invariant found while testing
The Detector returns only the *first* occurrence of a value that appears several times in one
Transcript. Redacting only the returned offsets leaks every repeat. `redact()` therefore also
scrubs literal repeats of any detected span (≥4 chars) within that Transcript. The Sentinel needs
the same rule or it will leak on t01, t06, t14, t18, t25 — every one of those repeats a value.

## Track A (Het + Claude)
- [ ] Sentinel: Claude Code hook → Pioneer inference → typed-placeholder redaction
- [ ] Policy table + routing (pure function, versioned) + ledger chain ([[contracts/ledger-row]])
- [ ] Launch GLiNER2 fine-tune job early (Pioneer `/generate` NER data on hard-case patterns) —
      background, minutes-to-hours ([[research/pioneer]])
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
