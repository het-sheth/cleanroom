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
