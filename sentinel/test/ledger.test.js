import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  GENESIS,
  PAYLOAD_KEYS,
  spanHmac,
  rowHash,
  Ledger,
} from '../lib/ledger.js';

function tempLedgerPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  return path.join(dir, 'ledger.jsonl');
}

function samplePayload(overrides = {}) {
  return {
    trace_id: 'trace-1',
    span_hmac: 'a'.repeat(64),
    entity_type: 'email',
    confidence: 0.9,
    route: 'auto-redact',
    disposition: 'redact',
    policy_version: 1,
    model_id: 'gliner2-base',
    prompt_hash: null,
    ...overrides,
  };
}

test('GENESIS is 64 zeros', () => {
  assert.equal(GENESIS, '0'.repeat(64));
  assert.equal(GENESIS.length, 64);
});

test('PAYLOAD_KEYS is the canonical 9-field order', () => {
  assert.deepEqual(PAYLOAD_KEYS, [
    'trace_id',
    'span_hmac',
    'entity_type',
    'confidence',
    'route',
    'disposition',
    'policy_version',
    'model_id',
    'prompt_hash',
  ]);
});

test('spanHmac differs across salts for the same span text', () => {
  const spanText = 'jane.doe@example.com';
  const a = spanHmac('salt-a', spanText);
  const b = spanHmac('salt-b', spanText);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
});

test('spanHmac is deterministic for the same salt and span text', () => {
  const spanText = 'jane.doe@example.com';
  assert.equal(spanHmac('salt-a', spanText), spanHmac('salt-a', spanText));
});

test('rowHash is deterministic for the same input', () => {
  const payload = samplePayload();
  const h1 = rowHash(GENESIS, payload);
  const h2 = rowHash(GENESIS, payload);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('rowHash matches manual canonicalization (missing fields -> null)', () => {
  const payload = { trace_id: 't1', entity_type: 'email' };
  const canonical = PAYLOAD_KEYS.map((key) =>
    Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : null,
  );
  const expectedPicked = {};
  PAYLOAD_KEYS.forEach((key, i) => {
    expectedPicked[key] = canonical[i];
  });
  const expected = createHash('sha256')
    .update(GENESIS + JSON.stringify(expectedPicked))
    .digest('hex');
  assert.equal(rowHash(GENESIS, payload), expected);
});

test('rowHash ignores extra payload fields outside PAYLOAD_KEYS', () => {
  const base = samplePayload();
  const withExtra = { ...base, extra_field: 'ignore-me' };
  assert.equal(rowHash(GENESIS, base), rowHash(GENESIS, withExtra));
});

test('Ledger.append returns full row with prev_hash and row_hash', () => {
  const ledger = new Ledger(tempLedgerPath());
  const payload = samplePayload();
  const row = ledger.append(payload);
  assert.equal(row.prev_hash, GENESIS);
  assert.equal(row.row_hash, rowHash(GENESIS, payload));
  assert.equal(row.trace_id, 'trace-1');
});

test('Ledger.append creates the file if absent', () => {
  const filePath = tempLedgerPath();
  assert.equal(fs.existsSync(filePath), false);
  const ledger = new Ledger(filePath);
  ledger.append(samplePayload());
  assert.equal(fs.existsSync(filePath), true);
});

test('hash chain of 3 appends verifies ok', () => {
  const ledger = new Ledger(tempLedgerPath());
  ledger.append(samplePayload({ trace_id: 'trace-1' }));
  ledger.append(samplePayload({ trace_id: 'trace-2' }));
  ledger.append(samplePayload({ trace_id: 'trace-3' }));

  const rows = ledger.rows();
  assert.equal(rows.length, 3);
  assert.deepEqual(Ledger.verify(rows), { ok: true });
});

test('tampering with row 1 entity_type is detected at badIndex 1', () => {
  const ledger = new Ledger(tempLedgerPath());
  ledger.append(samplePayload({ trace_id: 'trace-1' }));
  ledger.append(samplePayload({ trace_id: 'trace-2' }));
  ledger.append(samplePayload({ trace_id: 'trace-3' }));

  const rows = ledger.rows();
  rows[1].entity_type = 'ssn';

  assert.deepEqual(Ledger.verify(rows), { ok: false, badIndex: 1 });
});

test('tampering with a row_hash is detected', () => {
  const ledger = new Ledger(tempLedgerPath());
  ledger.append(samplePayload({ trace_id: 'trace-1' }));
  ledger.append(samplePayload({ trace_id: 'trace-2' }));

  const rows = ledger.rows();
  rows[1].row_hash = 'f'.repeat(64);

  assert.deepEqual(Ledger.verify(rows), { ok: false, badIndex: 1 });
});

test('tampering with a prev_hash field alone is detected', () => {
  const ledger = new Ledger(tempLedgerPath());
  ledger.append(samplePayload({ trace_id: 'trace-1' }));
  ledger.append(samplePayload({ trace_id: 'trace-2' }));

  const rows = ledger.rows();
  rows[1].prev_hash = 'e'.repeat(64);

  assert.deepEqual(Ledger.verify(rows), { ok: false, badIndex: 1 });
});

test('file round-trip: append, reopen with new Ledger instance, verify ok', () => {
  const filePath = tempLedgerPath();
  const writer = new Ledger(filePath);
  writer.append(samplePayload({ trace_id: 'trace-1' }));
  writer.append(samplePayload({ trace_id: 'trace-2' }));

  const reader = new Ledger(filePath);
  const rows = reader.rows();
  assert.equal(rows.length, 2);
  assert.deepEqual(Ledger.verify(rows), { ok: true });
});

test('rows() returns an empty array when the file does not exist', () => {
  const ledger = new Ledger(tempLedgerPath());
  assert.deepEqual(ledger.rows(), []);
});

test('empty rows array verifies ok', () => {
  assert.deepEqual(Ledger.verify([]), { ok: true });
});
