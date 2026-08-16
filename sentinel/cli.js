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

// Must match detector.js's own default — kept as a separate constant here
// (rather than imported) so the CLI, not the detector module, owns which
// model it asks for. Task 5 adds a --model override on top of this.
const DEFAULT_MODEL_ID = 'fastino/gliner2-privacy-filter-PII-multi';
const DEFAULT_SALT = 'dev-salt';

const USAGE =
  'usage: node sentinel/cli.js scrub <transcripts.jsonl> [--out <dir>=out] [--mock] [--policy <json-file>]';

function parseArgs(argv) {
  const args = { input: undefined, out: 'out', mock: false, policy: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      args.out = argv[++i];
    } else if (a === '--mock') {
      args.mock = true;
    } else if (a === '--policy') {
      args.policy = argv[++i];
    } else if (args.input === undefined) {
      args.input = a;
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
  for (const { type, value } of planted) {
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

function printSummary(summary, ledgerRows, verifyResult) {
  const header = ['type', 'detections', 'auto-redacted', 'consulted', 'allow-observed'];
  console.log('\nSummary (per entity type):');
  console.log(header.join('\t'));
  for (const type of Object.keys(summary).sort()) {
    const s = summary[type];
    console.log(
      [type, s.detections, s.autoRedacted, s.consulted, s.allowObserved].join('\t'),
    );
  }
  console.log(`\nledger rows: ${ledgerRows.length}`);
  console.log(
    `ledger verify: ${verifyResult.ok ? 'ok' : `FAILED at row ${verifyResult.badIndex}`}`,
  );
}

async function scrub(argv) {
  const args = parseArgs(argv);
  if (!args.input) {
    throw new Error(`missing <transcripts.jsonl> argument\n${USAGE}`);
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

  fs.mkdirSync(args.out, { recursive: true });
  const redactedPath = path.join(args.out, 'redacted.jsonl');
  const ledgerPath = path.join(args.out, 'ledger.jsonl');
  const ledger = new Ledger(ledgerPath);

  const summary = {};
  const outputLines = [];

  for (const transcript of transcripts) {
    const { id, text } = transcript;
    const rawDetections = mockMode
      ? mockDetect(transcript)
      : await detect(text, { apiKey, modelId: DEFAULT_MODEL_ID });

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
        model_id: mockMode ? 'mock' : DEFAULT_MODEL_ID,
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

    const { redactedText } = applyDispositions(text, decisions);
    outputLines.push(
      JSON.stringify({
        id,
        redacted_text: redactedText,
        detections: decisions.map((d) => ({
          type: d.type,
          text: d.text,
          start: d.start,
          end: d.end,
          confidence: d.confidence,
        })),
      }),
    );
  }

  fs.writeFileSync(redactedPath, outputLines.map((l) => `${l}\n`).join(''));

  const ledgerRows = ledger.rows();
  const verifyResult = Ledger.verify(ledgerRows);
  printSummary(summary, ledgerRows, verifyResult);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'scrub') {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  try {
    await scrub(rest);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
