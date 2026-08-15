---
type: concept
title: Pioneer API facts
description: Verified facts about Pioneer inference, fine-tuning, and data posture (researched 2026-08-15)
timestamp: 2026-08-15T20:00:00Z
---

Source: docs.pioneer.ai + github.com/fastino-ai/GLiNER2, researched via subagent on hackathon day;
booth intel from Het's on-site conversation.

## Inference
- `POST https://api.pioneer.ai/inference`, header `X-API-Key: <key>` (key shown once at creation).
- Body: `{"model_id": "fastino/gliner2-privacy-filter-PII-multi", "text": "...", "threshold": 0.5}`.
- Schema is dynamic at inference: pass entity subset, or a `{type: description}` dict — natural-
  language descriptions improve precision. Per-entity thresholds supported. 42 PII types, 7 groups,
  7 languages. This is the no-training tuning lever (see [[contracts/policy-table]]).
- OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) routes exist,
  same key. No documented rate limits; homepage claims sub-200ms p50 (marketing claim, unverified).

## Fine-tuning
- Supports GLiNER2 (encoder) fine-tuning directly — guide: docs.pioneer.ai/guides/fine-tune-ner;
  LoRA and full FT for `fastino/gliner2-*-v1`. Live catalog has GLiNER2 variants + Nemotron 3.5
  Lightning only — NO Qwen/Gemma/Llama (older marketing claims are stale).
- `/generate` endpoint synthesizes labeled training data: `task_type: "ner"`, `labels`,
  `num_examples`, `domain_description` — 100 labeled examples from a description, no annotation.
- Jobs: `POST /felix/training-jobs`, states requested→running→complete→deployed, "a few minutes to
  a few hours", early stopping, `nr_epochs` default 100.
- Deployed model invoked with `model_id = <job UUID>` on the same `/inference` endpoint — one-line
  A/B swap.

## Data posture
- ZDR: visible in their product UI and confirmed verbally at the booth. NO public policy document
  exists (no SOC 2 page, no security page) — cite as "confirmed on-site + shown in UI", never as a
  published policy. {{verbal claim, on-site}}
- Pro tier includes downloadable weights → in-boundary deployment is a product tier (pitch line for
  ADR 0002's tension). Enterprise tier: SSO/2FA + inference-tracking opt-out.
- Booth intel: Pioneer's team specifically wants to see teams using GLiNER AND the fine-tuning API.
