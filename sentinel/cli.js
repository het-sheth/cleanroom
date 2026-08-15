#!/usr/bin/env node
// Sentinel CLI: wires policy + ledger + detector + redactor into an
// end-to-end scrub over a transcripts.jsonl dataset. See
// context/contracts/transcripts-jsonl.md and
// context/contracts/redacted-baseline.md for the I/O shapes.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { route, DEFAULT_POLICY } from './lib/policy.js';
import { Ledger, spanHmac } from './lib/ledger.js';
import { detect } from './lib/detector.js';
import { applyDispositions } from './lib/redact.js';
import {
  generateTrainingData,
  launchFineTune,
  jobStatus,
  shouldFineTune,
  countConfirmedLabels,
  buildGenerateBody,
  buildTrainingJobBody,
  DEFAULT_BASE_MODEL,
} from './lib/finetune.js';

// Must match detector.js's own default — kept as a separate constant here
// (rather than imported) so the CLI, not the detector module, owns which
// model it asks for. Overridable per-run with `--model` (Task 5), e.g. to
// A/B a deployed fine-tune job's job id against the base model.
const DEFAULT_MODEL_ID = 'fastino/gliner2-privacy-filter-PII-multi';
const DEFAULT_SALT = 'dev-salt';

// Exit code for a run that completed but could not remove every span it was
// asked to remove — distinct from 1 (the run failed) so a pipeline can tell
// "leaked" from "crashed". Fail closed at the process level (ADR 0003).
const EXIT_UNSCRUBBED = 2;

// Why an unresolved span ended the way it did — keyed by redact.js's
// `unresolved[].reason`. Never includes the span text, which is the PII.
const REASON_MESSAGES = {
  'literal-scrub': 'redacted by literal text match',
  'no-literal-match':
    'ITS TEXT DOES NOT OCCUR LITERALLY IN THE TRANSCRIPT; nothing was removed for it',
  'no-span-text':
    'THE DETECTOR REPORTED NO TEXT FOR IT and its offsets yield none; nothing was removed for it',
};
const UNKNOWN_REASON = 'IT COULD NOT BE RESOLVED; nothing was removed for it';

const USAGE_SCRUB =
  'usage: node sentinel/cli.js scrub <transcripts.jsonl> [--out <dir>=out] [--mock] [--policy <json-file>] [--model <id>]';
const USAGE_FINETUNE =
  'usage: node sentinel/cli.js finetune --labels <labels.json> [--out <dir>=out] [--dry-run] [--domain <text>]';
const USAGE_FINETUNE_STATUS = 'usage: node sentinel/cli.js finetune-status <jobId>';
const USAGE = `usage: node sentinel/cli.js <command> [options]

commands:
  scrub <transcripts.jsonl> [--out <dir>=out] [--mock] [--policy <json-file>] [--model <id>]
  finetune --labels <labels.json> [--out <dir>=out] [--dry-run] [--domain <text>]
  finetune-status <jobId>`;

// The Track B labels.json contract (context/contracts/labels-json.md) does
// not carry a per-report entity type — leak_reports entries are just
// {quoted_text, n_raters}. This looks for an (optional, forward-compatible)
// `type` field on each report and falls back to this fixed set of common
// PII entity types — matching the policy table's contextual_types plus the
// core PII types detector.js's fixtures exercise — when none carry one.
const DEFAULT_FINETUNE_LABELS = [
  'address',
  'email',
  'job_title',
  'location',
  'organization',
  'person',
  'phone',
  'ssn',
  'username',
];

const DEFAULT_DOMAIN_DESCRIPTION =
  'Customer support agent transcripts that may contain PII such as names, addresses, phone numbers, emails, and account identifiers.';

function deriveFinetuneLabels(labelsJson) {
  const types = new Set();
  for (const transcript of Object.values(labelsJson ?? {})) {
    for (const report of transcript?.leak_reports ?? []) {
      if (typeof report?.type === 'string') types.add(report.type);
    }
  }
  return types.size > 0 ? [...types].sort() : DEFAULT_FINETUNE_LABELS;
}

function parseArgs(argv) {
  const args = { input: undefined, out: 'out', mock: false, policy: undefined, model: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      args.out = argv[++i];
    } else if (a === '--mock') {
      args.mock = true;
    } else if (a === '--policy') {
      args.policy = argv[++i];
    } else if (a === '--model') {
      args.model = argv[++i];
    } else if (args.input === undefined) {
      args.input = a;
    } else {
      throw new Error(`unrecognized argument: ${a}`);
    }
  }
  return args;
}

