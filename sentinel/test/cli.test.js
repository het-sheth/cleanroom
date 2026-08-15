import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, PAYLOAD_KEYS } from '../lib/ledger.js';
import { DEFAULT_POLICY } from '../lib/policy.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../cli.js', import.meta.url));

// Mirrors the mock-mode formula from cli.js (and the plan): computed here,
// not guessed, per the Task 4 brief.
function mockConfidence(id, type, value) {
  const hash = createHash('sha256').update(id + type + value).digest('hex');
  const n = parseInt(hash.slice(0, 4), 16);
  return 0.3 + (n / 0xffff) * 0.65;
}

// Values below reuse real dataset entries verified in
// context/status/integration-risks.md finding 3, against the real
// data/transcripts.jsonl ids/types/values:
//   t24/address "1847 Kestrel Lane Apt 3B, Modesto, CA 95350" -> 0.3025 (below floor)
//   t15/phone   "+47 21 555 019"                              -> 0.3099 (below floor)
//   t16/username "@rmoyer-dev"                                -> 0.8328 (consult, contextual override)
// The ssn value/id pair below-floor-adjacent case is searched, not
// hand-picked, to land >= the default 0.75 ceiling for a non-contextual
// type (auto-redact).
const T24_SSN = '523-04-0002';
const T24_ADDRESS = '1847 Kestrel Lane Apt 3B, Modesto, CA 95350';
const T15_PHONE = '+47 21 555 019';
const T16_USERNAME = '@rmoyer-dev';

const CONF_T24_SSN = mockConfidence('t24', 'ssn', T24_SSN);
const CONF_T24_ADDRESS = mockConfidence('t24', 'address', T24_ADDRESS);
const CONF_T15_PHONE = mockConfidence('t15', 'phone', T15_PHONE);
const CONF_T16_USERNAME = mockConfidence('t16', 'username', T16_USERNAME);

// Sanity-check the fixture actually exercises what the brief asks for
// before relying on it in the assertions below.
test('fixture confidences land in the expected route buckets', () => {
  assert.ok(CONF_T24_SSN >= DEFAULT_POLICY.ceilings.default, 'ssn case must auto-redact');
  assert.ok(CONF_T24_ADDRESS < DEFAULT_POLICY.floor, 'address case must be below floor');
  assert.ok(CONF_T15_PHONE < DEFAULT_POLICY.floor, 'phone case must be below floor');
  assert.ok(
    CONF_T16_USERNAME >= DEFAULT_POLICY.ceilings.default,
    'username case must be above ceiling to prove the contextual override',
  );
});

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function buildFixture() {
  const dir = tempDir('sentinel-cli-fixture-');
  const lines = [
    {
      id: 't24',
      text: `The employee record lists SSN ${T24_SSN} on file. His home address was ${T24_ADDRESS}, and the SSN was re-confirmed as ${T24_SSN} during the audit.`,
      planted: [
        { type: 'ssn', value: T24_SSN },
        { type: 'address', value: T24_ADDRESS },
      ],
      difficulty: 'easy',
    },
    {
      id: 't15',
      text: `Contact reached via ${T15_PHONE} for a callback regarding the claim.`,
      planted: [{ type: 'phone', value: T15_PHONE }],
      difficulty: 'easy',
    },
    {
      id: 't16',
      text: `Reviewer ${T16_USERNAME} approved the PR after two rounds of comments from ${T16_USERNAME}.`,
      planted: [{ type: 'username', value: T16_USERNAME }],
      difficulty: 'easy',
    },
  ];
  const inputPath = path.join(dir, 'transcripts.jsonl');
  fs.writeFileSync(inputPath, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  return { dir, inputPath };
}

function runCli(args, opts = {}) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, PIONEER_API_KEY: '', CLEANROOM_SALT: 'test-salt-fixture', ...opts.env },
    ...opts,
  });
}

