import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger, PAYLOAD_KEYS, spanHmac } from '../lib/ledger.js';
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

const FIXTURE_SALT = 'test-salt-fixture';

function runCli(args, opts = {}) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, PIONEER_API_KEY: '', CLEANROOM_SALT: FIXTURE_SALT, ...opts.env },
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
  // Detections are keyed by the salted span hash, not the raw span — the
  // span text never reaches this file (see the trust-boundary test below).
  const t24Confidences = Object.fromEntries(
    byId.t24.detections.map((d) => [`${d.type}:${d.span_hmac}`, d.confidence]),
  );
  assert.equal(
    t24Confidences[`ssn:${spanHmac(FIXTURE_SALT, T24_SSN)}`],
    CONF_T24_SSN,
  );
  assert.equal(
    t24Confidences[`address:${spanHmac(FIXTURE_SALT, T24_ADDRESS)}`],
    CONF_T24_ADDRESS,
  );

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

// ---- trust boundary: redacted.jsonl carries no raw span text -------------

// Every field a persisted detection is allowed to carry. A whitelist, not a
// blacklist: a new detector field must be added here deliberately, after
// someone has decided it is not PII (ADR 0003, fail closed).
const DETECTION_FIELDS = [
  'confidence',
  'disposition',
  'end',
  'route',
  'span_hmac',
  'start',
  'token',
  'type',
];

test('scrub writes no raw span text into redacted.jsonl — only a salted hash', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  await runCli(['scrub', inputPath, '--out', outDir, '--mock']);

  const raw = fs.readFileSync(path.join(outDir, 'redacted.jsonl'), 'utf8');

  // Redacted spans are gone from the file outright.
  assert.equal(raw.includes(T24_SSN), false, 'raw ssn span leaked into redacted.jsonl');
  assert.equal(
    raw.includes(T16_USERNAME),
    false,
    'raw username span leaked into redacted.jsonl',
  );
  assert.equal(
    /"text"\s*:/.test(raw),
    false,
    'a detections[].text field leaked into redacted.jsonl',
  );

  // allow-observed spans survive in redacted_text on purpose (the observed-
  // not-acted wedge) — but never as a detection field.
  const plantedValues = [T24_SSN, T24_ADDRESS, T15_PHONE, T16_USERNAME];
  for (const line of raw.trim().split('\n')) {
    const record = JSON.parse(line);
    for (const detection of record.detections) {
      const serialized = JSON.stringify(detection);
      for (const value of plantedValues) {
        assert.equal(
          serialized.includes(value),
          false,
          `raw span leaked into a detection of ${record.id}`,
        );
      }
      assert.deepEqual(Object.keys(detection).sort(), DETECTION_FIELDS);
    }
  }

  // What the file still needs: the placeholder mapping, the routing metadata,
  // and a span hash that ties each detection to its ledger row.
  const byId = Object.fromEntries(
    raw.trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.id, r]),
  );

  const ssnDetections = byId.t24.detections.filter((d) => d.type === 'ssn');
  assert.equal(ssnDetections.length, 2);
  for (const d of ssnDetections) {
    assert.equal(d.token, '[SSN_1]', 'the placeholder mapping must survive');
    assert.equal(d.route, 'auto-redact');
    assert.equal(d.disposition, null);
    assert.equal(d.span_hmac, spanHmac(FIXTURE_SALT, T24_SSN));
  }

  // Nothing was replaced for an allow-observed span, so it has no placeholder.
  const addressDetection = byId.t24.detections.find((d) => d.type === 'address');
  assert.equal(addressDetection.token, null);
  assert.equal(addressDetection.route, 'allow-observed');
  assert.equal(addressDetection.span_hmac, spanHmac(FIXTURE_SALT, T24_ADDRESS));

  const [usernameDetection] = byId.t16.detections;
  assert.equal(usernameDetection.token, '[USERNAME_1]');
  assert.equal(usernameDetection.route, 'consult');
  assert.equal(usernameDetection.disposition, 'timeout');

  // The hash is the join key between redacted.jsonl and the ledger, so a
  // dispute can be settled with the salt and neither file holding the span.
  const rows = new Ledger(path.join(outDir, 'ledger.jsonl')).rows();
  const ledgerHmacs = new Set(rows.map((r) => r.span_hmac));
  for (const record of Object.values(byId)) {
    for (const d of record.detections) {
      assert.match(d.span_hmac, /^[0-9a-f]{64}$/);
      assert.ok(ledgerHmacs.has(d.span_hmac), 'detection hash must match its ledger row');
    }
  }
  assert.deepEqual(Ledger.verify(rows), { ok: true });
});

