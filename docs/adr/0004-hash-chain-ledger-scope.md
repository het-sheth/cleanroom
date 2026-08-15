# 0004 — Ledger is a Supabase hash chain; we claim tamper-evident, never tamper-proof

## Status
Accepted (2026-08-15, hackathon day)

## Context
Auditability is a core claim. Options ranged from a plain audit table to external anchoring to a
real append-only log. Adversarial review flagged two honest limits: a self-hosted chain proves
nothing against an operator who rewrites and rehashes the whole table, and HMACs over small value
spaces (9-digit SSNs) are brute-forceable if the salt leaks.

## Decision
One Supabase table, each row storing `prev_hash` and `row_hash = sha256(prev_hash + payload)`.
Claim exactly: "tamper-evident to third parties holding an earlier head, not tamper-proof against
the storage operator." Salt is per-customer, held client-side, never logged. External anchoring
(periodic head hash to a public log) is named as roadmap, not built. Below-floor spans get
observed-not-acted rows so silent false negatives become visible ones.

## Consequences
- ~30 minutes of build, and the pitch survives a fintech judge because the claim is scoped
  precisely to what the mechanism provides.
- HMAC-confirm dispute resolution works for the customer who holds the salt.
- Anyone wanting operator-proof audit needs the roadmap anchoring; we say so unprompted.
