# sentinel

```
node sentinel/cli.js scrub <transcripts.jsonl> [--out <dir>=out] [--mock] [--policy <json-file>] [--model <id>]
node sentinel/cli.js finetune --labels <labels.json> [--out <dir>=out] [--dry-run] [--domain <text>]
node sentinel/cli.js finetune-status <jobId>
```

## scrub

Reads `{id, text, planted}` lines, routes each detection through the policy, applies fail-closed
redaction (ADR 0003), and writes `<out>/redacted.jsonl` + `<out>/ledger.jsonl` (hash-chained
decision log) plus a per-type summary and ledger verify result to stdout.

`<out>/redacted.jsonl` carries **no raw span text**. Each detection is the metadata form only —
`{type, start, end, confidence, route, disposition, token, span_hmac}` — where `token` is the
placeholder that replaced the span and `span_hmac` is the same salted HMAC the ledger row carries.
The field list is a whitelist: a new detector field is persisted only once someone has decided it is
not PII (ADR 0003, fail closed). Earlier revisions wrote `detections[].text` verbatim, which put
every detected secret back into the file whose purpose is not to have them.

Scoring a run against `transcripts.jsonl` ground truth still works without the span: HMAC the
planted value with the same `CLEANROOM_SALT` and match on `span_hmac` (the HMAC-confirm property in
`CONTEXT.md`). Note that `redacted_text` still contains, by design, any span routed
`allow-observed` — that is the observed-not-acted wedge, not a leak of the detections sidecar.

**Mock mode** (`--mock`, or auto-selected with a warning when `PIONEER_API_KEY` is unset): detects
from `planted` ground truth, deterministic, no live calls. **Live mode**: calls Pioneer via
`lib/detector.js`. `--model <id>` overrides the model id used in live mode (e.g. to A/B a deployed
fine-tune job's id against the base detection model — see `finetune-status` below).

**Env vars**: `PIONEER_API_KEY` (live detection); `CLEANROOM_SALT` (ledger HMAC salt, default `dev-salt` with a warning — never logged either way).

## finetune / finetune-status

Implements the L3 rung of the escalation ladder (ADR 0005) via `lib/finetune.js`, wrapping
Pioneer's `/generate` (synthetic training data) and `/felix/training-jobs` (LoRA fine-tune)
endpoints.

`finetune` evaluates the ADR 0005 gate — fine-tune iff there are >= 20 confirmed hard-case labels
(total `leak_reports[]` entries across all transcripts in `--labels`, per
`context/contracts/labels-json.md`) **and** no job has been launched yet (the 1-job cap, tracked by
`<out>/finetune-job.json`'s existence). If the gate is closed it prints why and exits 0. If open, it
calls `/generate` then `/felix/training-jobs`, writes `{jobId, launchedAt, baseModel}` to
`<out>/finetune-job.json`, and prints the job id. `--dry-run` prints both request bodies verbatim
and makes no network call — works with no `PIONEER_API_KEY` set.

`finetune-status <jobId>` polls and prints the job's state (`requested` | `running` | `complete` |
`deployed`); once `deployed`, it also prints the exact `scrub --model <jobId>` command for an A/B
comparison against the base model.