function parseFinetuneArgs(argv) {
  const args = { labels: undefined, out: 'out', dryRun: false, domain: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--labels') {
      args.labels = argv[++i];
    } else if (a === '--out') {
      args.out = argv[++i];
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--domain') {
      args.domain = argv[++i];
    } else {
      throw new Error(`unrecognized argument: ${a}`);
    }
  }
  return args;
}

/**
 * Deterministic pseudo-confidence for mock-mode detections, in [0.30, 0.95].
 */
function mockConfidence(id, type, value) {
  const hash = createHash('sha256').update(id + type + value).digest('hex');
  const n = parseInt(hash.slice(0, 4), 16);
  return 0.3 + (n / 0xffff) * 0.65;
}

/**
 * Mock-mode "detector": ground truth from `planted`, every occurrence of
 * each planted value in `text` becomes a detection.
 */
function mockDetect({ id, text, planted = [] }) {
  const detections = [];
  for (const { type, value, unlocatable } of planted) {
    // A planted entry may declare itself unlocatable, mirroring the real
    // detector's contract for a hit whose offsets did not verify. Without it
    // mock mode can never produce the fail-closed unresolved path, which is
    // exactly the path ADR 0003 cares about most.
    if (unlocatable) {
      detections.push({
        type,
        text: value,
        start: null,
        end: null,
        unlocatable: true,
        confidence: mockConfidence(id, type, value),
      });
      continue;
    }
    let searchFrom = 0;
    let idx;
    while ((idx = text.indexOf(value, searchFrom)) !== -1) {
      detections.push({
        type,
        text: value,
        start: idx,
        end: idx + value.length,
        confidence: mockConfidence(id, type, value),
      });
      searchFrom = idx + value.length;
    }
  }
  return detections;
}

/** Read and JSON-parse every non-blank line, reporting all bad lines at once. */
function readTranscripts(inputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const lines = raw.split('\n');
  const transcripts = [];
  const errors = [];
  lines.forEach((line, idx) => {
    if (line.trim() === '') return;
    try {
      transcripts.push(JSON.parse(line));
    } catch (err) {
      errors.push(`line ${idx + 1}: ${err.message}`);
    }
  });
  if (errors.length > 0) {
    throw new Error(`invalid transcripts JSONL:\n${errors.join('\n')}`);
  }
  return transcripts;
}

function printSummary(
  summary,
  ledgerRows,
  verifyResult,
  { rowsAppended, unresolvedSpans, leakedSpans },
) {
  const header = ['type', 'detections', 'auto-redacted', 'consulted', 'allow-observed'];
  console.log('\nSummary (per entity type):');
  console.log(header.join('\t'));
  for (const type of Object.keys(summary).sort()) {
    const s = summary[type];
    console.log(
      [type, s.detections, s.autoRedacted, s.consulted, s.allowObserved].join('\t'),
    );
  }
  // The ledger is append-only and survives re-runs into the same --out,
  // while redacted.jsonl is rewritten each run — so the cumulative row count
  // alone disagrees with the per-run table above. Print both.
  console.log(`\nledger rows: ${ledgerRows.length} (+${rowsAppended} this run)`);
  console.log(`unresolved spans (redacted by literal text only): ${unresolvedSpans}`);
  console.log(`unresolved spans NOT removed (possible leak): ${leakedSpans}`);
  console.log(
    `ledger verify: ${verifyResult.ok ? 'ok' : `FAILED at row ${verifyResult.badIndex}`}`,
  );
}

