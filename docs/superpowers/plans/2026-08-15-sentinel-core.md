# Plan: sentinel core

Spec authority: `CONTEXT.md` (vocabulary), `docs/adr/0001–0005` (decisions),
`context/contracts/*.md` (data shapes — binding). Branch: `feat/sentinel-core`.

## Global Constraints

- Node ≥22, plain ESM JavaScript (`"type": "module"`), **zero runtime dependencies** — `fetch` and
  `node:crypto` are built in. Tests use `node:test` + `node:assert/strict`, run via `node --test sentinel/test/`.
- All code under `sentinel/` (lib/, test/, cli.js). Do not touch `data/`, `scripts/`, `prompts/`,
  `context/` (Track B / controller territory).
- All fixture PII is synthetic. Never use a real person's data.
- Fail closed (ADR 0003): any span whose final action is unresolved → redact.
- Ledger claim scope per ADR 0004; salt never logged, never in ledger rows.
- Conventional Commits, imperative subject ≤50 chars, no AI attribution trailers.

## Task 1: routing policy (`sentinel/lib/policy.js` + `sentinel/test/policy.test.js`)

Pure module, no IO. Exports:

- `DEFAULT_POLICY` = `{ version: 1, ceilings: { default: 0.75 }, floor: 0.35, contextual_types: ["username", "organization", "location", "job_title"], schema_descriptions: {} }`
- `route(entityType, confidence, policy)` → `"allow-observed" | "consult" | "auto-redact"`:
  1. `confidence < policy.floor` → `"allow-observed"`
  2. else if `policy.contextual_types.includes(entityType)` → `"consult"`
  3. else if `confidence >= (policy.ceilings[entityType] ?? policy.ceilings.default)` → `"auto-redact"`
  4. else → `"consult"`
- Throws `TypeError` on confidence outside [0,1] or non-string entityType.

Tests must cover: each branch; boundary values 0.35 and 0.75 exactly (0.35 → not allow-observed;
0.75 → auto-redact); per-type ceiling override (`ceilings: { ssn: 0.5 }`); contextual type at 0.9
still consults; contextual type at 0.2 → allow-observed; invalid inputs throw.

## Task 2: hash-chain ledger (`sentinel/lib/ledger.js` + `sentinel/test/ledger.test.js`)

Implements `context/contracts/ledger-row.md`. Pure functions + a small file-backed store. Exports:

- `GENESIS = "0".repeat(64)`
- `spanHmac(salt, spanText)` → hex HMAC-SHA256
- `PAYLOAD_KEYS = ["trace_id","span_hmac","entity_type","confidence","route","disposition","policy_version","model_id","prompt_hash"]` — canonical order
- `rowHash(prevHash, payload)` → hex sha256 of `prevHash + JSON.stringify(pick(payload, PAYLOAD_KEYS))` (keys serialized in PAYLOAD_KEYS order; missing → `null`)
- `class Ledger { constructor(filePath) }` with:
  - `append(payload)` → full row `{...payload, prev_hash, row_hash}`; reads current tail, chains, appends one JSON line to filePath (create file if absent)
  - `rows()` → all parsed rows
  - `static verify(rows)` → `{ ok: true }` or `{ ok: false, badIndex }` — recompute forward from GENESIS
- Salt is an argument to `spanHmac`, never stored by Ledger.

