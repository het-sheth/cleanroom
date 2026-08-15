# cleanroom

An autonomous PII-compliance department for AI-agent observability. Agent harnesses ship
transcripts to observability backends; those transcripts leak PII. cleanroom intercepts them
in-boundary, detects PII with GLiNER2-PII (Pioneer), routes ambiguous spans to a Band-resident
specialist that only ever sees metadata, records every decision in a hash-chained ledger, and
manages its own competence — hiring human raters through Terac when unsure and retraining its own
detector when the evidence warrants.

Built at the Zero-Human Company Hackathon, San Francisco, 2026-08-15.

- **Start here (humans):** `context/status/build-order.md`
- **Start here (agents):** `AGENTS.md`
- **Vocabulary:** `CONTEXT.md` · **Decisions:** `docs/adr/` · **Track B brief:** `prompts/teammate-track-b.md`