async function scrub(argv) {
  const args = parseArgs(argv);
  if (!args.input) {
    throw new Error(`missing <transcripts.jsonl> argument\n${USAGE_SCRUB}`);
  }

  let transcripts;
  try {
    transcripts = readTranscripts(args.input);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`cannot read ${args.input}: ${err.message}`);
    }
    throw err;
  }

  let policy = DEFAULT_POLICY;
  if (args.policy) {
    policy = JSON.parse(fs.readFileSync(args.policy, 'utf8'));
  }

  const apiKey = process.env.PIONEER_API_KEY;
  const mockMode = args.mock || !apiKey;
  if (!args.mock && !apiKey) {
    console.error('warning: PIONEER_API_KEY not set — running in mock mode');
  }

  const salt = process.env.CLEANROOM_SALT ?? DEFAULT_SALT;
  if (!process.env.CLEANROOM_SALT) {
    console.error('warning: CLEANROOM_SALT not set — using default salt');
  }

  const modelId = args.model ?? DEFAULT_MODEL_ID;

  fs.mkdirSync(args.out, { recursive: true });
  const redactedPath = path.join(args.out, 'redacted.jsonl');
  const ledgerPath = path.join(args.out, 'ledger.jsonl');
  const ledger = new Ledger(ledgerPath);
  // The ledger chain may already exist from an earlier run into this --out.
  const rowsBefore = ledger.rows().length;

  const summary = {};
  const outputLines = [];
  let unresolvedSpans = 0;
  let leakedSpans = 0;

  for (const transcript of transcripts) {
    const { id, text } = transcript;
    // Anything that throws below (a malformed detector hit, a policy
    // TypeError) aborts the run with the ledger already appended for every
    // prior transcript — name the transcript so that is diagnosable mid-demo.
    try {
      const rawDetections = mockMode
        ? mockDetect(transcript)
        : await detect(text, { apiKey, modelId });

      const decisions = rawDetections.map((d) => {
        const decidedRoute = route(d.type, d.confidence, policy);
        // Band consult isn't wired yet (Task 5): every consult resolves as a
        // timeout, which redact.js's fail-closed rule (ADR 0003) turns into a
        // redaction rather than a silent allow.
        const disposition = decidedRoute === 'consult' ? 'timeout' : null;
        return { ...d, route: decidedRoute, disposition };
      });

      for (const d of decisions) {
        ledger.append({
          trace_id: id,
          span_hmac: spanHmac(salt, d.text),
          entity_type: d.type,
          confidence: d.confidence,
          route: d.route,
          disposition: d.disposition,
          policy_version: policy.version,
          model_id: mockMode ? 'mock' : modelId,
          prompt_hash: null,
        });

        const s =
          summary[d.type] ??
          (summary[d.type] = {
            detections: 0,
            autoRedacted: 0,
            consulted: 0,
            allowObserved: 0,
          });
        s.detections++;
        if (d.route === 'auto-redact') s.autoRedacted++;
        else if (d.route === 'consult') s.consulted++;
        else if (d.route === 'allow-observed') s.allowObserved++;
      }

      const { redactedText, unresolved } = applyDispositions(text, decisions);

      // A span the detector could not locate was redacted by literal text
      // only; the ledger row still reads `auto-redact`, so say so here rather
      // than let a possible leak pass silently (ADR 0003). Entity type only —
      // never the span text, which is the PII.
      for (const u of unresolved) {
        unresolvedSpans++;
        if (!u.scrubbed) leakedSpans++;
        // The reason must match the actual cause: an unremoved span is not
        // always one whose text is missing from the transcript, and an
        // operator who is told the wrong cause dismisses the warning.
        console.error(
          `warning: ${id}: ${u.type} span had no usable offsets — ` +
            (REASON_MESSAGES[u.reason] ?? UNKNOWN_REASON),
        );
      }

      outputLines.push(
        JSON.stringify({
          id,
          redacted_text: redactedText,
          // NOTE: `detections[].text` is the raw PII span, on purpose — this
          // file is the eval artifact scored against transcripts.jsonl ground
          // truth (context/contracts/redacted-baseline.md binds this shape).
          // It is NOT the redacted export that crosses the trust boundary;
          // only `redacted_text` is safe to hand onward.
          detections: decisions.map((d) => ({
            type: d.type,
            text: d.text,
            start: d.start,
            end: d.end,
            confidence: d.confidence,
          })),
        }),
      );
    } catch (err) {
      throw new Error(`transcript ${id ?? '<no id>'}: ${err.message}`, {
        cause: err,
      });
    }
  }

  fs.writeFileSync(redactedPath, outputLines.map((l) => `${l}\n`).join(''));

  const ledgerRows = ledger.rows();
  const verifyResult = Ledger.verify(ledgerRows);
  printSummary(summary, ledgerRows, verifyResult, {
    rowsAppended: ledgerRows.length - rowsBefore,
    unresolvedSpans,
    leakedSpans,
  });

  // Output and warnings are already written — but a run that left detected
  // PII in redacted.jsonl must not report success, or a pipeline waves it
  // through (ADR 0003).
  if (leakedSpans > 0) {
    console.error(
      `error: ${leakedSpans} detected span(s) could not be removed — redacted output may still contain PII`,
    );
    process.exitCode = EXIT_UNSCRUBBED;
  }
}

