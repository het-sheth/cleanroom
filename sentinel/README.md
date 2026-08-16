# sentinel

```
node sentinel/cli.js scrub <transcripts.jsonl> [--out <dir>=out] [--mock] [--policy <json-file>]
```

Reads `{id, text, planted}` lines, routes each detection through the policy, applies fail-closed
redaction (ADR 0003), and writes `<out>/redacted.jsonl` + `<out>/ledger.jsonl` (hash-chained
decision log) plus a per-type summary and ledger verify result to stdout.

**Mock mode** (`--mock`, or auto-selected with a warning when `PIONEER_API_KEY` is unset): detects
from `planted` ground truth, deterministic, no live calls. **Live mode**: calls Pioneer via
`lib/detector.js`.

**Env vars**: `PIONEER_API_KEY` (live detection); `CLEANROOM_SALT` (ledger HMAC salt, default `dev-salt` with a warning — never logged either way).
