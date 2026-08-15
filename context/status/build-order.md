---
type: concept
title: Build order and cut list
description: Live plan — update the checkboxes as state changes; this page is the coordination point
timestamp: 2026-08-15T20:00:00Z
---

Submissions lock 6:45 PM PDT. Demo: live Claude Code session with planted PII, split screen with
dashboard (catches, dispositions, Band consult log, ledger rows), injection fixture as the
security moment.

## Track B (teammate — `prompts/teammate-track-b.md`)
- [ ] 25 synthetic transcripts ([[contracts/transcripts-jsonl]])
- [ ] Baseline redaction + BEFORE metrics ([[contracts/redacted-baseline]])
- [ ] Terac study LIVE — opportunity id: ___ , quoted ETA: ___  ← CLOCK-CRITICAL
- [ ] `scripts/fetch_labels.py` runs clean ([[contracts/labels-json]])
- [ ] Stripe checkbox submitted (team name + payment link + rk_ key)

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