Tests: hash chain of 3 appends verifies ok; tampering with row 1's `entity_type` → `{ok:false,
badIndex:1}`; tampering with a `row_hash` detected; deterministic `rowHash` for same input;
`spanHmac` differs across salts; file round-trip (append, new Ledger instance on same path, verify).
Use a temp dir (`fs.mkdtempSync(os.tmpdir() + "/ledger-")`) for files.

## Task 3: detector client + redactor (`sentinel/lib/detector.js`, `sentinel/lib/redact.js` + tests)

**detector.js** — Pioneer client per `context/research/pioneer.md`:

- `async detect(text, { apiKey, modelId = "fastino/gliner2-privacy-filter-PII-multi", threshold = 0.5, schema, fetchImpl = fetch })`
- POSTs `https://api.pioneer.ai/inference`, headers `{ "X-API-Key": apiKey, "content-type": "application/json" }`, body `{ model_id, text, threshold, ...(schema && { schema }) }`.
- Normalizes the response into `[{ type, text, start, end, confidence }]`. Accept these shapes:
  entities array at `body.entities` or `body.result.entities` or top-level array; per-entity keys
  `type|label`, `text|span`, `confidence|score`; if `start`/`end` missing, locate each occurrence
  of the entity text in the transcript (advance search index so duplicates map to successive
  occurrences). Unknown shape → throw `Error("unrecognized Pioneer response shape")` with the
  body JSON in the message.
- Non-2xx → throw with status + body text. No retries (caller's job).

**redact.js**:

- `applyDispositions(text, decisions)` where each decision is `{ type, start, end, confidence, route, disposition }`. Final action is redact iff `route === "auto-redact"` or (`route === "consult"` and `disposition` in `["redact", "timeout"]`) — timeout redacts per ADR 0003. `pseudonymize` also replaces (same placeholder) for now.
- Replacement token: `[<TYPE>_<n>]`, TYPE uppercased with non-alphanumerics → `_`; `n` counts
  distinct spans of that type in order of first appearance (two spans with identical text and type
  share the same n).
- Returns `{ redactedText, replacements: [{ token, start, end, type }] }`. Apply replacements
  right-to-left so earlier offsets stay valid. Spans fully contained in an already-replaced span
  are skipped; partial overlaps: keep the higher-confidence span, skip the other.
- **Repeat scrub (fail closed, per `context/status/integration-risks.md` finding 2):** after
  offset replacement, any remaining literal occurrence of a redacted span's text (length ≥4
  chars) elsewhere in the text is replaced with that span's same token — the detector may return
  only the first occurrence's offsets.
- Allow-routed and allow-disposed decisions leave text untouched (including literal repeats).

Tests: detector with a stubbed `fetchImpl` covering both response shapes + missing-offsets path +
duplicate entity text mapping to two occurrences + non-2xx throw; redactor covering placeholder
numbering, same-text-same-token, right-to-left integrity (multi-span line), containment skip,
partial-overlap by confidence, timeout-redacts, allow untouched.

## Task 4: CLI end-to-end (`sentinel/cli.js` + `sentinel/test/cli.test.js` + `sentinel/README.md`)

`node sentinel/cli.js scrub <transcripts.jsonl> [--out <dir>=out] [--mock] [--policy <json-file>]`

- Reads the `context/contracts/transcripts-jsonl.md` shape (`{id, text, planted:[{type, value}]}`).
- **Mock mode** (`--mock`, also auto-selected when `PIONEER_API_KEY` unset — print a warning):
  detections come from `planted` ground truth: for each planted value, every occurrence in `text`
  becomes a detection with deterministic pseudo-confidence
  `0.30 + (parseInt(sha256(id + type + value).slice(0, 4), 16) / 0xffff) * 0.65` (range [0.30, 0.95]).
- Live mode: `detect()` from Task 3 with `PIONEER_API_KEY`.
- For each detection: `route()` (Task 1, `DEFAULT_POLICY` unless `--policy`); consult-routed spans
  get `disposition: "timeout"` (Band not wired yet — fail closed); ledger every decision via Task 2
  (`<out>/ledger.jsonl`, salt from `CLEANROOM_SALT` env, default `"dev-salt"` with a warning);
  `model_id` = the model used or `"mock"`; `prompt_hash: null`.
- Writes `<out>/redacted.jsonl` lines `{ id, redacted_text, detections: [{type, text, start, end, confidence}] }`
  (the `context/contracts/redacted-baseline.md` shape) and prints a summary table: per entity type —
  detections, auto-redacted, consulted, allow-observed; plus ledger row count and
  `Ledger.verify` result.
