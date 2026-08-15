// Builds the /api/state payload by re-reading the scrub output directory on every call.
// Nothing is cached: a demo run that appends to redacted.jsonl / ledger.jsonl shows up on the
// next 2s poll. Missing or half-written files degrade to an empty state, never an exception.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { verifyChain } from './chain.js';

const ROUTES = ['auto-redact', 'consult', 'allow-observed'];
const DISPOSITIONS = ['redact', 'pseudonymize', 'allow', 'timeout'];

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

/**
 * @param {string} dir directory holding redacted.jsonl and ledger.jsonl.
 * @returns {object} the full dashboard state; safe to call when the directory does not exist.
 */
export function buildState(dir) {
  const redacted = readJsonl(join(dir, 'redacted.jsonl'));
  const ledger = readJsonl(join(dir, 'ledger.jsonl'));

  return {
    ok: true,
    dir,
    generated_at: new Date().toISOString(),
    sources: { redacted: redacted.source, ledger: ledger.source },
    transcripts: redacted.records,
    ledger: ledger.records,
    integrity: verifyChain(ledger.records),
    summary: summarize(ledger.records),
  };
}
