import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../lib/detector.js';

function fakeFetch(status, bodyObj, { bodyText } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => bodyObj,
      text: async () => bodyText ?? JSON.stringify(bodyObj),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('detect POSTs the flat payload with schema and required headers', async () => {
  const fetchImpl = fakeFetch(200, {
    type: 'encoder',
    inference_id: 'abc',
    result: { data: { entities: {} } },
  });

  await detect('hello world', {
    apiKey: 'test-key',
    schema: { entities: ['person'] },
    fetchImpl,
  });

  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.pioneer.ai/inference');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['X-API-Key'], 'test-key');
  assert.equal(opts.headers['content-type'], 'application/json');
  const body = JSON.parse(opts.body);
  assert.deepEqual(body, {
    model_id: 'fastino/gliner2-privacy-filter-PII-multi',
    text: 'hello world',
    threshold: 0.5,
    schema: { entities: ['person'] },
  });
});

test('detect omits schema key entirely when not provided', async () => {
  const fetchImpl = fakeFetch(200, { result: { data: { entities: {} } } });
  await detect('hello', { apiKey: 'k', fetchImpl });
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal('schema' in body, false);
});

test('detect respects custom modelId and threshold', async () => {
  const fetchImpl = fakeFetch(200, { result: { data: { entities: {} } } });
  await detect('hello', {
    apiKey: 'k',
    modelId: 'custom/model',
    threshold: 0.9,
    fetchImpl,
  });
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(body.model_id, 'custom/model');
  assert.equal(body.threshold, 0.9);
});

test('normalizes primary shape: dict-of-types entities with offsets', async () => {
  const text = 'Contact Jane Doe at jane@example.com.';
  const fetchImpl = fakeFetch(200, {
    type: 'encoder',
    inference_id: 'abc',
    result: {
      data: {
        entities: {
          person: [{ text: 'Jane Doe', confidence: 0.98, start: 8, end: 16 }],
          // end is 36, not 37: 37 would include the trailing '.', i.e. an
          // offset that disagrees with the reported span text — which the
          // detector now re-locates rather than trusts (see the I2 tests).
          email: [
            { text: 'jane@example.com', confidence: 0.95, start: 20, end: 36 },
          ],
        },
      },
    },
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.deepEqual(spans, [
    { type: 'person', text: 'Jane Doe', start: 8, end: 16, confidence: 0.98 },
    {
      type: 'email',
      text: 'jane@example.com',
      start: 20,
      end: 36,
      confidence: 0.95,
    },
  ]);
});

test('normalizes fallback shape: top-level entities array with type/text keys', async () => {
  const text = 'Call 555-1234 now.';
  const fetchImpl = fakeFetch(200, {
    entities: [
      { type: 'phone', text: '555-1234', confidence: 0.8, start: 5, end: 13 },
    ],
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.deepEqual(spans, [
    { type: 'phone', text: '555-1234', start: 5, end: 13, confidence: 0.8 },
  ]);
});

test('normalizes fallback shape: result.entities array with label/span/score keys', async () => {
  const text = 'SSN 123-45-6789 on file.';
  const fetchImpl = fakeFetch(200, {
    result: {
      entities: [{ label: 'ssn', span: '123-45-6789', score: 0.99 }],
    },
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].type, 'ssn');
  assert.equal(spans[0].text, '123-45-6789');
  assert.equal(spans[0].confidence, 0.99);
  assert.equal(spans[0].start, 4);
  assert.equal(spans[0].end, 15);
});

test('normalizes fallback shape: bare top-level array', async () => {
  const text = 'Name: Bob';
  const fetchImpl = fakeFetch(200, [
    { type: 'person', text: 'Bob', confidence: 0.7, start: 6, end: 9 },
  ]);
  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.deepEqual(spans, [
    { type: 'person', text: 'Bob', start: 6, end: 9, confidence: 0.7 },
  ]);
});

test('missing offsets are located by searching the transcript text', async () => {
  const text = 'My name is Bob. Bob likes tea.';
  const fetchImpl = fakeFetch(200, {
    entities: [{ type: 'person', text: 'Bob', confidence: 0.9 }],
  });
  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].start, 11);
  assert.equal(spans[0].end, 14);
});

test('duplicate entity text maps to successive occurrences in order', async () => {
  const text = 'My name is Bob. Bob likes tea.';
  const fetchImpl = fakeFetch(200, {
    entities: [
      { type: 'person', text: 'Bob', confidence: 0.9 },
      { type: 'person', text: 'Bob', confidence: 0.85 },
    ],
  });
  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans.length, 2);
  assert.equal(spans[0].start, 11);
  assert.equal(spans[0].end, 14);
  assert.equal(spans[1].start, 16);
  assert.equal(spans[1].end, 19);
});

// ---- C1: unlocatable spans must never carry a -1 "range" -------------------

test('C1: a span whose text cannot be located carries null offsets and an unlocatable flag, never -1', async () => {
  const text = 'SSN 523-04-0002 on file.';
  // Two hits for a string the transcript contains once: the second exhausts
  // the occurrence index, which is exactly how live Pioneer reaches this path.
  const fetchImpl = fakeFetch(200, {
    entities: [
      { type: 'ssn', text: '523-04-0002', confidence: 0.9 },
      { type: 'ssn', text: '523-04-0002', confidence: 0.85 },
    ],
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans.length, 2);
  assert.equal(spans[0].start, 4);
  assert.equal(spans[0].end, 15);
  assert.equal('unlocatable' in spans[0], false);

  assert.notEqual(spans[1].start, -1, 'must not emit a -1 sentinel as a range');
  assert.notEqual(spans[1].end, -1);
  assert.equal(spans[1].start, null);
  assert.equal(spans[1].end, null);
  assert.equal(spans[1].unlocatable, true);
  assert.equal(spans[1].text, '523-04-0002');
});

test('C1: a span text absent from the transcript entirely is flagged unlocatable', async () => {
  const text = 'Contact jane@example.com for details.';
  const fetchImpl = fakeFetch(200, {
    entities: [{ type: 'email', text: 'JANE@EXAMPLE.COM', confidence: 0.9 }],
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans[0].unlocatable, true);
  assert.equal(spans[0].start, null);
  assert.equal(spans[0].end, null);
});

// ---- I2: offsets must agree with the reported span text --------------------

test('I2: offsets that do not select the reported span text are re-located by search', async () => {
  const text = 'SSN 523-04-0002 on file.';
  // Drifted by 4 — e.g. offsets computed against a normalized copy. Trusting
  // them verbatim would redact "SSN 523-04" and leave "0002" in the output.
  const fetchImpl = fakeFetch(200, {
    entities: [
      { type: 'ssn', text: '523-04-0002', start: 0, end: 11, confidence: 0.9 },
    ],
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans[0].start, 4);
  assert.equal(spans[0].end, 15);
  assert.equal(text.slice(spans[0].start, spans[0].end), spans[0].text);
});

test('I2: offsets that agree with the reported span text are used verbatim', async () => {
  const text = 'My name is Bob. Bob likes tea.';
  // The second occurrence's offsets must survive, not be re-searched to the first.
  const fetchImpl = fakeFetch(200, {
    entities: [{ type: 'person', text: 'Bob', start: 16, end: 19, confidence: 0.9 }],
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans[0].start, 16);
  assert.equal(spans[0].end, 19);
});

test('I2: out-of-range offsets fall back to search rather than slicing past the end', async () => {
  const text = 'Call 555-1234 now.';
  const fetchImpl = fakeFetch(200, {
    entities: [
      { type: 'phone', text: '555-1234', start: 900, end: 908, confidence: 0.8 },
    ],
  });

  const spans = await detect(text, { apiKey: 'k', fetchImpl });
  assert.equal(spans[0].start, 5);
  assert.equal(spans[0].end, 13);
});

// ---- I3: malformed hits are rejected at the boundary -----------------------

test('I3: a hit with neither type nor label is rejected at the detector boundary', async () => {
  const fetchImpl = fakeFetch(200, {
    entities: [{ text: 'Bob', confidence: 0.9 }],
  });
  await assert.rejects(
    () => detect('My name is Bob.', { apiKey: 'k', fetchImpl }),
    (err) => {
      assert.match(err.message, /malformed Pioneer hit/);
      assert.match(err.message, /entity type/);
      return true;
    },
  );
});

test('I3: a hit with neither confidence nor score is rejected at the detector boundary', async () => {
  const fetchImpl = fakeFetch(200, {
    result: { data: { entities: { ssn: [{ text: '523-04-0002', start: 4, end: 15 }] } } },
  });
  await assert.rejects(
    () => detect('SSN 523-04-0002 on file.', { apiKey: 'k', fetchImpl }),
    (err) => {
      assert.match(err.message, /malformed Pioneer hit/);
      assert.match(err.message, /confidence/);
      // Errors reach stderr — they must not carry the span text.
      assert.equal(err.message.includes('523-04-0002'), false);
      return true;
    },
  );
});

test('I3: a hit with an out-of-range confidence is rejected at the detector boundary', async () => {
  const fetchImpl = fakeFetch(200, {
    entities: [{ type: 'ssn', text: '523-04-0002', confidence: 42 }],
  });
  await assert.rejects(
    () => detect('SSN 523-04-0002 on file.', { apiKey: 'k', fetchImpl }),
    /malformed Pioneer hit/,
  );
});

test('I3: a hit with no span text is rejected at the detector boundary', async () => {
  const fetchImpl = fakeFetch(200, {
    entities: [{ type: 'ssn', confidence: 0.9 }],
  });
  await assert.rejects(
    () => detect('SSN 523-04-0002 on file.', { apiKey: 'k', fetchImpl }),
    /malformed Pioneer hit/,
  );
});

test('unrecognized response shape throws with body JSON in message', async () => {
  const fetchImpl = fakeFetch(200, { unexpected: 'shape' });
  await assert.rejects(
    () => detect('hi', { apiKey: 'k', fetchImpl }),
    (err) => {
      assert.match(err.message, /unrecognized Pioneer response shape/);
      assert.match(err.message, /unexpected/);
      return true;
    },
  );
});

test('non-2xx response throws with status and body text, no retry', async () => {
  const fetchImpl = fakeFetch(
    422,
    { error: 'encoder.schema must be provided' },
    { bodyText: '{"error":"encoder.schema must be provided"}' },
  );
  await assert.rejects(
    () => detect('hi', { apiKey: 'k', fetchImpl }),
    (err) => {
      assert.match(err.message, /422/);
      assert.match(err.message, /encoder\.schema must be provided/);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 1);
});
