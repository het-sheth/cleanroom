// Ledger chain verification — context/contracts/ledger-row.md.
//
//   row_hash = sha256(prev_hash + canonical-JSON of the row's payload fields)
//
// "Canonical JSON" here is JSON.stringify over an object carrying exactly PAYLOAD_FIELDS, in
// the column order of the contract table, with any missing field written as null. prev_hash
// and row_hash are chain metadata and are not part of the payload; `id` is storage-assigned
// (serial) and is not part of the payload either.
//
// Claim scope (ADR 0004): tamper-evident to a third party holding an earlier head, not
// tamper-proof against the storage operator.

import { sha256Hex } from './sha256.js';

export const GENESIS_PREV_HASH = '0'.repeat(64);

export const PAYLOAD_FIELDS = [
  'trace_id',
  'span_hmac',
  'entity_type',
  'confidence',
  'route',
  'disposition',
  'policy_version',
  'model_id',
  'prompt_hash',
];

/** @returns {string} the exact preimage tail hashed for a row. */
export function canonicalPayload(row) {
  const payload = {};
  for (const field of PAYLOAD_FIELDS) {
    payload[field] = row[field] === undefined ? null : row[field];
  }
  return JSON.stringify(payload);
}

export function computeRowHash(prevHash, row) {
  return sha256Hex(String(prevHash) + canonicalPayload(row));
}

/**
 * Recompute the chain forward from genesis and report the first break.
 *
 * @param {object[]} rows decision records in append order (oldest first).
 * @returns {{ok: boolean, length: number, head: string|null, broken_index: number|null,
 *   reason: string|null, expected: string|null, found: string|null}}
 *   `broken_index` is a zero-based index into `rows`.
 */
export function verifyChain(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const head = list.length ? (list[list.length - 1].row_hash ?? null) : null;
  const base = { ok: true, length: list.length, head, broken_index: null, reason: null, expected: null, found: null };

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : list[i - 1].row_hash;

    if (row.prev_hash !== expectedPrev) {
      return {
        ...base,
        ok: false,
        broken_index: i,
        reason: i === 0 ? 'genesis prev_hash is not 64 zeros' : "prev_hash does not link to the previous row's row_hash",
        expected: expectedPrev ?? null,
        found: row.prev_hash ?? null,
      };
    }

    const recomputed = computeRowHash(row.prev_hash, row);
    if (recomputed !== row.row_hash) {
      return {
        ...base,
        ok: false,
        broken_index: i,
        reason: 'row_hash does not match the recomputed payload hash',
        expected: recomputed,
        found: row.row_hash ?? null,
      };
    }
  }

  return base;
}