test('scrub over the 3-transcript mock fixture produces correct redacted output and a verifying ledger', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  const { stdout } = await runCli(['scrub', inputPath, '--out', outDir, '--mock']);

  // Never log the salt.
  assert.equal(stdout.includes('test-salt-fixture'), false);
  assert.match(stdout, /ledger verify: ok/);
  assert.match(stdout, /ledger rows: 6/);

  const redactedLines = fs
    .readFileSync(path.join(outDir, 'redacted.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(redactedLines.length, 3);

  const byId = Object.fromEntries(redactedLines.map((l) => [l.id, l]));

  // t24: ssn auto-redacted (both occurrences, via offset + repeat scrub),
  // address left in place (below floor -> allow-observed).
  assert.equal(byId.t24.redacted_text.includes(T24_SSN), false);
  assert.equal(byId.t24.redacted_text.includes('[SSN_1]'), true);
  assert.equal(
    (byId.t24.redacted_text.match(/\[SSN_1\]/g) ?? []).length,
    2,
    'both ssn occurrences replaced with the same token',
  );
  assert.equal(byId.t24.redacted_text.includes(T24_ADDRESS), true);
  assert.equal(byId.t24.detections.length, 3);
  const t24Confidences = Object.fromEntries(
    byId.t24.detections.map((d) => [`${d.type}:${d.text}`, d.confidence]),
  );
  assert.equal(t24Confidences[`ssn:${T24_SSN}`], CONF_T24_SSN);
  assert.equal(t24Confidences[`address:${T24_ADDRESS}`], CONF_T24_ADDRESS);

  // t15: below-floor phone, allow-observed -> text untouched.
  assert.equal(
    byId.t15.redacted_text,
    `Contact reached via ${T15_PHONE} for a callback regarding the claim.`,
  );
  assert.equal(byId.t15.detections.length, 1);
  assert.equal(byId.t15.detections[0].confidence, CONF_T15_PHONE);

  // t16: contextual username, above ceiling but still routed to consult;
  // Band isn't wired so it resolves timeout -> fail-closed redact, both
  // occurrences scrubbed.
  assert.equal(byId.t16.redacted_text.includes(T16_USERNAME), false);
  assert.equal(
    (byId.t16.redacted_text.match(/\[USERNAME_1\]/g) ?? []).length,
    2,
  );
  assert.equal(byId.t16.detections.length, 2);
  for (const d of byId.t16.detections) {
    assert.equal(d.confidence, CONF_T16_USERNAME);
  }

  // Ledger: verify independently via the library, not just the CLI's own claim.
  const ledger = new Ledger(path.join(outDir, 'ledger.jsonl'));
  const rows = ledger.rows();
  assert.equal(rows.length, 6);
  assert.deepEqual(Ledger.verify(rows), { ok: true });

  for (const row of rows) {
    for (const key of PAYLOAD_KEYS) {
      assert.ok(key in row, `row missing payload key ${key}`);
    }
    assert.equal(row.model_id, 'mock');
    assert.equal(row.policy_version, DEFAULT_POLICY.version);
    // span_hmac must not leak the raw salt or span verbatim as itself.
    assert.match(row.span_hmac, /^[0-9a-f]{64}$/);
  }

  const ssnRows = rows.filter((r) => r.entity_type === 'ssn');
  assert.equal(ssnRows.length, 2);
  for (const r of ssnRows) {
    assert.equal(r.route, 'auto-redact');
    assert.equal(r.disposition, null);
  }

  const addressRow = rows.find((r) => r.entity_type === 'address');
  assert.equal(addressRow.route, 'allow-observed');
  assert.equal(addressRow.disposition, null);

  const phoneRow = rows.find((r) => r.entity_type === 'phone');
  assert.equal(phoneRow.route, 'allow-observed');
  assert.equal(phoneRow.disposition, null);

  const usernameRows = rows.filter((r) => r.entity_type === 'username');
  assert.equal(usernameRows.length, 2);
  for (const r of usernameRows) {
    assert.equal(r.route, 'consult');
    assert.equal(r.disposition, 'timeout');
  }
});

test('auto-selects mock mode and warns when PIONEER_API_KEY is unset, without --mock', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  const { stderr } = await runCli(['scrub', inputPath, '--out', outDir]);
  assert.match(stderr, /mock mode/);
  assert.equal(
    fs.existsSync(path.join(outDir, 'redacted.jsonl')),
    true,
  );
});

