import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from '../lib/sha256.js';
import { GENESIS_PREV_HASH, canonicalPayload, computeRowHash, verifyChain } from '../lib/chain.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function loadLedger() {
  return readFileSync(join(FIXTURES, 'ledger.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

test('sha256Hex matches node:crypto', () => {
  const inputs = [
    '',
    'a',
    'the quick brown fox',
    'x'.repeat(55), // one byte short of needing a second block
    'x'.repeat(56), // padding spills into a second block
    'x'.repeat(64),
    'x'.repeat(1000),
    'naïve — café — 🔒', // multi-byte UTF-8
    GENESIS_PREV_HASH + '{"trace_id":"t01"}',
  ];
  for (const input of inputs) {
    assert.equal(sha256Hex(input), createHash('sha256').update(input).digest('hex'), `mismatch for ${input.length} chars`);
  }
});

test('canonicalPayload writes missing fields as null in contract order', () => {
  const payload = canonicalPayload({ trace_id: 't01', entity_type: 'ssn', route: 'auto-redact', ignored: 'not hashed' });
  assert.equal(
    payload,
    '{"trace_id":"t01","span_hmac":null,"entity_type":"ssn","confidence":null,"route":"auto-redact",' +
      '"disposition":null,"policy_version":null,"model_id":null,"prompt_hash":null}',
  );
  // an absent field and an explicit null hash identically
  assert.equal(computeRowHash(GENESIS_PREV_HASH, { trace_id: 't01' }), computeRowHash(GENESIS_PREV_HASH, { trace_id: 't01', prompt_hash: null }));
});

test('an empty ledger verifies', () => {
  assert.deepEqual(verifyChain([]), {
    ok: true, length: 0, head: null, broken_index: null, reason: null, expected: null, found: null,
  });
});

test('the fixture chain verifies end to end', () => {
  const rows = loadLedger();
  const result = verifyChain(rows);
  assert.equal(result.ok, true, result.reason ?? '');
  assert.equal(result.length, rows.length);
  assert.equal(result.head, rows[rows.length - 1].row_hash);
  assert.equal(rows[0].prev_hash, GENESIS_PREV_HASH);
});

test('flipping one payload field is caught at that row index', () => {
  const rows = loadLedger();
  const index = 7;
  rows[index] = { ...rows[index], confidence: 0.11 };

  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.broken_index, index);
  assert.match(result.reason, /row_hash/);
  assert.notEqual(result.expected, result.found);
  assert.equal(result.found, rows[index].row_hash);
});

test('a broken prev_hash link is caught at that row index', () => {
  const rows = loadLedger();
  const index = 3;
  rows[index] = { ...rows[index], prev_hash: 'f'.repeat(64) };

  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.broken_index, index);
  assert.match(result.reason, /prev_hash/);
  assert.equal(result.expected, rows[index - 1].row_hash);
});

test('a genesis row that does not start from 64 zeros is caught at row 0', () => {
  const rows = loadLedger();
  rows[0] = { ...rows[0], prev_hash: '1'.repeat(64) };

  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.broken_index, 0);
  assert.match(result.reason, /genesis/);
});

test('deleting a row breaks the chain at the splice point', () => {
  const rows = loadLedger();
  rows.splice(5, 1);

  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.broken_index, 5);
});
