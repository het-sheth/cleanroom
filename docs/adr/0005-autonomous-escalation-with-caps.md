# 0005 — The Specialist escalates autonomously (hires humans, triggers fine-tunes) under hard caps

## Status
Accepted (2026-08-15, hackathon day)

## Context
The event's theme is agents running a company with no human input. Our honest zero-human story is
that the compliance department manages its own competence: when unsure, it hires human raters
through Terac's MCP; when its ledger accumulates confirmed hard cases, it launches a GLiNER2
fine-tune on Pioneer. Both actions spend real money and could run away if unbounded. The
alternative was narrating the loop while triggering everything manually.

## Decision
The escalation ladder is real, with hard caps: the Specialist may launch Terac studies only from
synthetic/templated examples (never customer spans — raters are a bigger leak surface than any
model), and may launch at most ONE fine-tune job, only after ≥20 confirmed hard-case labels exist
in the policy table. Caps live in code, not prompts.

## Consequences
- "Our agent hired humans and retrained its own detector today" is demonstrably true, not
  narrated.
- Spend is bounded by construction; a runaway agent can waste at most one training job and the
  quoted study budget.
- If the clock slips, the fallback is launching the same calls manually — the ladder degrades to
  narration without redesign (cut order lives in context/status/build-order.md).