test('warns and defaults the salt when CLEANROOM_SALT is unset', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  const { stderr } = await runCli(['scrub', inputPath, '--out', outDir, '--mock'], {
    env: { CLEANROOM_SALT: undefined },
  });
  assert.match(stderr, /CLEANROOM_SALT/);
  assert.equal(stderr.includes('dev-salt'), false, 'must not log the actual salt value');
});

test('exits non-zero and prints the path on an unreadable input file', async () => {
  const outDir = tempDir('sentinel-cli-out-');
  const missingPath = path.join(tempDir('sentinel-cli-missing-'), 'nope.jsonl');

  await assert.rejects(
    () => runCli(['scrub', missingPath, '--out', outDir, '--mock']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /cannot read/);
      assert.match(err.stderr, new RegExp(missingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    },
  );
});

test('exits non-zero and reports the line number on invalid JSON in the transcript file', async () => {
  const dir = tempDir('sentinel-cli-badinput-');
  const inputPath = path.join(dir, 'transcripts.jsonl');
  const goodLine = JSON.stringify({ id: 't1', text: 'hello', planted: [] });
  fs.writeFileSync(inputPath, `${goodLine}\nnot valid json\n${goodLine}\n`);
  const outDir = tempDir('sentinel-cli-out-');

  await assert.rejects(
    () => runCli(['scrub', inputPath, '--out', outDir, '--mock']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /line 2/);
      return true;
    },
  );
});

test('scrub accepts --model in mock mode (parsed, no error); mock-mode ledger rows stay model_id "mock"', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  await runCli(['scrub', inputPath, '--out', outDir, '--mock', '--model', 'some-finetune-job-id']);

  const ledger = new Ledger(path.join(outDir, 'ledger.jsonl'));
  const rows = ledger.rows();
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.model_id, 'mock');
  }
});

// ---- I3: a mid-file failure names the transcript --------------------------

test('I3: a routing failure names the offending transcript id in the error', async () => {
  const dir = tempDir('sentinel-cli-badhit-');
  const inputPath = path.join(dir, 'transcripts.jsonl');
  const lines = [
    { id: 't01', text: `SSN ${T24_SSN} on file.`, planted: [{ type: 'ssn', value: T24_SSN }] },
    // No `type` on the planted entry -> a detection with type undefined,
    // which policy.route rejects. The CLI must say which transcript died.
    { id: 't99', text: `SSN ${T24_SSN} on file.`, planted: [{ value: T24_SSN }] },
  ];
  fs.writeFileSync(inputPath, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  const outDir = tempDir('sentinel-cli-out-');

  await assert.rejects(
    () => runCli(['scrub', inputPath, '--out', outDir, '--mock']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /t99/, 'error must name the failing transcript');
      assert.match(err.stderr, /entityType must be a string/);
      return true;
    },
  );
});

// ---- I4: re-running into the same --out ----------------------------------

test('I4: re-running scrub into the same --out reports rows appended this run, not just the total', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  const first = await runCli(['scrub', inputPath, '--out', outDir, '--mock']);
  assert.match(first.stdout, /ledger rows: 6 \(\+6 this run\)/);

  const second = await runCli(['scrub', inputPath, '--out', outDir, '--mock']);
  assert.match(
    second.stdout,
    /ledger rows: 12 \(\+6 this run\)/,
    'cumulative ledger rows must be reported alongside this run\'s appended count',
  );

  // redacted.jsonl is rewritten, not appended — which is exactly why the
  // cumulative ledger count alone was misleading.
  const redactedLines = fs
    .readFileSync(path.join(outDir, 'redacted.jsonl'), 'utf8')
    .trim()
    .split('\n');
  assert.equal(redactedLines.length, 3);

  const rows = new Ledger(path.join(outDir, 'ledger.jsonl')).rows();
  assert.equal(rows.length, 12);
  assert.deepEqual(Ledger.verify(rows), { ok: true });
});

test('exits non-zero on an unrecognized subcommand', async () => {
  await assert.rejects(
    () => runCli(['bogus']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /usage/);
      return true;
    },
  );
});
