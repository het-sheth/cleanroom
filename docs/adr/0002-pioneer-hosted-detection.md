# 0002 — Detection runs on Pioneer's hosted endpoint, in tension with our own thesis

## Status
Accepted (2026-08-15, hackathon day)

## Context
Our thesis is that raw transcript text never crosses the trust boundary — yet detection requires
something to read raw text. Running GLiNER2-PII locally (pip, ~205M params) would keep detection
in-boundary, but the Pioneer track requires using models *on Pioneer*, and maintaining two
inference paths in a 5-hour build is over-engineering.

## Decision
Pioneer's hosted endpoint (`fastino/gliner2-privacy-filter-PII-multi`) is the only inference path
today. The tension is stated on the architecture slide itself, not hidden in Q&A, with three
mitigations named: Pioneer's zero-data-retention posture (visible in their UI; confirmed verbally
on-site — no public policy doc exists), demo data is 100% synthetic, and the weights are
downloadable on Pioneer's Pro tier, making in-boundary deployment a product tier rather than
vaporware.

## Consequences
- Prize-eligible, single code path, fastest build.
- The boundary claim is aspirational for the hosted tier; we say "detection runs where the
  customer chooses" and never claim more.
- A local-model toggle is the designated stretch item if the core loop finishes early; it fully
  retires this ADR's tension.