/**
 * `finetune --labels <labels.json> [--out <dir>=out] [--dry-run] [--domain <text>]`
 *
 * Evaluates the ADR 0005 gate (`shouldFineTune`) against
 * `<out>/finetune-job.json` (its existence is the 1-job cap). If the gate is
 * closed, prints why and returns without touching the network or the
 * filesystem. If open: `--dry-run` prints both Pioneer request bodies
 * verbatim and makes no network call (works with no PIONEER_API_KEY); the
 * live path calls /generate then /felix/training-jobs and persists the job
 * record so a second launch is blocked by the cap.
 */
async function finetune(argv) {
  const args = parseFinetuneArgs(argv);
  if (!args.labels) {
    throw new Error(`missing --labels argument\n${USAGE_FINETUNE}`);
  }

  let labelsJson;
  try {
    labelsJson = JSON.parse(fs.readFileSync(args.labels, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`cannot read ${args.labels}: ${err.message}`);
    }
    throw err;
  }

  const jobRecordPath = path.join(args.out, 'finetune-job.json');
  const jobRecordExists = fs.existsSync(jobRecordPath);
  const confirmedCount = countConfirmedLabels(labelsJson);

  if (!shouldFineTune(labelsJson, jobRecordExists)) {
    if (jobRecordExists) {
      console.log(
        `gate closed: a fine-tune job was already launched (${jobRecordPath} exists) — the 1-job cap (ADR 0005) is spent.`,
      );
    } else {
      console.log(
        `gate closed: ${confirmedCount} confirmed hard-case label(s), need >= 20 (ADR 0005).`,
      );
    }
    return;
  }

  const labels = deriveFinetuneLabels(labelsJson);
  const domainDescription = args.domain ?? DEFAULT_DOMAIN_DESCRIPTION;

  console.log(
    `gate open: ${confirmedCount} confirmed hard-case label(s) >= 20, no prior job — launching fine-tune.`,
  );

  if (args.dryRun) {
    console.log('\n--dry-run: request bodies that would be sent (no network calls made)\n');
    console.log('POST https://api.pioneer.ai/generate');
    console.log(JSON.stringify(buildGenerateBody({ labels, domainDescription }), null, 2));
    console.log('\nPOST https://api.pioneer.ai/felix/training-jobs');
    console.log(
      JSON.stringify(
        buildTrainingJobBody({
          baseModel: DEFAULT_BASE_MODEL,
          datasetRef: '<dataset_id from the /generate response above>',
        }),
        null,
        2,
      ),
    );
    return;
  }

  const apiKey = process.env.PIONEER_API_KEY;
  if (!apiKey) {
    throw new Error('PIONEER_API_KEY not set (use --dry-run to preview without a key)');
  }

  const generated = await generateTrainingData({ apiKey, labels, domainDescription });

  // Claim the ADR 0005 1-job cap BEFORE the irreversible launch. Persisting
  // it afterwards meant a throw in launchFineTune (or in the mkdirSync that
  // used to sit between them) left the job existing with the cap unspent.
  // /generate is cheap and reversible, so the placeholder goes after it.
  fs.mkdirSync(args.out, { recursive: true });
  const launchedAt = new Date().toISOString();
  fs.writeFileSync(
    jobRecordPath,
    `${JSON.stringify(
      { jobId: null, status: 'launching', launchedAt, baseModel: DEFAULT_BASE_MODEL },
      null,
      2,
    )}\n`,
  );

  const launched = await launchFineTune({ apiKey, datasetRef: generated.datasetRef });

  const record = {
    jobId: launched.jobId,
    launchedAt,
    baseModel: DEFAULT_BASE_MODEL,
  };
  fs.writeFileSync(jobRecordPath, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\nfine-tune job launched: ${launched.jobId}`);
}

/**
 * `finetune-status <jobId>` — prints the job's current state; once
 * `deployed`, also prints the exact A/B scrub command (Task 4's live mode
 * accepts `--model` to override the model id).
 */
async function finetuneStatus(argv) {
  const [jobId] = argv;
  if (!jobId) {
    throw new Error(`missing <jobId> argument\n${USAGE_FINETUNE_STATUS}`);
  }

  const apiKey = process.env.PIONEER_API_KEY;
  if (!apiKey) {
    throw new Error('PIONEER_API_KEY not set');
  }

  const { status } = await jobStatus({ apiKey, jobId });
  console.log(`job ${jobId}: ${status}`);
  if (status === 'deployed') {
    console.log(`\nA/B scrub command:\n  node sentinel/cli.js scrub <file> --model ${jobId}`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'scrub') {
      await scrub(rest);
    } else if (command === 'finetune') {
      await finetune(rest);
    } else if (command === 'finetune-status') {
      await finetuneStatus(rest);
    } else {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
