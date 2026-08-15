# 0003 — Export is gated on a Band verdict and fails closed

## Status
Accepted (2026-08-15, hackathon day)

## Context
Consulted detections need a verdict before the transcript exports. If Band is slow, unreachable,
or the Specialist errors, the system must choose: export anyway (availability) or block/redact
(leak-safety). Separately, the Band prize requires the room to be load-bearing — "remove the room
and the app should break."

## Decision
No verdict within the timeout → the span is redacted and the decision is ledgered as a timeout
disposition. The exporter itself participates in the Band room and acts only on an @mention
verdict; there is no side channel around the room.

## Consequences
- The gate can never fail into a leak; worst case is over-redaction.
- Band is structurally load-bearing, not decorative: removing it blocks consults entirely
  (everything ambiguous gets redacted), visibly degrading the product.
- A Band outage during the demo degrades gracefully into the fail-closed story, which is itself
  demoable.
