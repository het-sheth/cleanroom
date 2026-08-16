// Builds the /api/state payload from the scrub output directory.
//
// TRUST BOUNDARY. `sentinel scrub` no longer writes `detections[].text` (the raw PII span) —
// but Track B's baseline output and the shipped fixtures still carry it, and a stale run's
// redacted.jsonl may too. That field must never cross the HTTP boundary. Records are projected
// onto an explicit field whitelist here, at the boundary, so pointing the server at any output
// directory cannot leak PII regardless of what wrote it. Ledger rows carry span_hmac, not
// spans, and pass through untouched so the browser can verify the hash chain byte-for-byte.
//
// Reads are memoised on (mtime, size) of both files: a demo run that appends to either shows
// up on the next 2s poll, but idle polls do not re-read and re-hash the whole chain.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { verifyChain } from './chain.js';

const ROUTES = ['auto-redact', 'consult', 'allow-observed'];
const DISPOSITIONS = ['redact', 'pseudonymize', 'allow', 'timeout'];

// Whitelists, not blacklists: anything not named here never reaches the client.
const TRANSCRIPT_FIELDS = ['id', 'redacted_text'];
const DETECTION_FIELDS = ['type', 'start', 'end', 'confidence', 'route', 'disposition', 'token', 'placeholder', 'span_hmac'];

function project(record, fields) {
  const out = {};
  for (const field of fields) {
    if (record && Object.hasOwn(record, field)) out[field] = record[field];
  }
  return out;
}

/** Strips the raw PII span (and anything else unrecognised) off a redacted.jsonl record. */
function safeTranscript(record) {
  const out = project(record, TRANSCRIPT_FIELDS);
  const detections = Array.isArray(record?.detections) ? record.detections : [];
  out.detections = detections.map((d) => project(d, DETECTION_FIELDS));
  return out;
}

function readJsonl(path) {
  const source = { path, present: false, records: 0, parse_errors: [], mtime_ms: null };
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
    source.present = true;
    source.mtime_ms = statSync(path).mtimeMs;
  } catch {
    return { source, records: [] };
  }

  const records = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
      else source.parse_errors.push({ line: i + 1, message: 'not a JSON object' });
    } catch (err) {
      // A partially flushed last line is normal while a scrub run is in flight.
      source.parse_errors.push({ line: i + 1, message: err.message });
    }
  }
  source.records = records.length;
  return { source, records };
}

function summarize(ledger) {
  const routes = Object.fromEntries(ROUTES.map((r) => [r, 0]));
  const dispositions = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  const byType = new Map();

  for (const row of ledger) {
    const type = row.entity_type ?? 'unknown';
    const route = row.route ?? 'unknown';
    if (!byType.has(type)) {
      byType.set(type, { entity_type: type, total: 0, ...Object.fromEntries(ROUTES.map((r) => [r, 0])) });
    }
    const bucket = byType.get(type);
    bucket.total += 1;
    if (route in bucket) bucket[route] += 1;
    if (route in routes) routes[route] += 1;
    if (row.disposition && row.disposition in dispositions) dispositions[row.disposition] += 1;
  }

  return {
    total: ledger.length,
    routes,
    dispositions,
    observed_not_acted: routes['allow-observed'],
    by_type: [...byType.values()].sort((a, b) => b.total - a.total || a.entity_type.localeCompare(b.entity_type)),
  };
}

function fileSignature(path) {
  try {
    const st = statSync(path);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'absent';
  }
}

/** One entry — the server watches a single directory. */
let cache = null;

/**
 * @param {string} dir directory holding redacted.jsonl and ledger.jsonl.
 * @returns {object} the full dashboard state; safe to call when the directory does not exist.
 */
export function buildState(dir) {
  const redactedPath = join(dir, 'redacted.jsonl');
  const ledgerPath = join(dir, 'ledger.jsonl');
  const signature = `${dir}|${fileSignature(redactedPath)}|${fileSignature(ledgerPath)}`;

  if (!cache || cache.signature !== signature) {
    const redacted = readJsonl(redactedPath);
    const ledger = readJsonl(ledgerPath);
    cache = {
      signature,
      state: {
        ok: true,
        dir,
        generated_at: null,
        sources: { redacted: redacted.source, ledger: ledger.source },
        transcripts: redacted.records.map(safeTranscript),
        ledger: ledger.records,
        integrity: verifyChain(ledger.records),
        summary: summarize(ledger.records),
      },
    };
  }

  return { ...cache.state, generated_at: new Date().toISOString() };
}