- Exit non-zero on unreadable input or any transcript line that fails JSON.parse (print line number).

Tests: run the CLI via `child_process.execFile(process.execPath, ...)` against a 3-transcript
fixture (include one duplicated planted value and one below-floor confidence case by choosing
values whose pseudo-confidence lands < 0.35 — compute in the test, don't guess; Track B has
pre-measured real-dataset cases in `context/status/integration-risks.md` finding 3: `t24`/address
0.3025 and `t15`/phone 0.3099 are below-floor, and `t16`/`@rmoyer-dev` at 0.8328 proves the
contextual rule — reuse those values in fixtures where convenient); assert redacted
output shape, placeholders present, planted high-confidence values absent from redacted text,
ledger verifies ok, exit codes. README: 15 lines max — usage, mock vs live, env vars.

## Task 5: fine-tune loop (`sentinel/lib/finetune.js` + `sentinel/test/finetune.test.js` + CLI subcommands)

Implements the L3 rung of the escalation ladder (ADR 0005). Pioneer endpoint shapes for
`/generate` and `/felix/training-jobs` are only partially documented (see
`context/research/pioneer.md`) — keep the client thin, normalize defensively, and on an
unrecognized response shape throw with the body JSON in the message (same convention as Task 3).

**finetune.js** exports (all take `{ apiKey, fetchImpl = fetch }` plus their own params; non-2xx →
throw with status + body):

- `async generateTrainingData({ labels, domainDescription, numExamples = 100, ... })` → POST
  `https://api.pioneer.ai/generate`, body `{ task_type: "ner", labels, num_examples, domain_description }`.
  Returns the parsed body unmodified plus a best-effort `datasetRef` (look for `dataset_id`, `id`,
  or `dataset` keys).
- `async launchFineTune({ baseModel = "fastino/gliner2-base-v1", datasetRef, loraR = 16, loraAlpha = 32, ... })`
  → POST `https://api.pioneer.ai/felix/training-jobs`. Returns `{ jobId, status, raw }` (`jobId`
  from `id` | `job_id` | `uuid`).
- `async jobStatus({ jobId, ... })` → GET `https://api.pioneer.ai/felix/training-jobs/<jobId>` →
  `{ status, raw }` (expected states: requested | running | complete | deployed).
- `shouldFineTune(labelsJson, jobRecordExists)` — PURE gate for ADR 0005: count confirmed
  hard-case labels = total `leak_reports` entries across all transcripts in the
  `context/contracts/labels-json.md` shape; return `true` iff count ≥ 20 AND `!jobRecordExists`.
  The 1-job cap lives here, in code.

**CLI additions** (extend Task 4's `sentinel/cli.js`):

- `finetune --labels <labels.json> [--out <dir>=out] [--dry-run] [--domain <text>]` — evaluates
  `shouldFineTune` against `<out>/finetune-job.json` (existence = cap spent); if gated off, print
  why and exit 0; if on, call `generateTrainingData` (labels = entity types present in
  leak_reports, domain from `--domain` or a sensible default about agent transcripts), then
  `launchFineTune`, write `{ jobId, launchedAt, baseModel }` to `<out>/finetune-job.json`, print
  the job id prominently (judges will ask for it). `--dry-run` prints both request bodies verbatim
  and writes nothing — must work with no API key.
- `finetune-status <jobId>` — prints state; when deployed, print the exact scrub command for the
  A/B: `node sentinel/cli.js scrub <file> --model <jobId>` (Task 4's live mode must accept
  `--model` to override `modelId` — add it there if Task 4 didn't).

Tests: mocked `fetchImpl` for all three API functions (happy path + non-2xx throw + unrecognized
shape throw); `shouldFineTune` at 19 labels → false, 20 → true, 20 with existing job record →
false (cap); `--dry-run` end-to-end with no `PIONEER_API_KEY` set; job-record write blocks a
second launch.
