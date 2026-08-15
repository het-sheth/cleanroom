import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer, parseArgs } from '../server.js';

const DASHBOARD = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(DASHBOARD, 'fixtures');

async function withServer(dir, run) {
  const server = createServer({ dir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('parseArgs defaults, env fallbacks, and overrides', () => {
  assert.deepEqual(parseArgs([]), { dir: 'out', port: 4600, host: null });
  assert.deepEqual(parseArgs(['--dir', 'dashboard/fixtures', '--port', '4700']), { dir: 'dashboard/fixtures', port: 4700, host: null });
  assert.deepEqual(parseArgs(['--dir=x', '--port=1234']), { dir: 'x', port: 1234, host: null });

  // hosted platforms (Render) inject PORT; flags still win
  assert.deepEqual(parseArgs([], { PORT: '10000', CLEANROOM_DIR: 'fixtures' }), { dir: 'fixtures', port: 10000, host: null });
  assert.equal(parseArgs(['--port', '4600'], { PORT: '10000' }).port, 4600);

  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['--port', 'abc']), /--port/);
  assert.throws(() => parseArgs([], { PORT: 'abc' }), /--port/);
});

test('/healthz reports ok', async () => {
  await withServer(FIXTURES, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});

test('/api/state on a directory with no output files returns an empty state', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'cleanroom-empty-'));
  await withServer(empty, async (base) => {
    const res = await fetch(`${base}/api/state`);
    assert.equal(res.status, 200);

    const state = await res.json();
    assert.equal(state.ok, true);
    assert.deepEqual(state.transcripts, []);
    assert.deepEqual(state.ledger, []);
    assert.equal(state.sources.redacted.present, false);
    assert.equal(state.sources.ledger.present, false);
    assert.equal(state.integrity.ok, true);
    assert.equal(state.integrity.length, 0);
    assert.equal(state.integrity.head, null);
    assert.equal(state.summary.total, 0);
    assert.equal(state.summary.observed_not_acted, 0);
    assert.deepEqual(state.summary.by_type, []);
  });
});

test('/api/state on a directory that does not exist at all still returns 200', async () => {
  await withServer(join(tmpdir(), 'cleanroom-does-not-exist-9f2c'), async (base) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.ok, true);
    assert.deepEqual(state.ledger, []);
  });
});

test('/api/state reports parse errors instead of throwing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanroom-partial-'));
  writeFileSync(join(dir, 'ledger.jsonl'), '{"trace_id":"t01","route":"allow-observed"}\n{"trace_id":"t02",\n');
  await withServer(dir, async (base) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.ledger.length, 1);
    assert.equal(state.sources.ledger.parse_errors.length, 1);
    assert.equal(state.sources.ledger.parse_errors[0].line, 2);
  });
});

test('/api/state over the fixtures serves a verifying chain and the wedge count', async () => {
  await withServer(FIXTURES, async (base) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.transcripts.length, 6);
    assert.equal(state.ledger.length, 22);
    assert.equal(state.integrity.ok, true);
    assert.equal(state.integrity.length, 22);
    assert.equal(state.summary.total, 22);
    assert.equal(state.summary.observed_not_acted, state.summary.routes['allow-observed']);
    assert.ok(state.summary.observed_not_acted > 0);
    assert.ok(state.summary.by_type.length > 0);
    assert.equal(state.summary.dispositions.timeout, 1);
  });
});

test('/api/state never serves the raw PII span from detections[].text', async () => {
  const RAW_EMAIL = 'zzsynthetic.canary@nowhere-canary.invalid';
  const RAW_PHONE = '(555) 867-5309-CANARY';
  const dir = mkdtempSync(join(tmpdir(), 'cleanroom-pii-'));
  writeFileSync(
    join(dir, 'redacted.jsonl'),
    `${JSON.stringify({
      id: 'c01',
      redacted_text: 'user: reach me at [EMAIL_1] or [PHONE_1].',
      detections: [
        { type: 'email', text: RAW_EMAIL, start: 18, end: 27, confidence: 0.94 },
        { type: 'phone', text: RAW_PHONE, start: 31, end: 40, confidence: 0.88 },
      ],
      // an unexpected raw-bearing field on a real run must not pass through either
      raw_text: `user: reach me at ${RAW_EMAIL} or ${RAW_PHONE}.`,
    })}\n`,
  );

  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.text();

    assert.ok(!body.includes(RAW_EMAIL), 'raw email span leaked into /api/state');
    assert.ok(!body.includes(RAW_PHONE), 'raw phone span leaked into /api/state');
    assert.ok(!body.includes('"text"'), 'a detections[].text field leaked into /api/state');
    assert.ok(!body.includes('raw_text'), 'an unknown raw-bearing field leaked into /api/state');

    // what the UI needs is still there
    const [transcript] = (await (await fetch(`${base}/api/state`)).json()).transcripts;
    assert.equal(transcript.id, 'c01');
    assert.match(transcript.redacted_text, /\[EMAIL_1\]/);
    assert.deepEqual(transcript.detections[0], { type: 'email', start: 18, end: 27, confidence: 0.94 });
  });
});

test('/api/state serves no raw spans over the shipped fixtures either', async () => {
  // allow-observed spans deliberately survive in redacted_text — that is the product's whole
  // wedge, and redacted_text is the field cleared to cross the boundary. The leak this guards
  // against is detections[].text adding raw spans the redacted text does not already contain.
  const rawSpans = readFileSync(join(FIXTURES, 'redacted.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .flatMap((rec) => rec.detections.map((d) => d.text).filter((t) => !rec.redacted_text.includes(t)));
  assert.ok(rawSpans.length > 0, 'fixture has no detections to check against');

  await withServer(FIXTURES, async (base) => {
    const body = await (await fetch(`${base}/api/state`)).text();
    for (const span of rawSpans) assert.ok(!body.includes(span), `raw span leaked: ${span}`);
  });
});

test('/api/state reuses the parsed state until a file changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleanroom-cache-'));
  writeFileSync(join(dir, 'ledger.jsonl'), '{"trace_id":"t01","route":"allow-observed"}\n');
  await withServer(dir, async (base) => {
    const first = await (await fetch(`${base}/api/state`)).json();
    assert.equal(first.ledger.length, 1);

    writeFileSync(join(dir, 'ledger.jsonl'), '{"trace_id":"t01","route":"allow-observed"}\n{"trace_id":"t02","route":"consult"}\n');
    const second = await (await fetch(`${base}/api/state`)).json();
    assert.equal(second.ledger.length, 2, 'appended rows must appear on the next poll');
  });
});

test('GET / serves the page with the chain module inlined', async () => {
  await withServer(FIXTURES, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);

    const html = await res.text();
    assert.ok(html.includes('window.cleanroomChain'), 'chain module was not inlined');
    assert.ok(!html.includes('<!--INLINE_CHAIN_MODULE-->'), 'inline marker was left in the page');
    assert.ok(!/^\s*(import|export) /m.test(html.split('window.cleanroomChain')[0].split('<script>').pop()), 'module syntax leaked into a classic script');
    assert.ok(
      html.includes(
        "Every PII layer proves what it redacted; cleanroom proves what it saw and deliberately didn't — cryptographically, without storing the value.",
      ),
      'wedge caption missing',
    );
  });
});

test('unknown paths 404', async () => {
  await withServer(FIXTURES, async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});
