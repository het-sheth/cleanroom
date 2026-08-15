# 0001 — Consultations carry structured metadata only, never text

## Status
Accepted (2026-08-15, hackathon day)

## Context
The Specialist (a Band-resident LLM agent) must judge ambiguous detections. The obvious design
sends it the redacted surrounding context so it can reason about meaning. Two attacks broke that
design in adversarial review: (1) transcript text is attacker-controlled, so any free text in the
consultation is a prompt-injection channel into the exact component whose selling point is
trustworthy judgment; (2) unrecognized or below-floor PII in the surrounding context rides along
into Band, silently violating the trust boundary.

## Decision
A Consultation contains only structured fields: entity type, confidence, span shape (regex-like
abstraction of the span), source tool, surrounding token count, transcript domain tag. No free
text of any kind crosses into the Band room.

## Consequences
- Prompt injection against the Specialist has no channel; we demo this live with the injection
  fixture.
- The trust boundary holds even when the Detector misses PII in surrounding text.
- The Specialist judges with less context and will sometimes be wrong in ways richer context would
  have prevented. We accept this: wrong-but-fail-closed beats right-but-injectable, and hard cases
  escalate to L2 (human labels) anyway.
