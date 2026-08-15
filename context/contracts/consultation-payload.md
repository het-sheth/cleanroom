---
type: concept
title: "Contract: Consultation payload (Band room)"
description: The only shape allowed to cross into the Band room — structured metadata, no free text
timestamp: 2026-08-15T20:00:00Z
---

Producer: Sentinel. Consumer: Specialist agent. Enforces ADR 0001 — if a field could carry free
transcript text, it does not belong here.

```json
{
  "consult_id": "c-0042",
  "trace_id": "t07",
  "entity": {
    "type": "username",
    "confidence": 0.55,
    "span_shape": "Aa9{8}",
    "char_len": 8,
    "source_tool": "Bash",
    "surrounding_token_count": 140,
    "domain_tag": "payments-debugging"
  },
  "policy_version": 3
}
```

Specialist reply (temperature 0, rigid format): `{"consult_id": "c-0042", "disposition":
"redact|pseudonymize|allow", "rationale": "<one line>"}`. No reply within timeout → Sentinel
records disposition `timeout` and redacts (ADR 0003). Every consult + verdict becomes a
[[contracts/ledger-row]].
