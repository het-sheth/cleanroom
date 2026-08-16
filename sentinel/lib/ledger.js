// Hash-chain ledger: append-only, tamper-evident decision log.
// Implements context/contracts/ledger-row.md. Pure hashing functions plus a
// small file-backed store (JSON Lines). No dependencies beyond node:crypto
// and node:fs.

import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';

export const GENESIS = '0'.repeat(64);

// Canonical payload field order — the row_hash and the dashboard verifier
// must serialize fields in exactly this order. Do not reorder.
export const PAYLOAD_KEYS = [
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

/**
 * HMAC-SHA256 of a raw span, keyed by a caller-supplied salt. The salt is
 * never stored by this module — callers own its lifecycle.
 *
 * @param {string} salt
 * @param {string} spanText
 * @returns {string} hex HMAC
 */
export function spanHmac(salt, spanText) {
  return createHmac('sha256', salt).update(spanText).digest('hex');
}

/**
 * Pick the 9 canonical payload fields from `payload`, in PAYLOAD_KEYS
 * order, substituting `null` for any field that is missing or undefined.
 */
function pickPayload(payload) {
  const picked = {};
  for (const key of PAYLOAD_KEYS) {
    picked[key] = payload[key] ?? null;
  }
  return picked;
}

/**
 * sha256hex(prevHash + JSON.stringify(canonical payload)).
 *
 * @param {string} prevHash
 * @param {object} payload
 * @returns {string} hex sha256
 */
export function rowHash(prevHash, payload) {
  const canonical = JSON.stringify(pickPayload(payload));
  return createHash('sha256').update(prevHash + canonical).digest('hex');
}

/**
 * Append-only, file-backed hash-chain ledger. One JSON object per line.
 */
export class Ledger {
  #filePath;

  constructor(filePath) {
    this.#filePath = filePath;
  }

  /**
   * Append a payload as a new chained row and persist it.
   *
   * @param {object} payload
   * @returns {object} full row: {...payload, prev_hash, row_hash}
   */
  append(payload) {
    const existing = this.rows();
    const prevHash =
      existing.length > 0 ? existing[existing.length - 1].row_hash : GENESIS;
    const row = {
      ...payload,
      prev_hash: prevHash,
      row_hash: rowHash(prevHash, payload),
    };
    fs.appendFileSync(this.#filePath, `${JSON.stringify(row)}\n`);
    return row;
  }

  /**
   * All parsed rows currently persisted, in append order.
   *
   * @returns {object[]}
   */
  rows() {
    let content;
    try {
      content = fs.readFileSync(this.#filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return content
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  }

  /**
   * Recompute the chain forward from GENESIS and check every row_hash.
   *
   * @param {object[]} rows
   * @returns {{ok: true} | {ok: false, badIndex: number}}
   */
  static verify(rows) {
    let prevHash = GENESIS;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const expected = rowHash(prevHash, row);
      if (row.prev_hash !== prevHash || row.row_hash !== expected) {
        return { ok: false, badIndex: i };
      }
      prevHash = row.row_hash;
    }
    return { ok: true };
  }
}