test('an unlocatable span is persisted with null offsets and no text', async () => {
  const inputPath = writeUnlocatableFixture('PIN 123 on file.', [
    { type: 'pin', value: T53_PIN, unlocatable: true },
  ]);
  const outDir = tempDir('sentinel-cli-out-');

  await runCli(['scrub', inputPath, '--out', outDir, '--mock']);

  const raw = fs.readFileSync(path.join(outDir, 'redacted.jsonl'), 'utf8');
  const [detection] = JSON.parse(raw.trim()).detections;
  assert.deepEqual(Object.keys(detection).sort(), DETECTION_FIELDS);
  assert.equal(detection.start, null);
  assert.equal(detection.end, null);
  // `unlocatable: true` must not travel either — it is not on the whitelist.
  assert.equal(raw.includes('unlocatable'), false);
  assert.equal(detection.token, '[PIN_1]');
  assert.equal(detection.span_hmac, spanHmac(FIXTURE_SALT, T53_PIN));
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

// ---- F1/F3/F5: unresolved spans must be reported accurately and fail closed

// Both values land above the 0.75 default ceiling under id 't53' (computed,
// not guessed), so they route auto-redact rather than allow-observed.
const T53_PIN = '123';
const T53_EMAIL = 'JANE@EXAMPLE.COM';

test('fail-closed fixture confidences route to auto-redact', () => {
  assert.ok(mockConfidence('t53', 'pin', T53_PIN) >= DEFAULT_POLICY.ceilings.default);
  assert.ok(mockConfidence('t53', 'email', T53_EMAIL) >= DEFAULT_POLICY.ceilings.default);
});

function writeUnlocatableFixture(text, planted) {
  const dir = tempDir('sentinel-cli-unloc-');
  const inputPath = path.join(dir, 'transcripts.jsonl');
  fs.writeFileSync(inputPath, `${JSON.stringify({ id: 't53', text, planted })}\n`);
  return inputPath;
}

test('F1/F3: a short unlocatable span is scrubbed and the warning says so, exit 0', async () => {
  const inputPath = writeUnlocatableFixture('PIN 123 on file.', [
    { type: 'pin', value: T53_PIN, unlocatable: true },
  ]);
  const outDir = tempDir('sentinel-cli-out-');

  const { stdout, stderr } = await runCli(['scrub', inputPath, '--out', outDir, '--mock']);

  const line = JSON.parse(fs.readFileSync(path.join(outDir, 'redacted.jsonl'), 'utf8').trim());
  assert.equal(
    line.redacted_text.includes(T53_PIN),
    false,
    'a sub-4-char unlocatable span must not survive into redacted_text',
  );
  assert.equal(line.redacted_text, 'PIN [PIN_1] on file.');
  assert.match(stderr, /pin span had no usable offsets — redacted by literal text match/);
  assert.equal(
    /DOES NOT OCCUR LITERALLY/.test(stderr),
    false,
    'the span text does occur literally — that reason would be factually wrong',
  );
  assert.match(stdout, /unresolved spans NOT removed \(possible leak\): 0/);
});

test('F3/F5: a span that could not be removed warns with the right cause, still writes output, and exits non-zero', async () => {
  const inputPath = writeUnlocatableFixture('Contact jane@example.com for details.', [
    { type: 'email', value: T53_EMAIL, unlocatable: true },
  ]);
  const outDir = tempDir('sentinel-cli-out-');

  await assert.rejects(
    () => runCli(['scrub', inputPath, '--out', outDir, '--mock']),
    (err) => {
      assert.notEqual(err.code, 0, 'a leaking run must not report success (ADR 0003)');
      assert.match(err.stderr, /email span had no usable offsets — ITS TEXT DOES NOT OCCUR LITERALLY/);
      assert.match(err.stderr, /could not be removed/);
      // The span text is the PII — it must never reach the console.
      assert.equal(err.stderr.includes(T53_EMAIL), false, 'must not print the span text');
      assert.match(err.stdout, /unresolved spans NOT removed \(possible leak\): 1/);
      return true;
    },
  );

  // Output and the ledger are still written before the non-zero exit.
  const line = JSON.parse(fs.readFileSync(path.join(outDir, 'redacted.jsonl'), 'utf8').trim());
  assert.equal(line.id, 't53');
  const rows = new Ledger(path.join(outDir, 'ledger.jsonl')).rows();
  assert.equal(rows.length, 1);
  assert.deepEqual(Ledger.verify(rows), { ok: true });
});

test('F5: the clean demo path still exits 0 and reports no leaks', async () => {
  const { inputPath } = buildFixture();
  const outDir = tempDir('sentinel-cli-out-');

  const { stdout } = await runCli(['scrub', inputPath, '--out', outDir, '--mock']);
  assert.match(stdout, /unresolved spans \(redacted by literal text only\): 0/);
  assert.match(stdout, /unresolved spans NOT removed \(possible leak\): 0/);
});
