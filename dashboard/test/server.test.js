import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
